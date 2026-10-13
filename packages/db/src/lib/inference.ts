import { createHash, randomUUID } from 'node:crypto';

import { Prisma, type InferenceRun } from '@prisma/client';

import type { prisma } from '../client.js';

import { audit } from './audit.js';

type Db = typeof prisma;
type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];
const LEASE_MS = 60_000;
const MAX_PAYLOAD_BYTES = 1_048_576;
const MAX_TOKENS = 1_000_000_000;

export type InferenceErrorCode =
  | 'OUTPUT_SCHEMA_INVALID'
  | 'PROVIDER_ERROR'
  | 'USAGE_UNKNOWN'
  | 'REQUEST_BINDING_CHANGED'
  | 'RESPONSE_UNKNOWN'
  | 'TOKEN_BOUND_EXCEEDED';

export interface ReserveInferenceInput {
  organizationId: string;
  callId: string;
  claimId: string;
  claimVersion: Date;
  sourceHash: string;
  requestHash: string;
  provider: 'SYNTHETIC' | 'FIREWORKS';
  releaseId: string;
  promptVersion: string;
  requestPayload: Prisma.InputJsonValue;
  reservationTokens: number;
  dailyTokenLimit: number;
  now?: Date;
}

export type InferenceReservation =
  | { kind: 'OWNED' | 'RESUME'; run: InferenceRun; leaseToken: string }
  | {
      kind: 'BUSY' | 'REVIEW_REQUIRED' | 'ALREADY_APPLIED' | 'BUDGET_EXCEEDED' | 'NOT_FOUND';
      run: InferenceRun | null;
    };

export interface InferenceOwnership {
  organizationId: string;
  runId: string;
  leaseToken: string;
  now?: Date;
}

export interface InferenceReceiptInput extends InferenceOwnership {
  outcome: 'VALIDATED' | 'REJECTED' | 'UNKNOWN';
  resultPayload: Prisma.InputJsonValue | null;
  tokensUsed: number | null;
  errorCode: InferenceErrorCode | null;
}

function fail(): never {
  throw new Error('INFERENCE_LEDGER_CONFLICT');
}

function clock(now?: Date): Date {
  const value = now ?? new Date();
  if (!Number.isFinite(value.getTime())) fail();
  return value;
}

function day(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function tokenCount(value: number, positive = false, maximum = MAX_TOKENS): void {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0) || value > maximum) fail();
}

