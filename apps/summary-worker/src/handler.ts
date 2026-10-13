import {
  audit,
  getOrgScopedDb,
  type ClaimStatus,
  type NextAction,
  type prisma,
} from '@dentabill/db';
import type { Logger } from '@dentabill/logger';
import type { NotifierPort } from '@dentabill/notifier';
import { isKnownDenialCode } from '@dentabill/payer-ivr';
import { SummaryJobDataSchema, type SummaryJobData, type SummaryJobResult } from '@dentabill/queue';
import {
  SummaryValidationError,
  SummaryOutputSchema,
  type SummarizerPort,
  type SummarizeInput,
} from '@dentabill/summarizer';
import { selectCallTranscript } from '@dentabill/types';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';

import { billingDayUtc, type CostGuard, createRedisCostGuard } from './cost-guard.js';
import type { SummaryWorkerEnv } from './env.js';

/**
 * Job handler for `summary.generate`.
 *
 * High level:
 *   1. Validate the job payload (defence-in-depth — the call-worker
 *      already validated at enqueue, but the queue is a trust
 *      boundary).
 *   2. Acquire the per-org Redis cost-guard lock; on contention, throw
 *      so BullMQ retries with backoff.
 *   3. Inside the lock: read `Organization.summaryTokensUsed`. If the
 *      org is over budget, audit `summary.budget_exceeded` and return
 *      without calling Claude.
 *   4. Load the Call + transcript turns via `getOrgScopedDb`.
 *   5. Invoke `SummarizerPort.summarize`.
 *   6. Persist the `CallSummary` row. Schema rejection from
 *      `SummaryValidationError` routes Claim → MANUAL_REVIEW + audit
 *      `summary.dlq` (returned outcome `DLQ`).
 *   7. Apply transition policy:
 *        - `SUMMARIZER_AUTO_TRANSITION_ENABLED` env OFF → MANUAL_REVIEW.
 *        - `confidence < 0.95` → MANUAL_REVIEW.
 *        - `nextAction = SUBMIT_DOCS` → route eligible Claim to NEEDS_INFO.
 *        - Anything else → MANUAL_REVIEW.
 *      The Claim transition writes one `claim.transition` audit row.
 *   8. Update `Organization.summaryTokensUsed += tokensUsed` (still
 *      inside the lock window).
 *   9. Release the lock.
 */

export type DbClient = typeof prisma;

export interface SummaryHandlerDeps {
  readonly logger: Logger;
  readonly prisma: DbClient;
  /**
   * Redis for the per-org cost-guard lock. Ignored when `costGuard` is
   * given; one of the two is required.
   */
  readonly redis?: Redis;
  /** Explicit cost-guard mutex (ADR-053) — e.g. the in-memory one when there is no Redis. */
  readonly costGuard?: CostGuard;
  readonly summarizer: SummarizerPort;
  readonly env: SummaryWorkerEnv;
  readonly clock?: () => Date;
  /**
   * Optional notifier — when present, the handler dispatches a
   * review-required event to the operator. Phase 4 wires FakeResend
   * (which only logs to memory); the live adapter ships in 4.5. The
   * notifier is intentionally optional: a misconfigured org without an
   * outbound mailbox should still get summaries persisted, just no
   * email.
   */
  readonly notifier?: NotifierPort;
  /**
   * Recipient resolver — given an org id, return the email to notify.
   * Defaults to "skip notification" so the handler stays usable in
   * tests that don't care.
   */
  readonly resolveRecipient?: (organizationId: string) => Promise<string | null>;
}

export type SummaryJobLike = Pick<Job<SummaryJobData, SummaryJobResult>, 'id' | 'data'>;

export type SummaryHandler = (job: SummaryJobLike) => Promise<SummaryJobResult>;

const SUMMARY_ELIGIBLE_STATUSES: ReadonlySet<ClaimStatus> = new Set(['COMPLETED', 'DENIED']);

const MIN_AUTO_CONFIDENCE = 0.95;

