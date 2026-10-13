import { createHash, randomUUID } from 'node:crypto';

import type { Prisma, InferenceAttempt, InferenceRun } from '@prisma/client';

import type { prisma } from '../client.js';

import { audit } from './audit.js';
import type { InferenceOwnership, ReserveInferenceInput } from './inference.js';

type Db = typeof prisma;
type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];
const LEASE_MS = 60_000;
const MAX_JSON_BYTES = 2_200_000;
const MAX_BODY_BYTES = 2_097_152;
const RETRY_STATUSES = [429, 500, 502, 503, 504];
const ERRORS = [
  'INVALID_REQUEST',
  'RELEASE_NOT_FOUND',
  'RELEASE_DISABLED',
  'RELEASE_UNAPPROVED',
  'RELEASE_SCOPE_MISMATCH',
  'RELEASE_INTEGRITY_FAILED',
  'CONFIGURATION_ERROR',
  'REQUEST_TOO_LARGE',
  'RESPONSE_TOO_LARGE',
  'DEADLINE_EXCEEDED',
  'CANCELLED',
  'NETWORK_ERROR',
  'HTTP_ERROR',
  'INVALID_RESPONSE',
  'MODEL_IDENTITY_MISMATCH',
  'TRUNCATED',
  'REFUSED',
  'OUTPUT_SCHEMA_INVALID',
  'OUTPUT_SEMANTIC_INVALID',
  'VALIDATOR_FAILED',
  'ACCOUNTING_REQUIRED',
  'ADMISSION_DENIED',
  'JOURNAL_ERROR',
  'INFERENCE_BUSY',
  'INFERENCE_REVIEW_REQUIRED',
  'BUDGET_EXCEEDED',
] as const;
export type FireworksInferenceErrorCode = (typeof ERRORS)[number];
export interface FireworksUsage {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly totalTokens: number | null;
  readonly cachedInputTokens: number | null;
}
export interface FireworksAttemptReceipt {
  readonly index: number;
  readonly httpStatus: number | null;
  readonly outcome:
    | 'COMPLETED'
    | 'HTTP_ERROR'
    | 'NETWORK_ERROR'
    | 'DEADLINE_EXCEEDED'
    | 'CANCELLED'
    | 'INVALID_RESPONSE';
  readonly acceptance: 'NOT_SENT' | 'POSSIBLE' | 'RESPONDED';
  readonly elapsedMs: number;
  readonly usage: FireworksUsage;
}
export interface FireworksRawResponse {
  readonly status: number;
  readonly body: string | null;
  readonly retryDelayMs: number | null;
}
export type ReserveFireworksInferenceInput = Omit<ReserveInferenceInput, 'provider'> & {
  maxAttempts: 1 | 2;
  executionDeadlineAt: Date;
  releasePolicyHash: string;
  wireRequestHash: string;
};
export type FireworksInferenceReservation =
  | {
      kind: 'OWNED' | 'REPLAY' | 'RESUME';
      run: InferenceRun;
      leaseToken: string;
      attempts: InferenceAttempt[];
    }
  | {
      kind:
        | 'BUSY'
        | 'REVIEW_REQUIRED'
        | 'ALREADY_APPLIED'
        | 'BUDGET_EXCEEDED'
        | 'DEADLINE_EXCEEDED'
        | 'NOT_FOUND';
      run: InferenceRun | null;
    };
export interface BeginFireworksAttemptInput extends InferenceOwnership {
  attemptNumber: 1 | 2;
  wireRequestHash: string;
}
export interface FireworksAttemptAdmission {
  kind: 'ADMITTED' | 'REPLAY' | 'BUDGET_EXCEEDED' | 'DEADLINE_EXCEEDED' | 'BLOCKED';
  attempt: InferenceAttempt | null;
}
export interface RecordFireworksResponseInput extends InferenceOwnership {
  attemptNumber: 1 | 2;
  response: FireworksRawResponse;
}
export interface FinishFireworksAttemptInput extends InferenceOwnership {
  attempt: FireworksAttemptReceipt;
  errorCode: FireworksInferenceErrorCode | null;
}
export interface FinalizeFireworksInferenceInput extends InferenceOwnership {
  status: 'VALIDATED' | 'ABSTAINED' | 'FAILED';
  resultPayload: Prisma.InputJsonValue;
  errorCode: FireworksInferenceErrorCode | null;
}

