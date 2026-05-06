import { audit, getOrgScopedDb, type CallEvent, type NextAction, type prisma } from '@dentabill/db';
import type { Logger } from '@dentabill/logger';
import type { NotifierPort, TemplateName, TemplateVars } from '@dentabill/notifier';
import { SummaryJobDataSchema, type SummaryJobData, type SummaryJobResult } from '@dentabill/queue';
import {
  SummaryValidationError,
  type SummarizerPort,
  type SummarizeInput,
} from '@dentabill/summarizer';
import type { Job } from 'bullmq';
import type { Redis } from 'ioredis';

import { billingDayUtc, release as releaseLock, tryAcquire } from './cost-guard.js';
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
 *        - `nextAction in {RESOLVED, NEEDS_INFO}` → flip Claim.
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
  readonly redis: Redis;
  readonly summarizer: SummarizerPort;
  readonly env: SummaryWorkerEnv;
  readonly clock?: () => Date;
  /**
   * Optional notifier — when present, the handler dispatches a
   * post-resolution event to the operator. Phase 4 wires FakeResend
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

const AUTO_TRANSITION_ACTIONS: ReadonlySet<NextAction> = new Set<NextAction>([
  'RESOLVED',
  'CALL_BACK', // benign re-poll
  'SUBMIT_DOCS',
]);

const MIN_AUTO_CONFIDENCE = 0.95;

export function createSummaryJobHandler(deps: SummaryHandlerDeps): SummaryHandler {
  const clock = deps.clock ?? ((): Date => new Date());
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

    const lock = await tryAcquire(deps.redis, data.organizationId, billingDay);
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
      const orgScoped = getOrgScopedDb(data.organizationId);
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

      const events = await deps.prisma.callEvent.findMany({
        where: { callId: call.id },
        orderBy: { timestamp: 'asc' },
      });
      const transcriptTurns = transcriptFromEvents(events);

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
            where: { id: claim.id, organizationId: data.organizationId },
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

      // Persist the CallSummary. The org-scope write middleware enforces
      // organizationId presence; we pass it explicitly.
      const summary = await deps.prisma.callSummary.create({
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
          rawTranscript: transcriptTurns.map((t) => `[${t.role}] ${t.text}`).join('\n'),
          claudeSummary: stringifyClaudeSummary(summarizeResult.summary),
        },
      });

      const policy = applyTransitionPolicy({
        autoTransitionEnabled: deps.env.SUMMARIZER_AUTO_TRANSITION_ENABLED,
        confidence: summarizeResult.summary.confidence,
        nextAction: summarizeResult.summary.nextAction,
        currentStatus: claim.status,
      });

      await deps.prisma.claim.updateMany({
        where: { id: claim.id, organizationId: data.organizationId },
        data: { status: policy.targetStatus },
      });

      await audit({
        action: 'claim.transition',
        resourceType: 'Claim',
        resourceId: claim.id,
        organizationId: data.organizationId,
        metadata: {
          summaryId: summary.id,
          confidence: summarizeResult.summary.confidence,
          nextAction: summarizeResult.summary.nextAction,
          autoTransitioned: policy.autoTransitioned,
          fromStatus: claim.status,
          toStatus: policy.targetStatus,
          prompt: summarizeResult.promptVersion,
          model: summarizeResult.model,
          jobId: job.id ?? null,
        },
      });

      // Update the org's running token tally inside the lock window.
      // `increment` keeps the write contention-safe even though we
      // already serialised via the lock — defence in depth.
      await deps.prisma.organization.update({
        where: { id: org.id },
        data: {
          summaryTokensUsed: isStaleResetDay(org.summaryTokensResetAt, billingDay)
            ? summarizeResult.tokensUsed
            : { increment: summarizeResult.tokensUsed },
          summaryTokensResetAt: clock(),
        },
      });

      // Optional notify. PHI-screened by the template's Zod schema —
      // we only pass claim metadata, never patient identifiers.
      if (deps.notifier && deps.resolveRecipient) {
        try {
          const to = await deps.resolveRecipient(data.organizationId);
          if (to) {
            await dispatchClaimNotification(deps.notifier, {
              to,
              organizationId: data.organizationId,
              summaryStatus: summarizeResult.summary.claimStatus,
              denialCode: summarizeResult.summary.denialCode,
              claimNumber: claim.claimNumber,
              payerCode: claim.payerCode,
              serviceDate: claim.serviceDate,
            });
          }
        } catch (err) {
          // Notify failure is NOT fatal — the summary is persisted
          // and audited. Log and continue.
          deps.logger.error(
            { err: err instanceof Error ? { message: err.message, name: err.name } : err },
            'summary-worker: notifier dispatch failed — summary still persisted',
          );
        }
      }

      return {
        summaryId: summary.id,
        outcome: policy.autoTransitioned ? 'AUTO_TRANSITIONED' : 'MANUAL_REVIEW',
        tokensUsed: summarizeResult.tokensUsed,
        promptVersion: summarizeResult.promptVersion,
      };
    } finally {
      await releaseLock(deps.redis, lock);
    }
  };
}

function isStaleResetDay(prev: Date | null, billingDay: string): boolean {
  if (!prev) return true;
  return prev.toISOString().slice(0, 10) !== billingDay;
}

interface TranscriptTurn {
  readonly role: 'agent' | 'representative' | 'system';
  readonly text: string;
  readonly timestamp: Date;
}

function transcriptFromEvents(events: readonly CallEvent[]): readonly TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const ev of events) {
    if (ev.eventType !== 'call.transcript') continue;
    const data = ev.data as Record<string, unknown> | null;
    const role = pickRole(data);
    const text = typeof data?.text === 'string' ? data.text : '';
    if (text.length === 0) continue;
    turns.push({ role, text, timestamp: ev.timestamp });
  }
  return turns;
}

function pickRole(data: Record<string, unknown> | null): TranscriptTurn['role'] {
  const raw = typeof data?.role === 'string' ? data.role.toLowerCase() : '';
  if (raw === 'representative' || raw === 'rep' || raw === 'human') return 'representative';
  if (raw === 'system') return 'system';
  return 'agent';
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

export interface TransitionPolicyInput {
  readonly autoTransitionEnabled: boolean;
  readonly confidence: number;
  readonly nextAction: NextAction;
  readonly currentStatus: string;
}

export interface TransitionPolicyResult {
  readonly autoTransitioned: boolean;
  readonly targetStatus:
    | 'MANUAL_REVIEW'
    | 'RESOLVED'
    | 'NEEDS_INFO'
    | 'CALLING'
    | 'PENDING'
    | 'COMPLETED';
}

/**
 * Pure transition policy. The handler invokes this with the parsed
 * `SummaryOutput` + the kill-switch flag; it returns the target
 * `Claim.status` plus a flag indicating whether this counts as an
 * auto-decision (drives the audit metadata + result outcome).
 */