function boundedJson(value: Prisma.InputJsonValue): string {
  // Iterative validation also rejects cyclic/non-JSON data without echoing it in errors.
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  const seen = new Set<object>();
  let nodes = 0;
  while (stack.length) {
    const entry = stack.pop();
    if (!entry || ++nodes > 100_000 || entry.depth > 32) fail();
    const v = entry.value;
    if (v === null || typeof v === 'boolean' || typeof v === 'string') continue;
    if (typeof v === 'number' && Number.isFinite(v)) continue;
    if (typeof v !== 'object' || seen.has(v)) fail();
    seen.add(v);
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype) fail();
    for (const item of Object.values(v)) stack.push({ value: item, depth: entry.depth + 1 });
  }
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') > MAX_PAYLOAD_BYTES) fail();
  return json;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function lockOrg(tx: Tx, organizationId: string): Promise<boolean> {
  if (!organizationId) fail();
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR NO KEY UPDATE
  `;
  return rows.length === 1;
}

function active(run: InferenceRun, now: Date): boolean {
  return run.leaseToken !== null && run.leaseExpiresAt !== null && run.leaseExpiresAt > now;
}

async function record(tx: Tx, run: InferenceRun, action: string): Promise<void> {
  await audit(
    {
      organizationId: run.organizationId,
      action,
      resourceType: 'InferenceRun',
      resourceId: run.id,
      metadata: {
        state: run.state,
        usageKnown: run.totalTokens !== null,
        errorCode: run.lastErrorCode,
      },
    },
    tx,
  );
}

/** One generation and one send per call. Expired SUBMITTING is never reclaimed for inference. */
export async function reserveInferenceRun(
  db: Db,
  input: ReserveInferenceInput,
): Promise<InferenceReservation> {
  const now = clock(input.now);
  tokenCount(input.reservationTokens, true);
  tokenCount(input.dailyTokenLimit, true);
  if (
    !/^[a-f0-9]{64}$/.test(input.sourceHash) ||
    !/^[a-f0-9]{64}$/.test(input.requestHash) ||
    !input.callId ||
    !input.claimId ||
    !input.releaseId ||
    input.releaseId.length > 256 ||
    !input.promptVersion ||
    input.promptVersion.length > 256 ||
    !['SYNTHETIC', 'FIREWORKS'].includes(input.provider)
  )
    fail();
  clock(input.claimVersion);
  boundedJson(input.requestPayload);
  return db.$transaction(async (tx) => {
    if (!(await lockOrg(tx, input.organizationId))) return { kind: 'NOT_FOUND', run: null };
    const where = { organizationId: input.organizationId, callId: input.callId, generation: 1 };
    const existing = await tx.inferenceRun.findFirst({ where });
    if (existing) {
      if (existing.state === 'APPLIED') return { kind: 'ALREADY_APPLIED', run: existing };
      if (existing.state === 'UNKNOWN' || existing.state === 'REJECTED') {
        return { kind: 'REVIEW_REQUIRED', run: existing };
      }
      if (existing.state === 'SUBMITTING') {
        if (active(existing, now)) return { kind: 'BUSY', run: existing };
        const run = await tx.inferenceRun.update({
          where: { id: existing.id, organizationId: input.organizationId },
          data: { state: 'UNKNOWN', leaseExpiresAt: null, lastErrorCode: 'RESPONSE_UNKNOWN' },
        });
        await tx.inferenceAttempt.updateMany({
          where: { organizationId: input.organizationId, runId: run.id, state: 'SUBMITTING' },
          data: { state: 'UNKNOWN', lastErrorCode: 'RESPONSE_UNKNOWN' },
        });
        await record(tx, run, 'inference.unknown');
        return { kind: 'REVIEW_REQUIRED', run };
      }
      // A response is applied from its frozen snapshot, regardless of current source/claim changes.
      if (
        existing.state === 'RESERVED' &&
        (existing.requestHash !== input.requestHash ||
          existing.sourceHash !== input.sourceHash ||
          existing.claimId !== input.claimId ||
          existing.claimVersion.getTime() !== input.claimVersion.getTime() ||
          existing.provider !== input.provider ||
          existing.releaseId !== input.releaseId ||
          existing.promptVersion !== input.promptVersion ||
          canonical(existing.requestPayload) !== canonical(input.requestPayload))
      ) {
        // No send was admitted. Fence the previous owner and return only this proven-unsent allocation.
        await tx.inferenceBudget.update({
          where: {
            organizationId: input.organizationId,
            organizationId_billingDay: {
              organizationId: input.organizationId,
              billingDay: existing.billingDay,
            },
          },
          data: { reservedTokens: { decrement: existing.reservedTokens } },
        });
        const run = await tx.inferenceRun.update({
          where: { id: existing.id, organizationId: input.organizationId },
          data: {
            state: 'REJECTED',
            reservedTokens: 0,
            leaseToken: null,
            leaseExpiresAt: null,
            lastErrorCode: 'REQUEST_BINDING_CHANGED',
          },
        });
        await record(tx, run, 'inference.binding_rejected');
        return { kind: 'REVIEW_REQUIRED', run };
      }
      if (active(existing, now)) return { kind: 'BUSY', run: existing };
      const leaseToken = randomUUID();
      const run = await tx.inferenceRun.update({
        where: { id: existing.id, organizationId: input.organizationId },
        data: { leaseToken, leaseExpiresAt: new Date(now.getTime() + LEASE_MS) },
      });
      return { kind: run.state === 'RESPONDED' ? 'RESUME' : 'OWNED', run, leaseToken };
    }
    const call = await tx.call.findFirst({
      where: {
        id: input.callId,
        claimId: input.claimId,
        organizationId: input.organizationId,
        status: { in: ['COMPLETED', 'FAILED', 'VOICEMAIL'] },
      },
    });
    const claim = await tx.claim.findFirst({
      where: { id: input.claimId, organizationId: input.organizationId },
    });
    if (!call || !claim) return { kind: 'NOT_FOUND', run: null };
    const billingDay = day(now);
    const org = await tx.organization.findUniqueOrThrow({ where: { id: input.organizationId } });
    let budget = await tx.inferenceBudget.findFirst({
      where: { organizationId: org.id, billingDay },
    });
    if (!budget) {
      const baseline =
        org.summaryTokensResetAt && day(org.summaryTokensResetAt) === billingDay
          ? Math.max(0, org.summaryTokensUsed)
          : 0;
      budget = await tx.inferenceBudget.create({
        data: {
          organizationId: org.id,
          billingDay,
          tokenLimit: input.dailyTokenLimit,
          baselineTokens: baseline,
          knownTokens: baseline,
        },
      });
    } else if (budget.tokenLimit > BigInt(input.dailyTokenLimit)) {
      budget = await tx.inferenceBudget.update({
        where: { id: budget.id, organizationId: org.id },
        data: { tokenLimit: input.dailyTokenLimit },
      });
    }
    const pending = await tx.inferenceBudget.aggregate({
      where: { organizationId: org.id },
      _sum: { reservedTokens: true },
    });
    if (
      budget.knownTokens + (pending._sum.reservedTokens ?? 0n) + BigInt(input.reservationTokens) >
      budget.tokenLimit
    ) {
      return { kind: 'BUDGET_EXCEEDED', run: null };
    }
    const leaseToken = randomUUID();
    const run = await tx.inferenceRun.create({
      data: {
        organizationId: org.id,
        callId: input.callId,
        claimId: input.claimId,
        generation: 1,
        claimVersion: input.claimVersion,
        sourceHash: input.sourceHash,
        requestHash: input.requestHash,
        provider: input.provider,
        releaseId: input.releaseId,
        promptVersion: input.promptVersion,
        billingDay,
        tokenAllowance: input.reservationTokens,
        reservedTokens: input.reservationTokens,
        requestPayload: input.requestPayload,
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      },
    });
    await tx.inferenceBudget.update({
      where: { id: budget.id, organizationId: org.id },
      data: { reservedTokens: { increment: input.reservationTokens } },
    });
    await record(tx, run, 'inference.reserved');
    return { kind: 'OWNED', run, leaseToken };
  });
}

export async function beginInferenceAttempt(db: Db, input: InferenceOwnership): Promise<boolean> {
  const now = clock(input.now);
  return db.$transaction(async (tx) => {
    if (!(await lockOrg(tx, input.organizationId))) return false;
    const run = await tx.inferenceRun.findFirst({
      where: { id: input.runId, organizationId: input.organizationId },
    });
    if (run?.state !== 'RESERVED' || run.leaseToken !== input.leaseToken || !active(run, now))
      return false;
    await tx.inferenceAttempt.create({
      data: {
        organizationId: input.organizationId,
        runId: run.id,
        attemptNumber: 1,
        tokenAllowance: run.tokenAllowance,
        reservedTokens: run.reservedTokens,
        submittedAt: now,
      },
    });
    await tx.inferenceRun.update({
      where: { id: run.id, organizationId: input.organizationId },
      data: {
        state: 'SUBMITTING',
        submittedAt: now,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      },
    });
    return true;
  });
}

/** Persists provider evidence/cost independently of any summary or claim mutation. */
export async function saveInferenceReceipt(
  db: Db,
  input: InferenceReceiptInput,
): Promise<InferenceRun> {
  const now = clock(input.now);
  if (input.tokensUsed !== null) tokenCount(input.tokensUsed, false, Number.MAX_SAFE_INTEGER);
  if (!['VALIDATED', 'REJECTED', 'UNKNOWN'].includes(input.outcome)) fail();
  const codes: (InferenceErrorCode | null)[] = [
    null,
    'OUTPUT_SCHEMA_INVALID',
    'PROVIDER_ERROR',
    'USAGE_UNKNOWN',
    'REQUEST_BINDING_CHANGED',
    'RESPONSE_UNKNOWN',
    'TOKEN_BOUND_EXCEEDED',
  ];
  if (!codes.includes(input.errorCode)) fail();
  if (input.resultPayload !== null) boundedJson(input.resultPayload);
  if (input.outcome === 'VALIDATED' && input.resultPayload === null) fail();
  if (input.outcome !== 'VALIDATED' && input.resultPayload !== null) fail();
  const receiptHash = createHash('sha256')
    .update(
      canonical({
        outcome: input.outcome,
        resultPayload: input.resultPayload,
        tokensUsed: input.tokensUsed,
        errorCode: input.errorCode,
      }),
    )
    .digest('hex');
  return db.$transaction(async (tx) => {
    if (!(await lockOrg(tx, input.organizationId))) fail();
    const run = await tx.inferenceRun.findFirst({
      where: { id: input.runId, organizationId: input.organizationId },
    });
    if (!run) fail();
    if (run.receiptHash === receiptHash) return run;
    if (run.leaseToken !== input.leaseToken || !['SUBMITTING', 'UNKNOWN'].includes(run.state))
      fail();
    // An ambiguous response may later acquire positive evidence from the original sender only.
    // Already known usage may never be replaced or charged twice.
    if (run.totalTokens !== null) fail();
    const known = input.tokensUsed !== null;
    const tokens = known ? BigInt(input.tokensUsed ?? 0) : null;
    const errorCode =
      tokens !== null && tokens > run.tokenAllowance
        ? 'TOKEN_BOUND_EXCEEDED'
        : (input.errorCode ?? (known ? null : 'USAGE_UNKNOWN'));
    const state =
      input.outcome === 'VALIDATED'
        ? 'RESPONDED'
        : input.outcome === 'REJECTED'
          ? 'REJECTED'
          : 'UNKNOWN';
    const updated = await tx.inferenceRun.update({
      where: { id: run.id, organizationId: input.organizationId },
      data: {
        state,
        receiptHash,
        resultPayload: input.resultPayload ?? Prisma.DbNull,
        totalTokens: tokens,
        reservedTokens: known ? 0 : run.reservedTokens,
        respondedAt: input.outcome === 'UNKNOWN' ? null : now,
        lastErrorCode: errorCode,
        leaseExpiresAt: null,
        leaseToken: input.outcome === 'UNKNOWN' ? run.leaseToken : null,
      },
    });
    await tx.inferenceAttempt.update({
      where: {
        organizationId: input.organizationId,
        organizationId_runId_attemptNumber: {
          organizationId: input.organizationId,
          runId: run.id,
          attemptNumber: 1,
        },
      },
      data: {
        state: input.outcome === 'UNKNOWN' ? 'UNKNOWN' : 'RESPONDED',
        totalTokens: tokens,
        reservedTokens: known ? 0 : run.reservedTokens,
        respondedAt: input.outcome === 'UNKNOWN' ? null : now,
        lastErrorCode: errorCode,
      },
    });
    if (known) {
      const budget = await tx.inferenceBudget.update({
        where: {
          organizationId: input.organizationId,
          organizationId_billingDay: {
            organizationId: input.organizationId,
            billingDay: run.billingDay,
          },
        },
        data: {
          reservedTokens: { decrement: run.reservedTokens },
          knownTokens: { increment: tokens ?? 0n },
        },
      });
      // Legacy display only; admission always uses the bigint ledger, including pending older days.
      if (run.billingDay === day(now)) {
        await tx.organization.update({
          where: { id: input.organizationId },
          data: {
            summaryTokensUsed: Number(
              budget.knownTokens > 2_147_483_647n ? 2_147_483_647n : budget.knownTokens,
            ),
            summaryTokensResetAt: new Date(`${run.billingDay}T00:00:00.000Z`),
          },
        });
      }
    }
    await record(tx, updated, 'inference.receipt_saved');
    return updated;
  });
}

export async function markInferenceApplied(
  tx: Tx,
  input: InferenceOwnership & { summaryId: string },
): Promise<void> {
  const now = clock(input.now);
  if (!(await lockOrg(tx, input.organizationId))) fail();
  const run = await tx.inferenceRun.findFirst({
    where: { id: input.runId, organizationId: input.organizationId },
  });
  if (!run) fail();
  if (run.state === 'APPLIED' && run.summaryId === input.summaryId) return;
  if (run.state !== 'RESPONDED' || run.leaseToken !== input.leaseToken || !active(run, now)) fail();
  const summary = await tx.callSummary.findFirst({
    where: {
      id: input.summaryId,
      callId: run.callId,
      organizationId: input.organizationId,
    },
  });
  if (!summary) fail();
  const updated = await tx.inferenceRun.update({
    where: { id: run.id, organizationId: input.organizationId },
    data: {
      state: 'APPLIED',
      summaryId: summary.id,
      appliedAt: now,
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
  await record(tx, updated, 'inference.applied');
}

/** Call first inside the transaction that applies review effects; rollback keeps them retryable. */
export async function markInferenceReviewed(
  tx: Tx,
  input: Omit<InferenceOwnership, 'leaseToken'>,
): Promise<boolean> {
  const now = clock(input.now);
  if (!(await lockOrg(tx, input.organizationId))) fail();
  const run = await tx.inferenceRun.findFirst({
    where: { id: input.runId, organizationId: input.organizationId },
  });
  if (!run || !['UNKNOWN', 'REJECTED'].includes(run.state)) fail();
  if (run.reviewAppliedAt) return false;
  const updated = await tx.inferenceRun.update({
    where: { id: run.id, organizationId: input.organizationId },
    data: { reviewAppliedAt: now },
  });
  await record(tx, updated, 'inference.review_applied');
  return true;
}