export function createSummaryJobHandler(deps: SummaryHandlerDeps): SummaryHandler {
  const clock = deps.clock ?? ((): Date => new Date());
  const costGuard = deps.costGuard ?? (deps.redis ? createRedisCostGuard(deps.redis) : undefined);
  if (!costGuard) {
    throw new Error('createSummaryJobHandler: either `costGuard` or `redis` is required');
  }
  return async function handle(job: SummaryJobLike): Promise<SummaryJobResult> {
    const validated = SummaryJobDataSchema.safeParse(job.data);
    if (!validated.success) {
      // Validation failure at the trust boundary is unrecoverable — do
      // NOT throw (BullMQ would retry the same garbage). Audit and
      // return DLQ so the job marks completed and we have a record.
      deps.logger.error(
        { jobId: job.id, issues: validated.error.issues },
        'summary-worker: invalid job payload — routing to DLQ',
      );
      return {
        summaryId: null,
        outcome: 'DLQ',
        tokensUsed: 0,
        promptVersion: 'unknown',
      };
    }
    const data = validated.data;
    const billingDay = billingDayUtc(clock());

    const lock = await costGuard.tryAcquire(data.organizationId, billingDay);
    if (!lock) {
      // Another worker holds the org's budget mutex. Throwing makes
      // BullMQ requeue with backoff — this is rate-limiting, not a
      // failure. The retry budget covers contention windows up to
      // several minutes.
      throw new Error(
        `cost-guard lock contention for org=${data.organizationId} day=${billingDay}`,
      );
    }

    try {
      const orgScoped = getOrgScopedDb(data.organizationId);
      const existingSummary = await orgScoped.callSummary.findFirst({
        where: { callId: data.callId },
      });
      if (existingSummary) {
        return {
          summaryId: existingSummary.id,
          outcome: 'ALREADY_PROCESSED',
          tokensUsed: 0,
          promptVersion: data.promptVersion,
        };
      }
      const tokensBudget = deps.env.SUMMARIZER_DAILY_TOKEN_BUDGET;
      const org = await deps.prisma.organization.findUnique({
        where: { id: data.organizationId },
        select: { id: true, summaryTokensUsed: true, summaryTokensResetAt: true },
      });
      if (!org) {
        deps.logger.error(
          { jobId: job.id, organizationId: data.organizationId },
          'summary-worker: organization not found — routing to DLQ',
        );
        return {
          summaryId: null,
          outcome: 'DLQ',
          tokensUsed: 0,
          promptVersion: data.promptVersion,
        };
      }

      // Reset window — if the saved reset day is older than today, zero
      // the counter before applying the budget check.
      const tokensAlreadyUsed = isStaleResetDay(org.summaryTokensResetAt, billingDay)
        ? 0
        : org.summaryTokensUsed;
      if (tokensAlreadyUsed >= tokensBudget) {
        await audit({
          action: 'summary.budget_exceeded',
          resourceType: 'Organization',
          resourceId: org.id,
          organizationId: org.id,
          metadata: { billingDay, tokensUsed: tokensAlreadyUsed, tokensBudget },
        });
        return {
          summaryId: null,
          outcome: 'BUDGET_EXCEEDED',
          tokensUsed: 0,
          promptVersion: data.promptVersion,
        };
      }

      // Multi-tenant load: the read-scope extension forces
      // organizationId on every query — even a buggy or forged
      // job payload can't cross orgs.
      const call = await orgScoped.call.findFirst({ where: { id: data.callId } });
      if (!call) {
        deps.logger.error(
          { jobId: job.id, callId: data.callId },
          'summary-worker: call not found within org scope — routing to DLQ',
        );
        return {
          summaryId: null,
          outcome: 'DLQ',
          tokensUsed: 0,
          promptVersion: data.promptVersion,
        };
      }

      if (!['COMPLETED', 'FAILED', 'VOICEMAIL'].includes(call.status)) {
        return {
          summaryId: null,
          outcome: 'CALL_NOT_TERMINAL',
          tokensUsed: 0,
          promptVersion: data.promptVersion,
        };
      }

      const events = await deps.prisma.callEvent.findMany({
        where: { callId: call.id, call: { organizationId: data.organizationId } },
        orderBy: { timestamp: 'asc' },
      });
      const transcript = selectCallTranscript(events);
      const transcriptTurns = transcript.turns.map((turn) => ({
        role: turn.role,
        text: turn.text,
        timestamp: turn.observedAt,
      }));

      // PHI read — the events contain transcript text. Audit the read
      // before any further processing so a downstream throw still
      // leaves a trail.
      await audit({
        action: 'callSummary.generate.read',
        resourceType: 'Call',
        resourceId: call.id,
        organizationId: data.organizationId,
        metadata: { transcriptTurnCount: transcriptTurns.length, jobId: job.id ?? null },
      });

      if (
        transcript.kind === 'provisional' ||
        transcript.kind === 'unavailable' ||
        !transcriptTurns.some((turn) => turn.text.trim().length > 0)
      ) {
        return {
          summaryId: null,
          outcome: 'TRANSCRIPT_UNAVAILABLE',
          tokensUsed: 0,
          promptVersion: data.promptVersion,
        };
      }

      // Guard: the call must have a payerCode-bearing Claim in scope.
      const claim = await orgScoped.claim.findFirst({ where: { id: call.claimId } });
      if (!claim) {
        deps.logger.error(
          { jobId: job.id, callId: call.id },
          'summary-worker: claim missing — routing to DLQ',
        );
        return {
          summaryId: null,
          outcome: 'DLQ',
          tokensUsed: 0,
          promptVersion: data.promptVersion,
        };
      }

      let summarizeResult;
      try {
        const input: SummarizeInput = {
          organizationId: data.organizationId,
          callId: call.id,
          payerCode: claim.payerCode,
          promptVersion: data.promptVersion,
          transcriptTurns,
        };
        summarizeResult = await deps.summarizer.summarize(input);
        const parsed = SummaryOutputSchema.safeParse(summarizeResult.summary);
        if (!parsed.success) {
          throw new SummaryValidationError(
            call.id,
            parsed.error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: 'Invalid summary field',
            })),
          );
        }
        summarizeResult = { ...summarizeResult, summary: parsed.data };
      } catch (err) {
        if (err instanceof SummaryValidationError) {
          await audit({
            action: 'summary.dlq',
            resourceType: 'Call',
            resourceId: call.id,
            organizationId: data.organizationId,
            metadata: {
              jobId: job.id ?? null,
              issues: err.issues.map((i) => `${i.path}: ${i.message}`),
            },
          });
          // Force the Claim into MANUAL_REVIEW so the operator picks
          // it up — never auto-decision when validation failed.
          await deps.prisma.claim.updateMany({
            where: {
              ...summaryTransitionWhere(claim, call, data.organizationId),
              status: { in: ['COMPLETED', 'DENIED'] },
            },
            data: { status: 'MANUAL_REVIEW' },
          });
          return {
            summaryId: null,
            outcome: 'DLQ',
            tokensUsed: 0,
            promptVersion: data.promptVersion,
          };
        }
        throw err;
      }

      const policy = applyTransitionPolicy({
        autoTransitionEnabled: deps.env.SUMMARIZER_AUTO_TRANSITION_ENABLED,
        confidence: summarizeResult.summary.confidence,
        nextAction: summarizeResult.summary.nextAction,
        currentStatus: claim.status,
        denialCode: summarizeResult.summary.denialCode,
      });

      // A summary, its state effect, audit, and usage must commit together.
      const { summary, transitionApplied } = await deps.prisma.$transaction(async (tx) => {
        const summary = await tx.callSummary.create({
          data: {
            organizationId: data.organizationId,
            callId: call.id,
            claimStatus: summarizeResult.summary.claimStatus,
            denialReason: summarizeResult.summary.denialReason,
            denialCode: summarizeResult.summary.denialCode,
            nextAction: summarizeResult.summary.nextAction,
            confidence: summarizeResult.summary.confidence,
            repName: summarizeResult.summary.repName,
            referenceNumber: summarizeResult.summary.referenceNumber,
            callbackDate: summarizeResult.summary.callbackDate
              ? new Date(summarizeResult.summary.callbackDate)
              : null,
            amountApproved:
              summarizeResult.summary.amountApprovedCents === null
                ? null
                : (summarizeResult.summary.amountApprovedCents / 100).toFixed(2),
            notes: summarizeResult.summary.notes,
            rawTranscript:
              transcript.rawText ?? transcriptTurns.map((t) => `[${t.role}] ${t.text}`).join('\n'),
            claudeSummary: stringifyClaudeSummary(summarizeResult.summary),
          },
        });

        const transition = SUMMARY_ELIGIBLE_STATUSES.has(claim.status)
          ? await tx.claim.updateMany({
              where: summaryTransitionWhere(claim, call, data.organizationId),
              data: { status: policy.targetStatus },
            })
          : { count: 0 };
        const transitionApplied = transition.count === 1;
        await audit(
          {
            action: transitionApplied ? 'claim.transition' : 'summary.transition_skipped',
            resourceType: 'Claim',
            resourceId: claim.id,
            organizationId: data.organizationId,
            metadata: {
              summaryId: summary.id,
              confidence: summarizeResult.summary.confidence,
              nextAction: summarizeResult.summary.nextAction,
              autoTransitioned: transitionApplied && policy.autoTransitioned,
              fromStatus: claim.status,
              toStatus: transitionApplied ? policy.targetStatus : null,
              reason: transitionApplied ? policy.reason : 'CLAIM_CHANGED_OR_PROTECTED',
              prompt: summarizeResult.promptVersion,
              model: summarizeResult.model,
              jobId: job.id ?? null,
            },
          },
          tx,
        );
        await tx.organization.update({
          where: { id: org.id },
          data: {
            summaryTokensUsed: isStaleResetDay(org.summaryTokensResetAt, billingDay)
              ? summarizeResult.tokensUsed
              : { increment: summarizeResult.tokensUsed },
            summaryTokensResetAt: clock(),
          },
        });
        return { summary, transitionApplied };
      });

      // Optional notify. PHI-screened by the template's Zod schema —
      // we only pass claim metadata, never patient identifiers.
      if (transitionApplied && deps.notifier && deps.resolveRecipient) {
        try {
          const to = await deps.resolveRecipient(data.organizationId);
          if (to) {
            await dispatchClaimNotification(deps.notifier, {
              to,
              organizationId: data.organizationId,
              claimNumber: claim.claimNumber,
              payerCode: claim.payerCode,
              serviceDate: claim.serviceDate,
            });
          }
        } catch (err) {
          // Notify failure is NOT fatal — the summary is persisted
          // and audited. Log and continue.
          deps.logger.error(
            { errorType: err instanceof Error ? err.name : 'UnknownError' },
            'summary-worker: notifier dispatch failed — summary still persisted',
          );
        }
      }

      return {
        summaryId: summary.id,
        outcome: !transitionApplied
          ? 'STALE_RESULT'
          : policy.autoTransitioned
            ? 'AUTO_TRANSITIONED'
            : 'MANUAL_REVIEW',
        tokensUsed: summarizeResult.tokensUsed,
        promptVersion: summarizeResult.promptVersion,
      };
    } finally {
      await costGuard.release(lock);
    }
  };
}