function fail(): never {
  throw new Error('FIREWORKS_INFERENCE_CONFLICT');
}
function clock(value?: Date): Date {
  const now = value ?? new Date();
  if (!Number.isFinite(now.getTime())) fail();
  return now;
}
function day(now: Date): string {
  return now.toISOString().slice(0, 10);
}
function integer(value: number, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail();
}
function hashString(value: string): void {
  if (!/^[a-f0-9]{64}$/.test(value)) fail();
}
function errorCode(value: FireworksInferenceErrorCode | null): void {
  if (value !== null && !ERRORS.includes(value)) fail();
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
function json(value: Prisma.InputJsonValue): void {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  const seen = new Set<object>();
  let count = 0;
  while (stack.length) {
    const entry = stack.pop();
    if (!entry || ++count > 100_000 || entry.depth > 32) fail();
    const v = entry.value;
    if (v === null || typeof v === 'boolean' || typeof v === 'string') continue;
    if (typeof v === 'number' && Number.isFinite(v)) continue;
    if (typeof v !== 'object' || seen.has(v)) fail();
    if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype) fail();
    seen.add(v);
    for (const child of Object.values(v)) stack.push({ value: child, depth: entry.depth + 1 });
  }
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > MAX_JSON_BYTES) fail();
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
function native(run: InferenceRun | null): InferenceRun {
  if (
    run?.provider !== 'FIREWORKS' ||
    !run.wireRequestHash ||
    !run.releasePolicyHash ||
    !run.executionDeadlineAt
  )
    fail();
  return run;
}
async function getOwned(tx: Tx, input: InferenceOwnership): Promise<InferenceRun> {
  if (!(await lockOrg(tx, input.organizationId))) fail();
  const run = native(
    await tx.inferenceRun.findFirst({
      where: { id: input.runId, organizationId: input.organizationId },
    }),
  );
  if (run.leaseToken !== input.leaseToken) fail();
  return run;
}
async function attempts(tx: Tx, run: InferenceRun): Promise<InferenceAttempt[]> {
  return tx.inferenceAttempt.findMany({
    where: { organizationId: run.organizationId, runId: run.id },
    orderBy: { attemptNumber: 'asc' },
  });
}
async function record(
  tx: Tx,
  run: InferenceRun,
  action: string,
  attemptNumber?: number,
): Promise<void> {
  await audit(
    {
      organizationId: run.organizationId,
      resourceType: 'InferenceRun',
      resourceId: run.id,
      action,
      metadata: { state: run.state, ...(attemptNumber === undefined ? {} : { attemptNumber }) },
    },
    tx,
  );
}
async function budget(tx: Tx, organizationId: string, billingDay: string, limit: bigint) {
  const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
  let row = await tx.inferenceBudget.findFirst({ where: { organizationId, billingDay } });
  if (!row) {
    const baseline =
      org.summaryTokensResetAt && day(org.summaryTokensResetAt) === billingDay
        ? Math.max(0, org.summaryTokensUsed)
        : 0;
    row = await tx.inferenceBudget.create({
      data: {
        organizationId,
        billingDay,
        tokenLimit: limit,
        baselineTokens: baseline,
        knownTokens: baseline,
      },
    });
  } else if (row.tokenLimit > limit) {
    row = await tx.inferenceBudget.update({
      where: { id: row.id, organizationId },
      data: { tokenLimit: limit },
    });
  }
  return row;
}
async function canReserve(
  tx: Tx,
  organizationId: string,
  target: { knownTokens: bigint; tokenLimit: bigint },
  extra: bigint,
): Promise<boolean> {
  const pending = await tx.inferenceBudget.aggregate({
    where: { organizationId },
    _sum: { reservedTokens: true },
  });
  return target.knownTokens + (pending._sum.reservedTokens ?? 0n) + extra <= target.tokenLimit;
}

