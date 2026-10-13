import { randomUUID } from 'node:crypto';

import { audit, type Call, type ClaimStatus, type Prisma } from '@dentabill/db';
import {
  reconcileRetellWebhookInbox,
  RetellEventSchema,
  type RetellCallEndedEvent,
  type RetellPort,
  type RetellReconciliationClient,
} from '@dentabill/payer-ivr';
import type { CallJobResult } from '@dentabill/queue';

import { getCallIntentSnapshot, matchesCallCandidate } from './call-provider-evidence.js';
import type { DbClient } from './handler.js';
import { enqueueJobOutbox } from './job-outbox.js';

const CHECK_MS = 30_000;
const STOP_BACKOFF_MS = 60_000;
const CONFIRMATION_MS = 300_000;
const MAX_STOPS = 3;
const REQUEST_MS = 10_000;

export interface ObserveAcceptedCallOptions {
  readonly prisma: DbClient;
  readonly organizationId: string;
  readonly intentId: string;
  readonly provider: RetellReconciliationClient | null;
  readonly retellPort: RetellPort;
  readonly clock?: () => Date;
  readonly waitMs?: number;
  readonly readOnly?: boolean;
  readonly forceRead?: boolean;
  readonly clerkUserId?: string;
  /** Only for a synthetic call started by this handler invocation, never a scheduled recovery. */
  readonly allowSyntheticStop?: boolean;
}

async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Call observation request timed out.'));
        }, REQUEST_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}