function isStaleResetDay(prev: Date | null, billingDay: string): boolean {
  if (!prev) return true;
  return prev.toISOString().slice(0, 10) !== billingDay;
}

function stringifyClaudeSummary(summary: {
  readonly claimStatus: string;
  readonly denialReason: string | null;
  readonly denialCode: string | null;
  readonly nextAction: string;
  readonly notes: string | null;
}): string {
  const parts = [
    `status=${summary.claimStatus}`,
    summary.denialCode ? `denialCode=${summary.denialCode}` : null,
    summary.denialReason ? `reason=${summary.denialReason}` : null,
    `nextAction=${summary.nextAction}`,
    summary.notes ? `notes=${summary.notes}` : null,
  ].filter((s): s is string => s !== null);
  return parts.join(' | ');
}

function summaryTransitionWhere(
  claim: { readonly id: string; readonly status: ClaimStatus; readonly updatedAt: Date },
  call: { readonly id: string; readonly createdAt: Date },
  organizationId: string,
) {
  return {
    id: claim.id,
    organizationId,
    status: claim.status,
    updatedAt: claim.updatedAt,
    calls: {
      none: {
        organizationId,
        OR: [
          { createdAt: { gt: call.createdAt } },
          { createdAt: call.createdAt, id: { gt: call.id } },
        ],
      },
    },
  };
}