/** Automatic generation one: immutable request, original deadline, and at most two journaled sends. */
export async function reserveFireworksInferenceRun(
  db: Db,
  input: ReserveFireworksInferenceInput,
): Promise<FireworksInferenceReservation> {
  const now = clock(input.now);
  clock(input.claimVersion);
  clock(input.executionDeadlineAt);
  integer(input.maxAttempts, 1, 2);
  integer(input.reservationTokens, 1, 1_000_000_000);
  integer(input.dailyTokenLimit, 1, 1_000_000_000);
  for (const value of [
    input.sourceHash,
    input.requestHash,
    input.releasePolicyHash,
    input.wireRequestHash,
  ])
    hashString(value);
  if (
    !input.callId ||
    !input.claimId ||
    !input.releaseId ||
    input.releaseId.length > 256 ||
    !input.promptVersion ||
    input.promptVersion.length > 256
  )
    fail();
  json(input.requestPayload);
  return db.$transaction(async (tx) => {
    if (!(await lockOrg(tx, input.organizationId))) return { kind: 'NOT_FOUND', run: null };
    const existing = await tx.inferenceRun.findFirst({
      where: { organizationId: input.organizationId, callId: input.callId, generation: 1 },
    });
    if (existing) {
      native(existing);
      if (
        existing.requestHash !== input.requestHash ||
        existing.sourceHash !== input.sourceHash ||
        existing.claimId !== input.claimId ||
        existing.claimVersion.getTime() !== input.claimVersion.getTime() ||
        existing.releaseId !== input.releaseId ||
        existing.promptVersion !== input.promptVersion ||
        existing.maxAttempts !== input.maxAttempts ||
        existing.releasePolicyHash !== input.releasePolicyHash ||
        existing.wireRequestHash !== input.wireRequestHash ||
        canonical(existing.requestPayload) !== canonical(input.requestPayload)
      )
        fail();
      if (existing.state === 'APPLIED') return { kind: 'ALREADY_APPLIED', run: existing };
      const journal = await attempts(tx, existing);
      if (
        journal.length === 0 &&
        existing.executionDeadlineAt &&
        now >= existing.executionDeadlineAt
      ) {
        if (existing.state === 'REJECTED' && existing.lastErrorCode === 'DEADLINE_EXCEEDED')
          return { kind: 'DEADLINE_EXCEEDED', run: existing };
        if (existing.state === 'RESERVED') {
          await tx.inferenceBudget.update({
            where: {
              organizationId: existing.organizationId,
              organizationId_billingDay: {
                organizationId: existing.organizationId,
                billingDay: existing.billingDay,
              },
            },
            data: { reservedTokens: { decrement: existing.reservedTokens } },
          });
          const run = await tx.inferenceRun.update({
            where: { id: existing.id, organizationId: existing.organizationId },
            data: {
              state: 'REJECTED',
              reservedTokens: 0,
              totalTokens: 0,
              leaseToken: null,
              leaseExpiresAt: null,
              lastErrorCode: 'DEADLINE_EXCEEDED',
            },
          });
          await record(tx, run, 'inference.native_unsent_deadline');
          return { kind: 'DEADLINE_EXCEEDED', run };
        }
      }
      if (existing.state === 'RESPONDED' || existing.state === 'REJECTED') {
        if (existing.resultPayload === null) return { kind: 'REVIEW_REQUIRED', run: existing };
        await record(tx, existing, 'inference.native_snapshot_read');
        // Reading a final native result creates no send/application ownership.
        return { kind: 'RESUME', run: existing, leaseToken: '', attempts: journal };
      }
      if (active(existing, now)) return { kind: 'BUSY', run: existing };
      const last = journal.at(-1);
      if (last?.responseHash === null) {
        const run = await tx.inferenceRun.update({
          where: { id: existing.id, organizationId: input.organizationId },
          data: { state: 'UNKNOWN', leaseExpiresAt: null, lastErrorCode: 'RESPONSE_UNKNOWN' },
        });
        await tx.inferenceAttempt.updateMany({
          where: { id: last.id, organizationId: input.organizationId, completionHash: null },
          data: { state: 'UNKNOWN', lastErrorCode: 'RESPONSE_UNKNOWN' },
        });
        await record(tx, run, 'inference.native_unknown');
        return { kind: 'REVIEW_REQUIRED', run };
      }
      const leaseToken = randomUUID();
      const run = await tx.inferenceRun.update({
        where: { id: existing.id, organizationId: input.organizationId },
        data: {
          leaseToken,
          leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
          ...(last ? { state: 'SUBMITTING' as const } : {}),
        },
      });
      await record(tx, run, 'inference.native_snapshot_read');
      return { kind: last ? 'REPLAY' : 'OWNED', run, leaseToken, attempts: journal };
    }
    if (now >= input.executionDeadlineAt) return { kind: 'DEADLINE_EXCEEDED', run: null };
    const call = await tx.call.findFirst({
      where: {
        id: input.callId,
        claimId: input.claimId,
        organizationId: input.organizationId,
        status: { in: ['COMPLETED', 'FAILED', 'VOICEMAIL'] },
      },
    });
    const claim = await tx.claim.findFirst({
      where: {
        id: input.claimId,
        organizationId: input.organizationId,
        updatedAt: input.claimVersion,
      },
    });
    if (!call || !claim) return { kind: 'NOT_FOUND', run: null };
    const billingDay = day(now);
    const allocation = BigInt(input.reservationTokens);
    const target = await budget(
      tx,
      input.organizationId,
      billingDay,
      BigInt(input.dailyTokenLimit),
    );
    if (!(await canReserve(tx, input.organizationId, target, allocation)))
      return { kind: 'BUDGET_EXCEEDED', run: null };
    const leaseToken = randomUUID();
    const run = await tx.inferenceRun.create({
      data: {
        organizationId: input.organizationId,
        callId: input.callId,
        claimId: input.claimId,
        claimVersion: input.claimVersion,
        sourceHash: input.sourceHash,
        requestHash: input.requestHash,
        provider: 'FIREWORKS',
        releaseId: input.releaseId,
        promptVersion: input.promptVersion,
        billingDay,
        tokenAllowance: allocation,
        reservedTokens: allocation,
        requestPayload: input.requestPayload,
        maxAttempts: input.maxAttempts,
        executionDeadlineAt: input.executionDeadlineAt,
        releasePolicyHash: input.releasePolicyHash,
        wireRequestHash: input.wireRequestHash,
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      },
    });
    await tx.inferenceBudget.update({
      where: { id: target.id, organizationId: input.organizationId },
      data: { reservedTokens: { increment: allocation } },
    });
    await record(tx, run, 'inference.native_reserved');
    return { kind: 'OWNED', run, leaseToken, attempts: [] };
  });
}

