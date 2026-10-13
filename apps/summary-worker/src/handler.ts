import { createHash } from 'node:crypto';

import {
  audit,
  reserveInferenceRun,
  beginInferenceAttempt,
  saveInferenceReceipt,
  markInferenceApplied,
  markInferenceReviewed,
  getOrgScopedDb,
  type ClaimStatus,
  type InferenceRun,
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
import { z } from 'zod';

import { billingDayUtc, type CostGuard } from './cost-guard.js';
import type { SummaryWorkerEnv } from './env.js';
import { createObservationJobHandler, type ObservationJobConfig } from './observation-handler.js';
import { SummaryInferenceBusyError } from './summary-errors.js';

export { SummaryInferenceBusyError } from './summary-errors.js';

/** Inference ownership and usage commit before the separately retryable summary application. */

export type DbClient = typeof prisma;

export interface SummaryHandlerDeps {
  readonly logger: Logger;
  readonly prisma: DbClient;
  /**
   * Legacy wiring compatibility only; inference ownership is always stored in Postgres.
   */
  readonly redis?: Redis;
  /** Legacy wiring compatibility only; no process or Redis lock governs inference. */
  readonly costGuard?: CostGuard;
  readonly summarizer: SummarizerPort;
  readonly env: SummaryWorkerEnv;
  readonly observationConfig?: ObservationJobConfig;
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

const CapturedRequestSchema = z
  .object({
    claim: z
      .object({
        id: z.string().min(1),
        status: z.enum([
          'PENDING',
          'IN_QUEUE',
          'CALLING',
          'COMPLETED',
          'DENIED',
          'NEEDS_INFO',
          'APPEALING',
          'RESOLVED',
          'WRITTEN_OFF',
          'FAILED',
          'MANUAL_REVIEW',
        ]),
        updatedAt: z.string().datetime(),
        claimNumber: z.string(),
        payerCode: z.string(),
        serviceDate: z.string().datetime(),
      })
      .strict(),
    call: z
      .object({ id: z.string(), createdAt: z.string().datetime(), rawTranscript: z.string() })
      .strict(),
    input: z
      .object({
        organizationId: z.string(),
        callId: z.string(),
        payerCode: z.string(),
        promptVersion: z.string(),
        transcriptTurns: z.array(
          z
            .object({
              role: z.enum(['agent', 'representative', 'system', 'remote', 'source']),
              text: z.string(),
              timestamp: z.string().datetime(),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();
const SavedResultSchema = z
  .object({
    summary: SummaryOutputSchema,
    tokensUsed: z.number().int().nonnegative().nullable(),
    promptVersion: z.string(),
    model: z.string(),
  })
  .strict();
const hash = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const knownTokens = (value: unknown): number | null => {
  if (typeof value === 'bigint')
    return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
};

export function createSummaryJobHandler(deps: SummaryHandlerDeps): SummaryHandler {
  const synthetic = createSyntheticSummaryJobHandler(deps);
  const native = createObservationJobHandler(deps);
  return async (job) => {
    const parsed = SummaryJobDataSchema.safeParse(job.data);
    if (!parsed.success)
      return { summaryId: null, outcome: 'DLQ', tokensUsed: 0, promptVersion: 'unknown' };
    const { organizationId, callId } = parsed.data;
    const run = await deps.prisma.inferenceRun.findFirst({
      where: { organizationId, callId, generation: 1 },
      select: { provider: true },
    });
    if (!run) {
      const summary = await deps.prisma.callSummary.findFirst({
        where: { organizationId, callId },
        select: { id: true },
      });
      if (summary)
        return {
          summaryId: summary.id,
          outcome: 'ALREADY_PROCESSED',
          tokensUsed: 0,
          promptVersion: parsed.data.promptVersion,
        };
    }
    return (run?.provider ?? deps.env.SUMMARY_ANALYSIS_PROVIDER) === 'FIREWORKS'
      ? native(job)
      : synthetic(job);
  };
}

function createSyntheticSummaryJobHandler(deps: SummaryHandlerDeps): SummaryHandler {
  const clock = deps.clock ?? ((): Date => new Date());
  return async function handle(job: SummaryJobLike): Promise<SummaryJobResult> {
    const validated = SummaryJobDataSchema.safeParse(job.data);
    if (!validated.success)
      return { summaryId: null, outcome: 'DLQ', tokensUsed: 0, promptVersion: 'unknown' };
    const data = validated.data;
    const result = (
      outcome: SummaryJobResult['outcome'],
      tokensUsed: number | null = 0,
    ): SummaryJobResult => ({
      summaryId: null,
      outcome,
      tokensUsed,
      promptVersion: data.promptVersion,
    });
    const billingDay = billingDayUtc(clock());
    const orgScoped = getOrgScopedDb(data.organizationId);
    const existingSummary = await orgScoped.callSummary.findFirst({
      where: { callId: data.callId },
    });
    if (existingSummary) return { ...result('ALREADY_PROCESSED'), summaryId: existingSummary.id };
    const existingRun = await deps.prisma.inferenceRun.findFirst({
      where: { organizationId: data.organizationId, callId: data.callId, generation: 1 },
    });
    if (
      existingRun &&
      (existingRun.provider !== 'SYNTHETIC' || existingRun.releaseId !== 'synthetic-summary.v1')
    )
      throw new SummaryInferenceBusyError();
    if (
      deps.summarizer.inference.provider !== 'SYNTHETIC' ||
      deps.summarizer.inference.releaseId !== 'synthetic-summary.v1'
    )
      return result('PROVIDER_DISABLED');
    let captured: z.infer<typeof CapturedRequestSchema>;
    if (existingRun) {
      await audit({
        action: 'inference.snapshot.read',
        resourceType: 'InferenceRun',
        resourceId: existingRun.id,
        organizationId: data.organizationId,
        metadata: { callId: data.callId, generation: existingRun.generation },
      });
      const parsed = CapturedRequestSchema.safeParse(existingRun.requestPayload);
      if (
        !parsed.success ||
        parsed.data.input.organizationId !== data.organizationId ||
        parsed.data.call.id !== data.callId ||
        parsed.data.input.callId !== data.callId ||
        parsed.data.claim.id !== existingRun.claimId
      )
        throw new Error('SUMMARY_SAVED_REQUEST_INVALID');
      captured = parsed.data;
    } else {
      const call = await orgScoped.call.findFirst({ where: { id: data.callId } });
      if (!call) return result('DLQ');
      if (!['COMPLETED', 'FAILED', 'VOICEMAIL'].includes(call.status))
        return result('CALL_NOT_TERMINAL');
      const events = await deps.prisma.callEvent.findMany({
        where: { callId: call.id, call: { organizationId: data.organizationId } },
        orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
      });
      const transcript = selectCallTranscript(events);
      await audit({
        action: 'callSummary.generate.read',
        resourceType: 'Call',
        resourceId: call.id,
        organizationId: data.organizationId,
        metadata: { transcriptTurnCount: transcript.turns.length, jobId: job.id ?? null },
      });
      if (
        transcript.kind === 'provisional' ||
        transcript.kind === 'unavailable' ||
        !transcript.turns.some((turn) => turn.text.trim().length > 0)
      )
        return result('TRANSCRIPT_UNAVAILABLE');
      const claim = await orgScoped.claim.findFirst({ where: { id: call.claimId } });
      if (!claim) return result('DLQ');
      captured = CapturedRequestSchema.parse({
        claim: {
          id: claim.id,
          status: claim.status,
          updatedAt: claim.updatedAt.toISOString(),
          claimNumber: claim.claimNumber,
          payerCode: claim.payerCode,
          serviceDate: claim.serviceDate.toISOString(),
        },
        call: {
          id: call.id,
          createdAt: call.createdAt.toISOString(),
          rawTranscript:
            transcript.rawText ??
            transcript.turns.map((turn) => `[${turn.role}] ${turn.text}`).join('\n'),
        },
        input: {
          organizationId: data.organizationId,
          callId: call.id,
          payerCode: claim.payerCode,
          promptVersion: data.promptVersion,
          transcriptTurns: transcript.turns.map((turn) => ({
            role: turn.role,
            text: turn.text,
            timestamp: turn.observedAt.toISOString(),
          })),
        },
      });
    }
    const claim = {
      ...captured.claim,
      updatedAt: new Date(captured.claim.updatedAt),
      serviceDate: new Date(captured.claim.serviceDate),
    };
    const call = { ...captured.call, createdAt: new Date(captured.call.createdAt) };
    const applyInferenceReview = async (run: InferenceRun): Promise<void> => {
      await deps.prisma.$transaction(async (tx) => {
        if (
          !(await markInferenceReviewed(tx, {
            organizationId: data.organizationId,
            runId: run.id,
            now: clock(),
          }))
        )
          return;
        const transition = SUMMARY_ELIGIBLE_STATUSES.has(claim.status)
          ? await tx.claim.updateMany({
              where: summaryTransitionWhere(claim, call, data.organizationId),
              data: { status: 'MANUAL_REVIEW' },
            })
          : { count: 0 };
        await audit(
          {
            action: run.state === 'REJECTED' ? 'summary.dlq' : 'summary.inference_review_required',
            resourceType: 'Call',
            resourceId: call.id,
            organizationId: data.organizationId,
            metadata: {
              runId: run.id,
              code: run.lastErrorCode,
              transitionApplied: transition.count === 1,
            },
          },
          tx,
        );
      });
    };
    const reservationTokens =
      Buffer.byteLength(JSON.stringify(captured), 'utf8') * 2 +
      deps.env.SUMMARIZER_MAX_OUTPUT_TOKENS;
    const reservationInput = {
      organizationId: data.organizationId,
      callId: call.id,
      claimId: claim.id,
      claimVersion: claim.updatedAt,
      sourceHash: hash({
        rawTranscript: call.rawTranscript,
        turns: captured.input.transcriptTurns,
      }),
      requestHash: hash({
        provider: 'SYNTHETIC',
        releaseId: deps.summarizer.inference.releaseId,
        captured,
      }),
      provider: 'SYNTHETIC' as const,
      releaseId: deps.summarizer.inference.releaseId,
      promptVersion: captured.input.promptVersion,
      requestPayload: captured,
      reservationTokens,
      dailyTokenLimit: deps.env.SUMMARIZER_DAILY_TOKEN_BUDGET,
    };
    let reservation = await reserveInferenceRun(deps.prisma, {
      ...reservationInput,
      now: clock(),
    });
    if (reservation.kind === 'BUSY') throw new SummaryInferenceBusyError();
    if (reservation.kind === 'BUDGET_EXCEEDED') {
      await audit({
        action: 'summary.budget_exceeded',
        resourceType: 'Organization',
        resourceId: data.organizationId,
        organizationId: data.organizationId,
        metadata: { billingDay, tokensBudget: deps.env.SUMMARIZER_DAILY_TOKEN_BUDGET },
      });
      return result('BUDGET_EXCEEDED');
    }
    if (reservation.kind === 'NOT_FOUND') return result('DLQ');
    if (reservation.kind === 'ALREADY_APPLIED')
      return { ...result('ALREADY_PROCESSED'), summaryId: reservation.run?.summaryId ?? null };
    if (reservation.kind === 'REVIEW_REQUIRED') {
      if (!reservation.run) throw new Error('SUMMARY_REVIEW_RUN_MISSING');
      await applyInferenceReview(reservation.run);
      return result('INFERENCE_REVIEW_REQUIRED', knownTokens(reservation.run.totalTokens));
    }
    if (reservation.kind === 'OWNED') {
      if (
        !(await beginInferenceAttempt(deps.prisma, {
          organizationId: data.organizationId,
          runId: reservation.run.id,
          leaseToken: reservation.leaseToken,
          now: clock(),
        }))
      )
        throw new SummaryInferenceBusyError();
      const receiptIdentity = {
        organizationId: data.organizationId,
        runId: reservation.run.id,
        leaseToken: reservation.leaseToken,
      };
      let invocation;
      try {
        const input: SummarizeInput = {
          ...captured.input,
          transcriptTurns: captured.input.transcriptTurns.map((turn) => ({
            ...turn,
            timestamp: new Date(turn.timestamp),
          })),
        };
        invocation = await deps.summarizer.summarize(input);
      } catch (error) {
        const usage =
          error instanceof SummaryValidationError ? knownTokens(error.tokensUsed) : null;
        const receipt = await saveInferenceReceipt(deps.prisma, {
          ...receiptIdentity,
          outcome: error instanceof SummaryValidationError ? 'REJECTED' : 'UNKNOWN',
          resultPayload: null,
          tokensUsed: usage,
          errorCode:
            error instanceof SummaryValidationError ? 'OUTPUT_SCHEMA_INVALID' : 'PROVIDER_ERROR',
          now: clock(),
        });
        await applyInferenceReview(receipt);
        if (!(error instanceof SummaryValidationError))
          return result('INFERENCE_REVIEW_REQUIRED', null);
        return result('DLQ', usage);
      }
      const usage = knownTokens(invocation.tokensUsed);
      const parsed = SavedResultSchema.safeParse({ ...invocation, tokensUsed: usage });
      if (
        !parsed.success ||
        invocation.promptVersion !== captured.input.promptVersion ||
        usage === null ||
        BigInt(usage) > reservation.run.tokenAllowance
      ) {
        const errorCode =
          usage === null
            ? 'USAGE_UNKNOWN'
            : BigInt(usage) > reservation.run.tokenAllowance
              ? 'TOKEN_BOUND_EXCEEDED'
              : 'OUTPUT_SCHEMA_INVALID';
        const receipt = await saveInferenceReceipt(deps.prisma, {
          ...receiptIdentity,
          outcome: usage === null ? 'UNKNOWN' : 'REJECTED',
          resultPayload: null,
          tokensUsed: usage,
          errorCode,
          now: clock(),
        });
        await applyInferenceReview(receipt);
        if (usage === null) return result('INFERENCE_REVIEW_REQUIRED', null);
        return result('DLQ', usage);
      }
      await saveInferenceReceipt(deps.prisma, {
        ...receiptIdentity,
        outcome: 'VALIDATED',
        resultPayload: parsed.data,
        tokensUsed: usage,
        errorCode: null,
        now: clock(),
      });
      reservation = await reserveInferenceRun(deps.prisma, { ...reservationInput, now: clock() });
      if (reservation.kind === 'ALREADY_APPLIED')
        return { ...result('ALREADY_PROCESSED'), summaryId: reservation.run?.summaryId ?? null };
    }
    if (reservation.kind !== 'RESUME') throw new SummaryInferenceBusyError();
    const saved = SavedResultSchema.safeParse(reservation.run.resultPayload);
    if (!saved.success) throw new Error('SUMMARY_SAVED_RESULT_INVALID');
    const summarizeResult = saved.data;
    const applicationOwnership = {
      runId: reservation.run.id,
      leaseToken: reservation.leaseToken,
    };
    const policy = applyTransitionPolicy({
      autoTransitionEnabled: deps.env.SUMMARIZER_AUTO_TRANSITION_ENABLED,
      confidence: summarizeResult.summary.confidence,
      nextAction: summarizeResult.summary.nextAction,
      currentStatus: claim.status,
      denialCode: summarizeResult.summary.denialCode,
    });

    // Receipt/usage already committed; only application and its effects share this transaction.
    const { summary, transitionApplied } = await deps.prisma.$transaction(async (tx) => {
      // Match ledger/review lock order before child inserts or claim updates.
      const organizations = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Organization" WHERE "id" = ${data.organizationId} FOR NO KEY UPDATE
      `;
      if (organizations.length !== 1) throw new Error('SUMMARY_ORGANIZATION_MISSING');
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
          rawTranscript: captured.call.rawTranscript,
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
      await markInferenceApplied(tx, {
        organizationId: data.organizationId,
        ...applicationOwnership,
        summaryId: summary.id,
        now: clock(),
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
  };
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
