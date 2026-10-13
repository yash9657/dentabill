import { randomUUID } from 'node:crypto';

import { audit, type Call, type CallIntent, type Prisma } from '@dentabill/db';
import {
  RetellEventSchema,
  type RetellCallCandidate,
  type RetellCallEndedEvent,
  type RetellReconciliationClient,
  type StartCallInput,
} from '@dentabill/payer-ivr';

import { getCallIntentSnapshot, matchesCallCandidate } from './call-provider-evidence.js';
import type { DbClient } from './handler.js';
import { enqueueJobOutbox } from './job-outbox.js';

const SUBMISSION_GRACE_MS = 60_000;
const CHECK_INTERVAL_MS = 60_000;
const LEASE_MS = 60_000;
const LOOKUP_MS = 25_000;

export type CallReconciliationOutcome =
  | 'RECOVERED'
  | 'ALREADY_BOUND'
  | 'NO_MATCH'
  | 'REVIEW_REQUIRED'
  | 'LOOKUP_FAILED'
  | 'NOT_READY'
  | 'IN_PROGRESS'
  | 'NOT_FOUND';

export interface CallReconciliationResult {
  readonly outcome: CallReconciliationOutcome;
  readonly callId: string | null;
}

type EligibilityIntent = Pick<
  CallIntent,
  'state' | 'callId' | 'submittedAt' | 'reconcileAvailableAt' | 'reconcileLeaseExpiresAt'
>;

export function getCallIntentReconciliationEligibility(
  intent: EligibilityIntent,
  now: Date = new Date(),
): { canCheck: boolean; nextCheckAt: Date | null } {
  if (intent.callId !== null || !['SUBMITTING', 'UNKNOWN'].includes(intent.state)) {
    return { canCheck: false, nextCheckAt: null };
  }
  if (intent.state === 'SUBMITTING' && intent.submittedAt === null) {
    return { canCheck: false, nextCheckAt: null };
  }
  const next = Math.max(
    intent.state === 'SUBMITTING' && intent.submittedAt
      ? intent.submittedAt.getTime() + SUBMISSION_GRACE_MS
      : 0,
    intent.reconcileAvailableAt?.getTime() ?? 0,
    intent.reconcileLeaseExpiresAt?.getTime() ?? 0,
  );
  return {
    canCheck: next <= now.getTime(),
    nextCheckAt: next > now.getTime() ? new Date(next) : null,
  };
}

export interface ReconcileCallIntentOptions {
  readonly prisma: DbClient;
  readonly provider: RetellReconciliationClient;
  readonly organizationId: string;
  readonly intentId: string;
  readonly clerkUserId: string;
  readonly clock?: () => Date;
}

type LookupResult =
  | { outcome: 'NO_MATCH' | 'REVIEW_REQUIRED' | 'LOOKUP_FAILED' }
  | {
      outcome: 'RECOVERED';
      candidate: RetellCallCandidate;
      terminalEvent: RetellCallEndedEvent | null;
    };

async function lookup(
  provider: RetellReconciliationClient,
  snapshot: StartCallInput,
): Promise<LookupResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async (): Promise<LookupResult> => {
        const candidates = await provider.findCallsByIntent({
          intentId: snapshot.idempotencyKey,
          signal: controller.signal,
        });
        if (candidates.length === 0) return { outcome: 'NO_MATCH' };
        const candidate = candidates[0];
        if (candidates.length !== 1 || !candidate || !matchesCallCandidate(candidate, snapshot)) {
          return { outcome: 'REVIEW_REQUIRED' };
        }
        const detail = await provider.getCall({
          providerCallId: candidate.providerCallId,
          signal: controller.signal,
        });
        if (
          detail.candidate.providerCallId !== candidate.providerCallId ||
          !matchesCallCandidate(detail.candidate, snapshot)
        ) {
          return { outcome: 'REVIEW_REQUIRED' };
        }
        let terminalEvent: RetellCallEndedEvent | null = null;
        if (detail.terminalEvent !== null) {
          const parsed = RetellEventSchema.safeParse(detail.terminalEvent);
          if (
            !parsed.success ||
            parsed.data.type !== 'call.ended' ||
            parsed.data.retellCallId !== candidate.providerCallId
          ) {
            return { outcome: 'REVIEW_REQUIRED' };
          }
          terminalEvent = parsed.data;
        }
        return { outcome: 'RECOVERED', candidate: detail.candidate, terminalEvent };
      })(),
      new Promise<LookupResult>((resolve) => {
        timer = setTimeout(() => {
          resolve({ outcome: 'LOOKUP_FAILED' });
          controller.abort();
        }, LOOKUP_MS);
      }),
    ]);
  } catch {
    // Provider errors and transcripts never enter audit/log metadata or API errors.
    return { outcome: 'LOOKUP_FAILED' };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}