export async function beginFireworksAttempt(
  db: Db,
  input: BeginFireworksAttemptInput,
): Promise<FireworksAttemptAdmission> {
  const now = clock(input.now);
  integer(input.attemptNumber, 1, 2);
  hashString(input.wireRequestHash);
  return db.$transaction(async (tx) => {
    const run = await getOwned(tx, input);
    if (input.wireRequestHash !== run.wireRequestHash) fail();
    const journal = await attempts(tx, run);
    const existing = journal.find((entry) => entry.attemptNumber === input.attemptNumber);
    if (existing) return { kind: 'REPLAY', attempt: existing };
    if (
      !active(run, now) ||
      !['RESERVED', 'SUBMITTING'].includes(run.state) ||
      input.attemptNumber > run.maxAttempts ||
      input.attemptNumber !== journal.length + 1
    )
      return { kind: 'BLOCKED', attempt: null };
    if (!run.executionDeadlineAt || now >= run.executionDeadlineAt)
      return { kind: 'DEADLINE_EXCEEDED', attempt: null };
    const billingDay = input.attemptNumber === 1 ? run.billingDay : day(now);
    if (input.attemptNumber === 2) {
      const previous = journal[0];
      if (
        !previous?.completionHash ||
        !previous.responseHash ||
        previous.acceptance !== 'RESPONDED' ||
        previous.outcome !== 'HTTP_ERROR' ||
        !RETRY_STATUSES.includes(previous.httpStatus ?? 0)
      )
        return { kind: 'BLOCKED', attempt: null };
      const response = parseFireworksRawResponse(previous.responsePayload);
      if (!response) fail();
      if (
        !previous.responseRecordedAt ||
        now.getTime() < previous.responseRecordedAt.getTime() + (response.retryDelayMs ?? 0)
      )
        return { kind: 'BLOCKED', attempt: null };
      const original = await tx.inferenceBudget.findFirstOrThrow({
        where: { organizationId: run.organizationId, billingDay: run.billingDay },
      });
      const target = await budget(tx, run.organizationId, billingDay, original.tokenLimit);
      if (!(await canReserve(tx, run.organizationId, target, run.tokenAllowance)))
        return { kind: 'BUDGET_EXCEEDED', attempt: null };
      await tx.inferenceBudget.update({
        where: { id: target.id, organizationId: run.organizationId },
        data: { reservedTokens: { increment: run.tokenAllowance } },
      });
    }
    const attempt = await tx.inferenceAttempt.create({
      data: {
        organizationId: run.organizationId,
        runId: run.id,
        attemptNumber: input.attemptNumber,
        billingDay,
        tokenAllowance: run.tokenAllowance,
        reservedTokens: run.tokenAllowance,
        submittedAt: now,
      },
    });
    const updated = await tx.inferenceRun.update({
      where: { id: run.id, organizationId: run.organizationId },
      data: {
        state: 'SUBMITTING',
        submittedAt: run.submittedAt ?? now,
        totalTokens: null,
        ...(input.attemptNumber === 2 ? { reservedTokens: { increment: run.tokenAllowance } } : {}),
        leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      },
    });
    await record(tx, updated, 'inference.native_attempt_admitted', input.attemptNumber);
    return { kind: 'ADMITTED', attempt };
  });
}