/** One lease-fenced observation step; never creates a provider call. */
export async function observeAcceptedCall(
  options: ObserveAcceptedCallOptions,
): Promise<CallJobResult> {
  const { prisma, organizationId, intentId, retellPort, provider } = options;
  const clock = options.clock ?? (() => new Date());
  const waitMs = Math.min(90_000, Math.max(0, options.waitMs ?? 0));
  const scope = { id: intentId, organizationId };
  const intent = await prisma.callIntent.findFirst({ where: scope, include: { call: true } });
  const call = intent?.call;
  const result = (
    outcome: CallJobResult['outcome'],
    durationSeconds: number | null = null,
  ): CallJobResult => ({
    callId: call?.id ?? null,
    retellCallId: call?.retellCallId ?? null,
    outcome,
    durationSeconds,
  });
  if (!intent || call?.organizationId !== organizationId || call.claimId !== intent.claimId)
    return result('BLOCKED');
  if (intent.state === 'TERMINAL') return result('ALREADY_PROCESSED', call.durationSeconds);
  if (intent.state !== 'ACCEPTED') return result('BLOCKED');

  const snapshot = getCallIntentSnapshot(intent);
  const now = clock();
  const deadline =
    intent.callDeadlineAt ??
    new Date(
      (intent.submittedAt ?? call.createdAt).getTime() + (snapshot?.maxDurationMs ?? 900_000),
    );
  const token = randomUUID();
  const leaseExpires = new Date(now.getTime() + Math.max(60_000, waitMs + 30_000));
  const acquired = await prisma.callIntent.updateMany({
    where: {
      ...scope,
      state: 'ACCEPTED',
      callId: call.id,
      OR: [{ observationLeaseExpiresAt: null }, { observationLeaseExpiresAt: { lte: now } }],
    },
    data: {
      observationLeaseToken: token,
      observationLeaseExpiresAt: leaseExpires,
      observationAttempts: { increment: 1 },
      callDeadlineAt: deadline,
      nextObservationAt: intent.nextObservationAt ?? now,
    },
  });
  if (acquired.count !== 1) return result('RESCHEDULED');
  const owned = (): Prisma.CallIntentWhereInput => ({
    ...scope,
    state: 'ACCEPTED',
    callId: call.id,
    requestHash: intent.requestHash,
    observationLeaseToken: token,
    observationLeaseExpiresAt: { gt: clock() },
  });
  let errorCode: string | null = null;
  let review = intent.observationReviewAt;
  let active = true;
  let chain = Promise.resolve();
  let unsubscribe = (): void => {
    /* assigned after lease acquisition */
  };

  const finish = async (
    ended: RetellCallEndedEvent,
    source?: 'retell_get_call',
  ): Promise<CallJobResult> => {
    const claimStatus = endReasonToClaimStatus(ended);
    const committed = await prisma.$transaction(async (tx) => {
      const changed = await tx.callIntent.updateMany({
        where: owned(),
        data: {
          state: 'TERMINAL',
          completedAt: clock(),
          lastObservedAt: clock(),
          observationLeaseToken: null,
          observationLeaseExpiresAt: null,
          nextObservationAt: null,
          observationErrorCode: null,
          observationReviewAt: null,
        },
      });
      if (changed.count !== 1) return false;
      if (source)
        await tx.callEvent.create({
          data: {
            callId: call.id,
            eventType: 'call.ended',
            data: { ...ended, source, retrievedAt: clock().toISOString() } as Prisma.InputJsonValue,
          },
        });
      await tx.call.updateMany({
        where: {
          id: call.id,
          organizationId,
          status: { notIn: ['COMPLETED', 'FAILED', 'VOICEMAIL'] },
        },
        data: {
          status: endReasonToCallStatus(ended.endReason),
          endedAt: ended.endedAt === null ? null : new Date(ended.endedAt),
          durationSeconds: ended.durationSeconds,
        },
      });
      const transition = await tx.claim.updateMany({
        where: {
          id: intent.claimId,
          organizationId,
          status: 'CALLING',
          updatedAt: intent.claimVersion,
          calls: { none: { createdAt: { gt: call.createdAt } } },
        },
        data: { status: claimStatus },
      });
      await audit(
        {
          action: 'call.end',
          resourceType: 'Call',
          resourceId: call.id,
          organizationId,
          metadata: {
            ...(options.clerkUserId ? { clerkUserId: options.clerkUserId } : {}),
            claimId: intent.claimId,
            intentId,
            providerCallStatus: endReasonToCallStatus(ended.endReason),
            proposedClaimStatus: claimStatus,
            claimTransitionApplied: transition.count === 1,
            durationSeconds: ended.durationSeconds,
            endReason: ended.endReason,
          },
        },
        tx,
      );
      await enqueueJobOutbox(tx, {
        organizationId,
        kind: 'SUMMARY_GENERATE',
        data: {
          organizationId,
          callId: call.id,
          promptVersion: 'v1',
          idempotencyKey: `call.${call.id}`,
        },
      });
      return true;
    });
    return result(
      committed
        ? claimStatus === 'MANUAL_REVIEW'
          ? 'ESCALATED'
          : 'COMPLETED'
        : 'ALREADY_PROCESSED',
      ended.durationSeconds,
    );
  };

  const persistedEnd = async (): Promise<RetellCallEndedEvent | null> => {
    await reconcileRetellWebhookInbox(prisma, {
      organizationId,
      callId: call.id,
      retellCallId: call.retellCallId,
    });
    const events = await prisma.callEvent.findMany({
      where: {
        callId: call.id,
        call: { organizationId },
        eventType: { in: ['call.ended', 'webhook.call.ended'] },
      },
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    for (const event of events) {
      const parsed = RetellEventSchema.safeParse(event.data);
      if (
        parsed.success &&
        parsed.data.type === 'call.ended' &&
        parsed.data.retellCallId === call.retellCallId
      )
        return parsed.data;
    }
    return null;
  };

  let stopAttempted = false;
  let stop = await prisma.callIntent.findFirstOrThrow({ where: scope });
  const checkStop = async (): Promise<void> => {
    if (stopAttempted || options.readOnly || errorCode === 'PROVIDER_IDENTITY_MISMATCH') return;
    const row = await prisma.call.findFirst({
      where: { id: call.id, organizationId },
      select: { cancelRequestedAt: true },
    });
    if (!row?.cancelRequestedAt && !stop.stopRequestedAt && clock() < deadline) return;
    if (!snapshot) {
      errorCode = 'INVALID_REQUEST_SNAPSHOT';
      review ??= clock();
      return;
    }
    if (!provider && !options.allowSyntheticStop) {
      errorCode = 'STOP_UNAVAILABLE';
      review ??= clock();
      return;
    }
    if (stop.stopConfirmationDeadlineAt && clock() >= stop.stopConfirmationDeadlineAt) {
      errorCode = 'STOP_CONFIRMATION_EXPIRED';
      review ??= clock();
      return;
    }
    if (stop.stopAttempts >= MAX_STOPS) {
      errorCode = 'STOP_ATTEMPTS_EXHAUSTED';
      review ??= clock();
      return;
    }
    if (
      stop.stopLastAttemptAt &&
      clock().getTime() < stop.stopLastAttemptAt.getTime() + STOP_BACKOFF_MS
    )
      return;
    stopAttempted = true;
    const reason =
      stop.stopReason === 'operator_cancel' || row?.cancelRequestedAt
        ? 'operator_cancel'
        : 'duration_cap_exceeded';
    const requestedAt = stop.stopRequestedAt ?? clock();
    const attemptedAt = clock();
    const changed = await prisma.callIntent.updateMany({
      where: { ...owned(), stopAttempts: stop.stopAttempts },
      data: {
        stopRequestedAt: requestedAt,
        stopReason: reason,
        stopConfirmationDeadlineAt:
          stop.stopConfirmationDeadlineAt ?? new Date(requestedAt.getTime() + CONFIRMATION_MS),
        stopAttempts: { increment: 1 },
        stopLastAttemptAt: attemptedAt,
        nextObservationAt: new Date(attemptedAt.getTime() + CHECK_MS),
      },
    });
    if (changed.count !== 1) return;
    // The durable attempt precedes the network action; lost ACKs remain ambiguous.
    const currentOwner = await prisma.callIntent.findFirst({ where: owned() });
    if (!currentOwner) return;
    stop = currentOwner;
    try {
      await bounded(() => retellPort.endCall({ retellCallId: call.retellCallId, reason }));
      await prisma.callIntent.updateMany({ where: owned(), data: { stopAcknowledgedAt: clock() } });
    } catch {
      errorCode = 'STOP_FAILED';
    }
  };

  try {
    unsubscribe = retellPort.subscribe(call.retellCallId, (event) => {
      chain = chain
        .then(async () => {
          if (!active || event.retellCallId !== call.retellCallId) return;
          const parsed = RetellEventSchema.safeParse(event);
          if (!parsed.success) return;
          await prisma.$transaction(async (tx) => {
            const lock = await tx.callIntent.updateMany({
              where: owned(),
              data: { lastObservedAt: clock() },
            });
            if (lock.count !== 1) return;
            await tx.callEvent.create({
              data: {
                callId: call.id,
                eventType: parsed.data.type,
                data: parsed.data as Prisma.InputJsonValue,
              },
            });
            if (parsed.data.type === 'call.transcript')
              await tx.call.updateMany({
                where: {
                  id: call.id,
                  organizationId,
                  status: { notIn: ['COMPLETED', 'FAILED', 'VOICEMAIL'] },
                },
                data: { status: 'NAVIGATING_IVR' },
              });
          });
        })
        .catch(() => {
          errorCode = 'OBSERVATION_FAILED';
        });
      return chain;
    });
    await chain;
    let ended = await persistedEnd();
    if (ended) return await finish(ended);
    const expired =
      stop.stopConfirmationDeadlineAt !== null && clock() >= stop.stopConfirmationDeadlineAt;
    if (expired) {
      errorCode = 'STOP_CONFIRMATION_EXPIRED';
      review ??= clock();
    }
    if (!snapshot) {
      errorCode = 'INVALID_REQUEST_SNAPSHOT';
      review ??= clock();
    } else if (!expired || options.forceRead) {
      if (provider) {
        try {
          const detail = await bounded((signal) =>
            provider.getCall({ providerCallId: call.retellCallId, signal }),
          );
          if (
            detail.candidate.providerCallId !== call.retellCallId ||
            !matchesCallCandidate(detail.candidate, snapshot)
          ) {
            errorCode = 'PROVIDER_IDENTITY_MISMATCH';
            review ??= clock();
          } else if (detail.terminalEvent) {
            const parsed = RetellEventSchema.safeParse(detail.terminalEvent);
            if (
              parsed.success &&
              parsed.data.type === 'call.ended' &&
              parsed.data.retellCallId === call.retellCallId
            )
              return await finish(parsed.data, 'retell_get_call');
            errorCode = 'PROVIDER_LOOKUP_FAILED';
          }
        } catch {
          errorCode = 'PROVIDER_LOOKUP_FAILED';
        }
      } else if (!options.allowSyntheticStop) {
        errorCode = 'PROVIDER_LOOKUP_UNAVAILABLE';
        review ??= clock();
      }
    }
    const until = performance.now() + waitMs;
    do {
      await chain;
      ended = await persistedEnd();
      if (ended) return await finish(ended);
      await checkStop();
      await chain;
      ended = await persistedEnd();
      if (ended) return await finish(ended);
      if (performance.now() >= until) break;
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(250, Math.max(0, until - performance.now()))),
      );
    } while (performance.now() < until);
  } catch {
    errorCode = 'OBSERVATION_FAILED';
  } finally {
    active = false;
    unsubscribe();
    await chain;
  }

  const changed = await prisma.callIntent.updateMany({
    where: owned(),
    data: {
      observationLeaseToken: null,
      observationLeaseExpiresAt: null,
      lastObservedAt: clock(),
      observationErrorCode: errorCode,
      observationReviewAt: review,
      nextObservationAt: new Date(clock().getTime() + (review ? CONFIRMATION_MS : CHECK_MS)),
    },
  });
  if (changed.count !== 1) return result('RESCHEDULED');
  return result(review ? 'RECONCILIATION_REQUIRED' : 'RESCHEDULED');
}