export function applyTransitionPolicy(input: TransitionPolicyInput): TransitionPolicyResult {
  if (!input.autoTransitionEnabled) {
    return { autoTransitioned: false, targetStatus: 'MANUAL_REVIEW' };
  }
  if (input.confidence < MIN_AUTO_CONFIDENCE) {
    return { autoTransitioned: false, targetStatus: 'MANUAL_REVIEW' };
  }
  if (!AUTO_TRANSITION_ACTIONS.has(input.nextAction)) {
    return { autoTransitioned: false, targetStatus: 'MANUAL_REVIEW' };
  }
  switch (input.nextAction) {
    case 'RESOLVED':
      return { autoTransitioned: true, targetStatus: 'RESOLVED' };
    case 'SUBMIT_DOCS':
      return { autoTransitioned: true, targetStatus: 'NEEDS_INFO' };
    case 'CALL_BACK':
      // Benign re-poll — leave Claim COMPLETED so the dashboard surfaces
      // it for the operator's next-call decision rather than auto-flipping.
      return { autoTransitioned: false, targetStatus: 'MANUAL_REVIEW' };
    default:
      return { autoTransitioned: false, targetStatus: 'MANUAL_REVIEW' };
  }
}

interface DispatchInput {
  readonly to: string;
  readonly organizationId: string;
  readonly summaryStatus: string;
  readonly denialCode: string | null;
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
  let template: TemplateName;
  let vars: TemplateVars<TemplateName>;

  if (input.summaryStatus === 'paid') {
    template = 'claim.resolved';
    vars = { ...baseVars, amountResolvedCents: 0 };
  } else if (input.summaryStatus === 'denied' && input.denialCode) {
    template = 'claim.denied';
    vars = { ...baseVars, denialCode: input.denialCode };
  } else {
    template = 'claim.needs_info';
    vars = { ...baseVars, hint: 'Operator review required.' };
  }
  await notifier.notify({
    to: input.to,
    template,
    vars,
    organizationId: input.organizationId,
  });
}