export async function recordFireworksResponse(
  db: Db,
  input: RecordFireworksResponseInput,
): Promise<InferenceAttempt> {
  const now = clock(input.now);
  integer(input.attemptNumber, 1, 2);
  integer(input.response.status, 100, 599);
  if (
    input.response.body !== null &&
    (typeof input.response.body !== 'string' ||
      Buffer.byteLength(input.response.body, 'utf8') > MAX_BODY_BYTES)
  )
    fail();
  if (input.response.retryDelayMs !== null) integer(input.response.retryDelayMs, 0, 2_147_483_647);
  if (!parseFireworksRawResponse(input.response)) fail();
  const responseHash = digest(input.response);
  return db.$transaction(async (tx) => {
    const run = await getOwned(tx, input);
    const attempt = await tx.inferenceAttempt.findFirst({
      where: {
        organizationId: run.organizationId,
        runId: run.id,
        attemptNumber: input.attemptNumber,
      },
    });
    if (!attempt) fail();
    if (attempt.responseHash === responseHash) return attempt;
    if (
      attempt.responseHash ||
      attempt.completionHash ||
      !['SUBMITTING', 'UNKNOWN'].includes(run.state)
    )
      fail();
    const updated = await tx.inferenceAttempt.update({
      where: { id: attempt.id, organizationId: run.organizationId },
      data: { responseHash, responsePayload: { ...input.response }, responseRecordedAt: now },
    });
    await record(tx, run, 'inference.native_response_recorded', input.attemptNumber);
    return updated;
  });
}

export function parseFireworksRawResponse(value: unknown): FireworksRawResponse | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).sort().join(',') !== 'body,retryDelayMs,status' ||
    typeof row.status !== 'number' ||
    !Number.isInteger(row.status) ||
    row.status < 100 ||
    row.status > 599 ||
    (row.body !== null &&
      (typeof row.body !== 'string' || Buffer.byteLength(row.body, 'utf8') > MAX_BODY_BYTES)) ||
    (row.retryDelayMs !== null &&
      (typeof row.retryDelayMs !== 'number' ||
        !Number.isSafeInteger(row.retryDelayMs) ||
        row.retryDelayMs < 0 ||
        row.retryDelayMs > 2_147_483_647))
  )
    return null;
  return {
    status: row.status,
    body: row.body,
    retryDelayMs: row.retryDelayMs,
  };
}