export interface TransitionPolicyInput {
  readonly autoTransitionEnabled: boolean;
  readonly confidence: number;
  readonly nextAction: NextAction;
  readonly currentStatus: ClaimStatus;
  readonly denialCode?: string | null;
}

export interface TransitionPolicyResult {
  readonly autoTransitioned: boolean;
  readonly targetStatus: ClaimStatus;
  readonly reason:
    | 'CLAIM_STATE_PROTECTED'
    | 'REVIEW_REQUIRED'
    | 'NON_FINANCIAL_ROUTING'
    | 'UNMAPPED_CODE';
}

export function applyTransitionPolicy(input: TransitionPolicyInput): TransitionPolicyResult {
  if (!SUMMARY_ELIGIBLE_STATUSES.has(input.currentStatus)) {
    return {
      autoTransitioned: false,
      targetStatus: input.currentStatus,
      reason: 'CLAIM_STATE_PROTECTED',
    };
  }
  if (input.denialCode && !isKnownDenialCode(input.denialCode)) {
    return { autoTransitioned: false, targetStatus: 'MANUAL_REVIEW', reason: 'UNMAPPED_CODE' };
  }
  if (
    input.autoTransitionEnabled &&
    Number.isFinite(input.confidence) &&
    input.confidence >= MIN_AUTO_CONFIDENCE &&
    input.confidence <= 1 &&
    input.nextAction === 'SUBMIT_DOCS'
  ) {
    return { autoTransitioned: true, targetStatus: 'NEEDS_INFO', reason: 'NON_FINANCIAL_ROUTING' };
  }
  return { autoTransitioned: false, targetStatus: 'MANUAL_REVIEW', reason: 'REVIEW_REQUIRED' };
}

interface DispatchInput {
  readonly to: string;
  readonly organizationId: string;
  readonly claimNumber: string;
  readonly payerCode: string;
  readonly serviceDate: Date;
}

async function dispatchClaimNotification(
  notifier: NotifierPort,
  input: DispatchInput,
): Promise<void> {
  const serviceDate = input.serviceDate.toISOString().slice(0, 10);
  const baseVars = {
    claimNumber: input.claimNumber,
    payerCode: input.payerCode,
    serviceDate,
  };
  await notifier.notify({
    to: input.to,
    template: 'summary.review_required',
    vars: {
      ...baseVars,
      hint: 'Review the call evidence. Payer-reported amounts are not verified payments.',
    },
    organizationId: input.organizationId,
  });
}