export interface SweepDueAcceptedCallsOptions {
  readonly prisma: DbClient;
  readonly provider: RetellReconciliationClient | null;
  readonly retellPort: RetellPort;
  readonly limit?: number;
  readonly budgetMs?: number;
  readonly clock?: () => Date;
}
export interface CallObservationSweepResult {
  selected: number;
  observed: number;
  terminal: number;
  rescheduled: number;
  stopRequested: number;
  failed: number;
}

/** Trusted scheduler scan only; all subsequent reads/writes are scoped to the selected tenant. */
export async function sweepDueAcceptedCalls(
  options: SweepDueAcceptedCallsOptions,
): Promise<CallObservationSweepResult> {
  const clock = options.clock ?? (() => new Date());
  const started = performance.now();
  const budget = Math.max(0, Math.min(25_000, options.budgetMs ?? 25_000));
  const now = clock();
  const rows = await options.prisma.callIntent.findMany({
    where: {
      state: 'ACCEPTED',
      callId: { not: null },
      AND: [
        { OR: [{ nextObservationAt: null }, { nextObservationAt: { lte: now } }] },
        { OR: [{ observationLeaseExpiresAt: null }, { observationLeaseExpiresAt: { lte: now } }] },
      ],
    },
    orderBy: [{ nextObservationAt: { sort: 'asc', nulls: 'first' } }, { id: 'asc' }],
    take: Math.max(1, Math.min(5, options.limit ?? 5)),
    select: { id: true, organizationId: true, stopAttempts: true },
  });
  const counts: CallObservationSweepResult = {
    selected: rows.length,
    observed: 0,
    terminal: 0,
    rescheduled: 0,
    stopRequested: 0,
    failed: 0,
  };
  for (const row of rows) {
    if (budget - (performance.now() - started) < REQUEST_MS * 2) break;
    try {
      const observed = await observeAcceptedCall({
        ...options,
        organizationId: row.organizationId,
        intentId: row.id,
        waitMs: 0,
      });
      counts.observed++;
      if (observed.outcome === 'COMPLETED' || observed.outcome === 'ESCALATED') counts.terminal++;
      else if (observed.outcome === 'RESCHEDULED') counts.rescheduled++;
      else if (observed.outcome === 'RECONCILIATION_REQUIRED' || observed.outcome === 'BLOCKED')
        counts.failed++;
      const current = await options.prisma.callIntent.findFirst({
        where: { id: row.id, organizationId: row.organizationId },
        select: { stopAttempts: true },
      });
      if (current && current.stopAttempts > row.stopAttempts) counts.stopRequested++;
    } catch {
      counts.failed++;
    }
  }
  return counts;
}

function endReasonToCallStatus(reason: RetellCallEndedEvent['endReason']): Call['status'] {
  if (reason === 'completed' || reason === 'agent_hangup' || reason === 'user_hangup')
    return 'COMPLETED';
  if (reason === 'no_answer' || reason === 'busy' || reason === 'voicemail') return 'VOICEMAIL';
  return 'FAILED';
}
function endReasonToClaimStatus(ended: RetellCallEndedEvent): ClaimStatus {
  if (['no_answer', 'busy', 'voicemail', 'error'].includes(ended.endReason)) return 'MANUAL_REVIEW';
  const status = ended.collectedInfo?.claimStatus;
  return typeof status === 'string' && status.toLowerCase() === 'denied' ? 'DENIED' : 'COMPLETED';
}