export function getFireworksAttemptReceipt(
  attempt: InferenceAttempt,
): FireworksAttemptReceipt | null {
  if (
    !attempt.completionHash ||
    !attempt.completedAt ||
    !attempt.outcome ||
    !attempt.acceptance ||
    attempt.elapsedMs === null ||
    ![
      'COMPLETED',
      'HTTP_ERROR',
      'NETWORK_ERROR',
      'DEADLINE_EXCEEDED',
      'CANCELLED',
      'INVALID_RESPONSE',
    ].includes(attempt.outcome) ||
    !['NOT_SENT', 'POSSIBLE', 'RESPONDED'].includes(attempt.acceptance)
  )
    return null;
  const counts = [
    attempt.inputTokens,
    attempt.outputTokens,
    attempt.totalTokens,
    attempt.cachedInputTokens,
  ];
  if (
    counts.some(
      (value) => value !== null && (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)),
    )
  )
    return null;
  const number = (value: bigint | null): number | null => (value === null ? null : Number(value));
  return {
    index: attempt.attemptNumber,
    httpStatus: attempt.httpStatus,
    outcome: attempt.outcome as FireworksAttemptReceipt['outcome'],
    acceptance: attempt.acceptance as FireworksAttemptReceipt['acceptance'],
    elapsedMs: attempt.elapsedMs,
    usage: {
      inputTokens: number(attempt.inputTokens),
      outputTokens: number(attempt.outputTokens),
      totalTokens: number(attempt.totalTokens),
      cachedInputTokens: number(attempt.cachedInputTokens),
    },
  };
}
function receipt(attempt: InferenceAttempt): FireworksAttemptReceipt {
  const value = getFireworksAttemptReceipt(attempt);
  if (!value) fail();
  return value;
}
function stableAttempt(
  attempt: FireworksAttemptReceipt,
): Omit<FireworksAttemptReceipt, 'elapsedMs'> {
  return {
    index: attempt.index,
    httpStatus: attempt.httpStatus,
    outcome: attempt.outcome,
    acceptance: attempt.acceptance,
    usage: attempt.usage,
  };
}