/** Recover a positive provider identity match without ever issuing a create-call request. */
export async function reconcileCallIntent(
  options: ReconcileCallIntentOptions,
): Promise<CallReconciliationResult> {
  try {
    return await reconcile(options);
  } catch {
    // Prisma diagnostics can include the request snapshot or a final transcript.
    throw new Error('Call reconciliation could not be saved.');
  }
}

async function reconcile(options: ReconcileCallIntentOptions): Promise<CallReconciliationResult> {
  const { prisma, organizationId, intentId, clerkUserId, provider } = options;
  if (!organizationId || !intentId || !clerkUserId) throw new Error('Invalid recovery scope.');
  const clock = options.clock ?? ((): Date => new Date());
  const scope = { id: intentId, organizationId };
  const resultNow = async (): Promise<CallReconciliationResult> => {
    const current = await prisma.callIntent.findFirst({ where: scope });
    if (!current) return { outcome: 'NOT_FOUND', callId: null };
    if (current.callId && ['ACCEPTED', 'TERMINAL'].includes(current.state)) {
      return { outcome: 'ALREADY_BOUND', callId: current.callId };
    }
    return {
      outcome:
        current.reconcileLeaseExpiresAt && current.reconcileLeaseExpiresAt > clock()
          ? 'IN_PROGRESS'
          : 'NOT_READY',
      callId: null,
    };
  };
  const intent = await prisma.callIntent.findFirst({ where: scope });
  if (!intent || !getCallIntentReconciliationEligibility(intent, clock()).canCheck)
    return resultNow();
  const token = randomUUID();
  const now = clock();
  const owned = await prisma.$transaction(async (tx) => {
    const leased = await tx.callIntent.updateMany({
      where: {
        ...scope,
        callId: null,
        AND: [
          {
            OR: [
              { state: 'UNKNOWN' },
              {
                state: 'SUBMITTING',
                submittedAt: { lte: new Date(now.getTime() - SUBMISSION_GRACE_MS) },
              },
            ],
          },
          { OR: [{ reconcileAvailableAt: null }, { reconcileAvailableAt: { lte: now } }] },
          { OR: [{ reconcileLeaseExpiresAt: null }, { reconcileLeaseExpiresAt: { lte: now } }] },
        ],
      },
      data: {
        reconcileLeaseToken: token,
        reconcileLeaseExpiresAt: new Date(now.getTime() + LEASE_MS),
        reconcileAttempts: { increment: 1 },
      },
    });
    if (leased.count === 0) return null;
    await audit(
      {
        organizationId,
        action: 'call.intent.reconciliation.started',
        resourceType: 'CallIntent',
        resourceId: intentId,
        metadata: { clerkUserId },
      },
      tx,
    );
    return tx.callIntent.findFirstOrThrow({ where: scope });
  });
  if (!owned) return resultNow();
  const snapshot = getCallIntentSnapshot(owned);
  const found: LookupResult = snapshot
    ? await lookup(provider, snapshot)
    : { outcome: 'REVIEW_REQUIRED' };
  const ownedWhere = (): Prisma.CallIntentWhereInput => ({
    ...scope,
    state: { in: ['SUBMITTING', 'UNKNOWN'] },
    callId: null,
    requestHash: owned.requestHash,
    reconcileLeaseToken: token,
    reconcileLeaseExpiresAt: { gt: clock() },
  });
  const finish = async (
    outcome: 'NO_MATCH' | 'REVIEW_REQUIRED' | 'LOOKUP_FAILED',
  ): Promise<CallReconciliationResult> => {
    const finished = await prisma.$transaction(async (tx) => {
      const changed = await tx.callIntent.updateMany({
        where: ownedWhere(),
        data: {
          reconciledAt: clock(),
          reconcileOutcome: outcome,
          reconcileAvailableAt: new Date(clock().getTime() + CHECK_INTERVAL_MS),
          reconcileLeaseToken: null,
          reconcileLeaseExpiresAt: null,
        },
      });
      if (changed.count === 0) return false;
      await audit(
        {
          organizationId,
          action: 'call.intent.reconciliation.checked',
          resourceType: 'CallIntent',
          resourceId: intentId,
          metadata: { clerkUserId, outcome },
        },
        tx,
      );
      return true;
    });
    return finished ? { outcome, callId: null } : resultNow();
  };
  if (found.outcome !== 'RECOVERED') return finish(found.outcome);
  try {
    const recovered = await prisma.$transaction(async (tx) => {
      const acquired = await tx.callIntent.updateMany({
        where: ownedWhere(),
        data: {
          state: 'ACCEPTED',
          reconciledAt: clock(),
          reconcileOutcome: 'RECOVERED',
          reconcileAvailableAt: null,
          reconcileLeaseToken: null,
          reconcileLeaseExpiresAt: null,
          lastErrorCode: null,
        },
      });
      let call: Call;
      const outcome = acquired.count === 1 ? 'RECOVERED' : 'ALREADY_BOUND';
      if (acquired.count === 1) {
        call = await tx.call.create({
          data: {
            organizationId,
            claimId: owned.claimId,
            retellCallId: found.candidate.providerCallId,
            retellAgentId: found.candidate.agentId,
            attemptNumber: owned.attemptNumber,
            status: 'INITIATED',
            startedAt:
              found.candidate.startedAt === null ? null : new Date(found.candidate.startedAt),
          },
        });
        await tx.callIntent.updateMany({ where: scope, data: { callId: call.id } });
      } else {
        // The original create response can bind while this read-only lookup is in flight.
        // Preserve its call, but do not lose verified terminal evidence while we still own the lease.
        const boundWhere: Prisma.CallIntentWhereInput = {
          ...scope,
          state: { in: ['ACCEPTED', 'TERMINAL'] },
          requestHash: owned.requestHash,
          reconcileLeaseToken: token,
          reconcileLeaseExpiresAt: { gt: clock() },
          call: {
            organizationId,
            claimId: owned.claimId,
            retellCallId: found.candidate.providerCallId,
          },
        };
        const bound = await tx.callIntent.findFirst({ where: boundWhere, include: { call: true } });
        if (!bound?.call) return null;
        const confirmed = await tx.callIntent.updateMany({
          where: { ...boundWhere, callId: bound.call.id },
          data: {
            reconciledAt: clock(),
            reconcileOutcome: 'ALREADY_BOUND',
            reconcileAvailableAt: null,
            reconcileLeaseToken: null,
            reconcileLeaseExpiresAt: null,
          },
        });
        if (confirmed.count === 0) return null;
        call = bound.call;
      }
      const acceptedScope = { ...scope, state: 'ACCEPTED' as const, callId: call.id };
      // Preserve an existing deadline, including one saved while lookup was in flight.
      // Both the deadline and the observation obligation commit with the binding/outbox.
      await tx.callIntent.updateMany({
        where: { ...acceptedScope, callDeadlineAt: null },
        data: {
          callDeadlineAt: new Date(
            (owned.submittedAt ?? owned.createdAt).getTime() + (snapshot?.maxDurationMs ?? 900_000),
          ),
        },
      });
      await tx.callIntent.updateMany({
        where: acceptedScope,
        data: { nextObservationAt: clock() },
      });
      if (found.terminalEvent) {
        await tx.callEvent.create({
          data: {
            callId: call.id,
            eventType: 'call.ended',
            data: {
              ...found.terminalEvent,
              source: 'retell_get_call',
              retrievedAt: clock().toISOString(),
            } as Prisma.InputJsonValue,
          },
        });
      }
      await enqueueJobOutbox(tx, {
        organizationId,
        kind: 'CALL_PLACE',
        availableAt: clock(),
        data: {
          organizationId,
          claimId: owned.claimId,
          payerCode: owned.payerCode,
          attemptNumber: owned.attemptNumber,
          claimPriority: owned.claimPriority,
          idempotencyKey: `call.resume.${intentId}`,
          resume: { intentId, callId: call.id },
        },
      });
      await audit(
        {
          organizationId,
          action: 'call.intent.reconciled',
          resourceType: 'CallIntent',
          resourceId: intentId,
          metadata: {
            clerkUserId,
            callId: call.id,
            outcome,
            source: 'retell_get_call',
          },
        },
        tx,
      );
      return { outcome, callId: call.id } satisfies CallReconciliationResult;
    });
    return recovered ?? (await resultNow());
  } catch (error) {
    // A provider ID already bound anywhere must never be attached to another intent/tenant.
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      return finish('REVIEW_REQUIRED');
    }
    throw error;
  }
}