export async function finishFireworksAttempt(
  db: Db,
  input: FinishFireworksAttemptInput,
): Promise<InferenceAttempt> {
  const now = clock(input.now);
  const completed = input.attempt;
  integer(completed.index, 1, 2);
  if (
    !Number.isFinite(completed.elapsedMs) ||
    completed.elapsedMs < 0 ||
    completed.elapsedMs > 2_147_483_647
  )
    fail();
  errorCode(input.errorCode);
  if (completed.httpStatus !== null) integer(completed.httpStatus, 100, 599);
  if (
    ![
      'COMPLETED',
      'HTTP_ERROR',
      'NETWORK_ERROR',
      'DEADLINE_EXCEEDED',
      'CANCELLED',
      'INVALID_RESPONSE',
    ].includes(completed.outcome) ||
    !['NOT_SENT', 'POSSIBLE', 'RESPONDED'].includes(completed.acceptance)
  )
    fail();
  for (const value of [
    completed.usage.inputTokens,
    completed.usage.outputTokens,
    completed.usage.totalTokens,
    completed.usage.cachedInputTokens,
  ])
    if (value !== null) integer(value);
  const { inputTokens, outputTokens, totalTokens, cachedInputTokens } = completed.usage;
  if (
    (totalTokens !== null &&
      ((inputTokens !== null && totalTokens < inputTokens) ||
        (outputTokens !== null && totalTokens < outputTokens) ||
        (cachedInputTokens !== null && totalTokens < cachedInputTokens) ||
        (inputTokens !== null &&
          outputTokens !== null &&
          BigInt(totalTokens) !== BigInt(inputTokens) + BigInt(outputTokens)))) ||
    (cachedInputTokens !== null && inputTokens !== null && cachedInputTokens > inputTokens)
  )
    fail();
  const completionHash = digest({ attempt: stableAttempt(completed), errorCode: input.errorCode });
  return db.$transaction(async (tx) => {
    const run = await getOwned(tx, input);
    const attempt = await tx.inferenceAttempt.findFirst({
      where: { organizationId: run.organizationId, runId: run.id, attemptNumber: completed.index },
    });
    if (!attempt) fail();
    if (attempt.completionHash === completionHash) return attempt;
    const previousReceipt = attempt.completionHash ? receipt(attempt) : null;
    const rawStatus = parseFireworksRawResponse(attempt.responsePayload)?.status;
    const canRefine =
      previousReceipt !== null &&
      ['CANCELLED', 'DEADLINE_EXCEEDED'].includes(previousReceipt.outcome) &&
      previousReceipt.usage.totalTokens === null &&
      previousReceipt.acceptance === 'RESPONDED' &&
      attempt.responseHash !== null &&
      rawStatus !== undefined &&
      completed.httpStatus === rawStatus &&
      completed.acceptance === 'RESPONDED' &&
      (rawStatus >= 200 && rawStatus < 300
        ? ['COMPLETED', 'INVALID_RESPONSE'].includes(completed.outcome)
        : completed.outcome === 'HTTP_ERROR') &&
      (['inputTokens', 'outputTokens', 'cachedInputTokens'] as const).every(
        (key) =>
          previousReceipt.usage[key] === null ||
          previousReceipt.usage[key] === completed.usage[key],
      );
    if ((attempt.completionHash && !canRefine) || !['SUBMITTING', 'UNKNOWN'].includes(run.state))
      fail();
    if (completed.acceptance === 'RESPONDED') {
      if (
        !attempt.responseHash ||
        parseFireworksRawResponse(attempt.responsePayload)?.status !== completed.httpStatus
      )
        fail();
    } else if (attempt.responseHash || completed.httpStatus !== null) fail();
    if (
      completed.outcome === 'COMPLETED' &&
      (completed.acceptance !== 'RESPONDED' ||
        completed.httpStatus === null ||
        completed.httpStatus < 200 ||
        completed.httpStatus >= 300)
    )
      fail();
    const known = completed.usage.totalTokens !== null;
    const unsent = completed.acceptance === 'NOT_SENT';
    if (unsent && Object.values(completed.usage).some((value) => value !== null && value !== 0))
      fail();
    const released = known || unsent ? attempt.reservedTokens : 0n;
    const updated = await tx.inferenceAttempt.update({
      where: { id: attempt.id, organizationId: run.organizationId },
      data: {
        completionHash,
        ...(canRefine
          ? {
              completionHistory: [
                {
                  completionHash: attempt.completionHash,
                  attempt: { ...previousReceipt, usage: { ...previousReceipt.usage } },
                  errorCode: attempt.lastErrorCode,
                  completedAt: attempt.completedAt?.toISOString() ?? null,
                },
              ],
            }
          : {}),
        completedAt: now,
        state: completed.acceptance === 'POSSIBLE' ? 'UNKNOWN' : 'RESPONDED',
        outcome: completed.outcome,
        acceptance: completed.acceptance,
        httpStatus: completed.httpStatus,
        elapsedMs: completed.elapsedMs,
        inputTokens: completed.usage.inputTokens,
        outputTokens: completed.usage.outputTokens,
        totalTokens: completed.usage.totalTokens,
        cachedInputTokens: completed.usage.cachedInputTokens,
        reservedTokens: { decrement: released },
        respondedAt: completed.acceptance === 'RESPONDED' ? now : null,
        lastErrorCode: input.errorCode,
      },
    });
    if (known || unsent) {
      const target = await tx.inferenceBudget.update({
        where: {
          organizationId: run.organizationId,
          organizationId_billingDay: {
            organizationId: run.organizationId,
            billingDay: attempt.billingDay,
          },
        },
        data: {
          reservedTokens: { decrement: released },
          knownTokens: { increment: BigInt(completed.usage.totalTokens ?? 0) },
        },
      });
      if (attempt.billingDay === day(now))
        await tx.organization.update({
          where: { id: run.organizationId },
          data: {
            summaryTokensUsed: Number(
              target.knownTokens > 2_147_483_647n ? 2_147_483_647n : target.knownTokens,
            ),
            summaryTokensResetAt: new Date(`${attempt.billingDay}T00:00:00.000Z`),
          },
        });
    }
    const journal = await attempts(tx, run);
    const aggregate = journal.every((entry) => entry.totalTokens !== null)
      ? journal.reduce((sum, entry) => sum + (entry.totalTokens ?? 0n), 0n)
      : null;
    const updatedRun = await tx.inferenceRun.update({
      where: { id: run.id, organizationId: run.organizationId },
      data: {
        totalTokens: aggregate,
        reservedTokens: journal.reduce((sum, entry) => sum + entry.reservedTokens, 0n),
      },
    });
    await record(tx, updatedRun, 'inference.native_attempt_finished', completed.index);
    return updated;
  });
}

/** Final native output is stored only after every admitted attempt's independent receipt commits. */
export async function finalizeFireworksInference(
  db: Db,
  input: FinalizeFireworksInferenceInput,
): Promise<InferenceRun> {
  const now = clock(input.now);
  errorCode(input.errorCode);
  json(input.resultPayload);
  if (!['VALIDATED', 'ABSTAINED', 'FAILED'].includes(input.status)) fail();
  const result = input.resultPayload as Record<string, Prisma.InputJsonValue>;
  if (result.status !== input.status || input.errorCode === 'JOURNAL_ERROR') fail();
  const receiptHash = digest({
    resultPayload: input.resultPayload,
    status: input.status,
    errorCode: input.errorCode,
  });
  return db.$transaction(async (tx) => {
    if (!(await lockOrg(tx, input.organizationId))) fail();
    const run = native(
      await tx.inferenceRun.findFirst({
        where: { id: input.runId, organizationId: input.organizationId },
      }),
    );
    if (run.receiptHash === receiptHash) return run;
    if (run.leaseToken !== input.leaseToken) fail();
    if (!['RESERVED', 'SUBMITTING', 'UNKNOWN'].includes(run.state)) fail();
    const journal = await attempts(tx, run);
    if (journal.some((entry) => !entry.completionHash)) fail();
    const resultAttempts: unknown =
      input.status === 'FAILED'
        ? result.attempts
        : (result.provenance as Record<string, Prisma.InputJsonValue> | undefined)?.attempts;
    if (
      !Array.isArray(resultAttempts) ||
      canonical(
        resultAttempts.map((value: unknown) => {
          if (value === null || typeof value !== 'object' || Array.isArray(value)) fail();
          const row = value as Record<string, unknown>;
          return Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'elapsedMs'));
        }),
      ) !== canonical(journal.map((entry) => stableAttempt(receipt(entry))))
    )
      fail();
    if (input.status !== 'FAILED') {
      const provenance = result.provenance as Record<string, Prisma.InputJsonValue> | undefined;
      if (provenance?.kind !== 'FIREWORKS' || provenance.releaseId !== run.releaseId) fail();
      const last = journal.at(-1);
      if (
        last?.outcome !== 'COMPLETED' ||
        last.acceptance !== 'RESPONDED' ||
        !last.responseHash ||
        input.errorCode !== null
      )
        fail();
    } else if (result.code !== input.errorCode) fail();
    if (journal.length === 0) {
      if (run.state !== 'RESERVED' || input.status !== 'FAILED') fail();
      await tx.inferenceBudget.update({
        where: {
          organizationId: run.organizationId,
          organizationId_billingDay: {
            organizationId: run.organizationId,
            billingDay: run.billingDay,
          },
        },
        data: { reservedTokens: { decrement: run.reservedTokens } },
      });
    }
    const ambiguous = journal.some((entry) => entry.acceptance === 'POSSIBLE');
    const state = input.status !== 'FAILED' ? 'RESPONDED' : ambiguous ? 'UNKNOWN' : 'REJECTED';
    const updated = await tx.inferenceRun.update({
      where: { id: run.id, organizationId: run.organizationId },
      data: {
        state,
        resultPayload: input.resultPayload,
        receiptHash,
        respondedAt: now,
        lastErrorCode: input.errorCode,
        ...(journal.length === 0 ? { reservedTokens: 0, totalTokens: 0 } : {}),
        leaseExpiresAt: null,
        // Keep the original sender token for a response that arrives after an ambiguous timeout.
        leaseToken: ambiguous ? run.leaseToken : null,
      },
    });
    await record(tx, updated, 'inference.native_finalized');
    return updated;
  });
}
