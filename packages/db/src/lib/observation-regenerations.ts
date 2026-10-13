import { createHash } from 'node:crypto';

import type { ObservationRegeneration, Prisma } from '@prisma/client';

import type { prisma } from '../client.js';

import { audit } from './audit.js';

type Db = typeof prisma;
type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];
export const OBSERVATION_REGENERATION_CODES = [
  'INVALID_INPUT',
  'NOT_FOUND',
  'FORBIDDEN',
  'STALE_PREVIEW',
  'IDEMPOTENCY_CONFLICT',
  'PREVIOUS_OBSERVATION_STALE',
  'PRIOR_RUN_UNRESOLVED',
  'AUTHORIZATION_PENDING',
  'CLAIM_CHANGED',
  'TRANSCRIPT_CHANGED',
  'NEWER_CALL',
  'AUTHORIZATION_EXPIRED',
  'AUTHORIZATION_SUPERSEDED',
  'AUTHORIZATION_INVALID',
] as const;
export type ObservationRegenerationCode = (typeof OBSERVATION_REGENERATION_CODES)[number];
export class ObservationRegenerationError extends Error {
  public constructor(public readonly code: ObservationRegenerationCode) {
    super('Observation regeneration could not be authorized.');
    this.name = 'ObservationRegenerationError';
  }
}
export interface PreviewObservationRegenerationInput {
  organizationId: string;
  clerkUserId: string;
  observationId: string;
  callId: string;
  claimVersion: Date;
  requestPayload: Prisma.InputJsonValue;
  requestHash: string;
  sourceHash: string;
  releaseId: string;
  releasePolicyHash: string;
  implementationArtifactSha256: string;
  /** Exact serialized ReleaseSchema output; a JSON scalar preserves policy field order. */
  releaseSnapshot: string;
  now?: Date;
}
export interface ObservationRegenerationPreview {
  canAuthorize: boolean;
  blockedReason: ObservationRegenerationCode | null;
  previewDigest: string;
  previousObservationId: string;
  previousObservationDigest: string;
  previousRunId: string;
  previousGeneration: number;
  nextGeneration: number;
}
export interface AuthorizeObservationRegenerationInput extends PreviewObservationRegenerationInput {
  expectedPreviewDigest: string;
  idempotencyKey: string;
  reason: string;
}
export interface ObservationRegenerationAuthorization {
  kind: 'AUTHORIZED' | 'ALREADY_AUTHORIZED';
  authorization: ObservationRegeneration;
}
export interface ObservationRegenerationAdmissionInput {
  organizationId: string;
  regenerationId: string;
  callId: string;
  claimId: string;
  claimVersion: Date;
  requestPayload: Prisma.InputJsonValue;
  requestHash: string;
  sourceHash: string;
  releaseId: string;
  releasePolicyHash: string;
  implementationArtifactSha256?: string;
  now: Date;
}
function fail(code: ObservationRegenerationCode): never {
  throw new ObservationRegenerationError(code);
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const row = object(value);
  return row
    ? `{${Object.keys(row)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`)
        .join(',')}}`
    : JSON.stringify(value);
}
function hash(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
function jsonHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function time(value?: Date): Date {
  const now = value ?? new Date();
  if (!Number.isFinite(now.getTime())) fail('INVALID_INPUT');
  return now;
}
async function lockOrg(tx: Tx, organizationId: string): Promise<void> {
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR NO KEY UPDATE`;
  if (rows.length !== 1) fail('NOT_FOUND');
}
async function actor(tx: Tx, organizationId: string, clerkUserId: string) {
  const user = await tx.user.findFirst({ where: { organizationId, clerkUserId } });
  if (!user || (user.role !== 'OWNER' && user.role !== 'ADMIN')) fail('FORBIDDEN');
  return user;
}
function validate(input: PreviewObservationRegenerationInput): void {
  if (
    !input.organizationId ||
    !input.observationId ||
    !input.callId ||
    !input.releaseId ||
    !(input.claimVersion instanceof Date) ||
    !Number.isFinite(input.claimVersion.getTime()) ||
    [
      input.requestHash,
      input.sourceHash,
      input.releasePolicyHash,
      input.implementationArtifactSha256,
    ].some((value) => !/^[a-f0-9]{64}$/.test(value))
  )
    fail('INVALID_INPUT');
  if (Buffer.byteLength(JSON.stringify(input.requestPayload), 'utf8') > 131072)
    fail('INVALID_INPUT');
  if (
    typeof input.releaseSnapshot !== 'string' ||
    Buffer.byteLength(input.releaseSnapshot, 'utf8') > 131072
  )
    fail('INVALID_INPUT');
}

function validRelease(
  snapshot: unknown,
  input: {
    organizationId: string;
    releaseId: string;
    releasePolicyHash: string;
    implementationArtifactSha256?: string;
    requestPayload: Prisma.InputJsonValue;
  },
  now: Date,
): boolean {
  if (typeof snapshot !== 'string') return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(snapshot);
  } catch {
    return false;
  }
  const release = object(parsed);
  const policy = object(release?.policy);
  const approval = object(release?.approval);
  if (
    !policy ||
    !approval ||
    policy.id !== input.releaseId ||
    policy.task !== 'claim-observation.v1' ||
    (policy.state !== 'APPROVED' && policy.state !== 'SYNTHETIC_EVALUATION') ||
    policy.implementationArtifactSha256 !== input.implementationArtifactSha256 ||
    jsonHash(policy) !== input.releasePolicyHash ||
    approval.policySha256 !== input.releasePolicyHash ||
    !Array.isArray(policy.organizations) ||
    !policy.organizations.includes(input.organizationId) ||
    typeof approval.reviewedAt !== 'string' ||
    typeof approval.expiresAt !== 'string'
  )
    return false;
  const reviewed = Date.parse(approval.reviewedAt);
  const expires = Date.parse(approval.expiresAt);
  if (
    !Number.isFinite(reviewed) ||
    !Number.isFinite(expires) ||
    reviewed > now.getTime() ||
    expires <= now.getTime() ||
    expires <= reviewed
  )
    return false;
  const request = object(input.requestPayload);
  return (
    request?.dataClass !== 'PROTECTED' ||
    (policy.state === 'APPROVED' &&
      typeof object(policy.evidence)?.protectedDataApprovalId === 'string')
  );
}

async function currentBinding(
  tx: Tx,
  input: Omit<
    ObservationRegenerationAdmissionInput,
    'regenerationId' | 'implementationArtifactSha256' | 'now'
  >,
  generation: number,
): Promise<ObservationRegenerationCode | null> {
  const claim = await tx.claim.findFirst({
    where: { id: input.claimId, organizationId: input.organizationId },
  });
  if (claim?.updatedAt.getTime() !== input.claimVersion.getTime()) return 'CLAIM_CHANGED';
  const call = await tx.call.findFirst({
    where: { id: input.callId, claimId: input.claimId, organizationId: input.organizationId },
    include: { intent: true },
  });
  if (!call || !['COMPLETED', 'FAILED', 'VOICEMAIL'].includes(call.status))
    return 'AUTHORIZATION_INVALID';
  const sourceOrderAt = call.intent?.createdAt ?? call.createdAt;
  const newer = await tx.$queryRaw<{ id: string }[]>`
    SELECT c."id" FROM "Call" c
    LEFT JOIN "CallIntent" i ON i."callId" = c."id" AND i."claimId" = c."claimId" AND i."organizationId" = c."organizationId"
    WHERE c."organizationId" = ${input.organizationId} AND c."claimId" = ${input.claimId}
      AND (COALESCE(i."createdAt", c."createdAt") > ${sourceOrderAt}
        OR (COALESCE(i."createdAt", c."createdAt") = ${sourceOrderAt} AND c."id" > ${input.callId})) LIMIT 1`;
  if (newer.length) return 'NEWER_CALL';
  const request = object(input.requestPayload);
  const claimSnapshot = object(request?.claim);
  if (!request || !claimSnapshot || !Array.isArray(request.sources) || request.sources.length !== 1)
    return 'AUTHORIZATION_INVALID';
  const source = object(request.sources[0]);
  if (
    !source ||
    request.organizationId !== input.organizationId ||
    request.invocationId !== `observation.${input.callId}.g${String(generation)}` ||
    request.releaseId !== input.releaseId ||
    request.task !== 'claim-observation.v1' ||
    (request.dataClass !== 'SYNTHETIC' && request.dataClass !== 'PROTECTED') ||
    claimSnapshot.id !== input.claimId ||
    claimSnapshot.organizationId !== input.organizationId ||
    claimSnapshot.version !== input.claimVersion.toISOString() ||
    claimSnapshot.currency !== 'USD' ||
    claimSnapshot.billedMinorUnits !== Number(claim.claimAmount.mul(100).toFixed(0)) ||
    source.organizationId !== input.organizationId ||
    source.claimId !== input.claimId ||
    source.claimVersion !== input.claimVersion.toISOString() ||
    source.kind !== 'FINAL_CALL_TRANSCRIPT'
  )
    return 'AUTHORIZATION_INVALID';
  const events = await tx.$queryRaw<{ id: string; data: Prisma.JsonValue }[]>`
    SELECT e."id", e."data" FROM "CallEvent" e JOIN "Call" c ON c."id" = e."callId"
    WHERE e."callId" = ${input.callId} AND c."organizationId" = ${input.organizationId} AND c."claimId" = ${input.claimId}
      AND e."eventType" IN ('call.ended', 'webhook.call.ended') AND e."data" ? 'transcript'
    ORDER BY e."timestamp" DESC, e."id" DESC LIMIT 1 FOR SHARE OF e`;
  const event = events[0];
  const text = object(object(event?.data)?.transcript)?.text;
  if (
    !event ||
    typeof text !== 'string' ||
    !text.trim() ||
    source.id !== `transcript.${event.id}` ||
    source.text !== text ||
    source.version !== createHash('sha256').update(text).digest('hex')
  )
    return 'TRANSCRIPT_CHANGED';
  const orderedSources = [
    {
      id: source.id,
      organizationId: source.organizationId,
      claimId: source.claimId,
      claimVersion: source.claimVersion,
      version: source.version,
      kind: source.kind,
      text: source.text,
    },
  ];
  const orderedRequest = {
    organizationId: request.organizationId,
    invocationId: request.invocationId,
    releaseId: request.releaseId,
    task: request.task,
    dataClass: request.dataClass,
    claim: {
      id: claimSnapshot.id,
      organizationId: claimSnapshot.organizationId,
      version: claimSnapshot.version,
      billedMinorUnits: claimSnapshot.billedMinorUnits,
      currency: claimSnapshot.currency,
    },
    sources: orderedSources,
  };
  return jsonHash(orderedRequest) === input.requestHash &&
    jsonHash(orderedSources) === input.sourceHash
    ? null
    : 'AUTHORIZATION_INVALID';
}

async function preview(
  tx: Tx,
  input: PreviewObservationRegenerationInput,
  now: Date,
): Promise<ObservationRegenerationPreview> {
  const observation = await tx.claimObservation.findFirst({
    where: { id: input.observationId, organizationId: input.organizationId, callId: input.callId },
  });
  if (!observation) fail('NOT_FOUND');
  const latestObservation = await tx.claimObservation.findFirst({
    where: { organizationId: input.organizationId, callId: input.callId },
    orderBy: [{ inferenceRun: { generation: 'desc' } }, { version: 'desc' }],
  });
  const previousRun = await tx.inferenceRun.findFirst({
    where: { organizationId: input.organizationId, callId: input.callId },
    orderBy: { generation: 'desc' },
    include: { attempts: true },
  });
  if (!previousRun) fail('NOT_FOUND');
  const latestAuth = await tx.observationRegeneration.findFirst({
    where: { organizationId: input.organizationId, callId: input.callId },
    orderBy: { generation: 'desc' },
    include: { inferenceRun: { select: { id: true } } },
  });
  const generation = Math.max(previousRun.generation, latestAuth?.generation ?? 1) + 1;
  let blockedReason: ObservationRegenerationCode | null =
    latestObservation?.id !== observation.id ? 'PREVIOUS_OBSERVATION_STALE' : null;
  const zeroAttemptRefund =
    previousRun.state === 'REJECTED' &&
    previousRun.attempts.length === 0 &&
    previousRun.totalTokens === 0n &&
    previousRun.reservedTokens === 0n;
  const failedResult = object(previousRun.resultPayload);
  const finalizedUnsentReceipt =
    zeroAttemptRefund &&
    failedResult?.status === 'FAILED' &&
    failedResult.code === previousRun.lastErrorCode &&
    previousRun.lastErrorCode !== null &&
    Array.isArray(failedResult.attempts) &&
    failedResult.attempts.length === 0 &&
    previousRun.receiptHash ===
      hash({
        resultPayload: previousRun.resultPayload,
        status: 'FAILED',
        errorCode: previousRun.lastErrorCode,
      });
  const provenUnsent =
    zeroAttemptRefund &&
    (previousRun.lastErrorCode === 'DEADLINE_EXCEEDED' || finalizedUnsentReceipt) &&
    (await tx.auditLog.findFirst({
      where: {
        organizationId: input.organizationId,
        resourceType: 'InferenceRun',
        resourceId: previousRun.id,
        action: {
          in: [
            ...(previousRun.lastErrorCode === 'DEADLINE_EXCEEDED'
              ? ['inference.native_unsent_deadline']
              : []),
            ...(finalizedUnsentReceipt ? ['inference.native_finalized'] : []),
          ],
        },
      },
      select: { id: true },
    })) !== null;
  if (
    !blockedReason &&
    (previousRun.provider !== 'FIREWORKS' ||
      !(
        previousRun.state === 'APPLIED' ||
        provenUnsent ||
        (previousRun.state === 'REJECTED' &&
          previousRun.attempts.length > 0 &&
          previousRun.attempts.every(
            (attempt) =>
              attempt.responseHash !== null &&
              attempt.completionHash !== null &&
              attempt.acceptance === 'RESPONDED',
          ))
      ))
  )
    blockedReason = 'PRIOR_RUN_UNRESOLVED';
  if (!blockedReason && latestAuth && !latestAuth.inferenceRun && latestAuth.expiresAt > now)
    blockedReason = 'AUTHORIZATION_PENDING';
  if (!blockedReason && !validRelease(input.releaseSnapshot, input, now))
    blockedReason = 'AUTHORIZATION_INVALID';
  blockedReason ??= await currentBinding(
    tx,
    { ...input, claimId: observation.claimId },
    generation,
  );
  const snapshot = {
    organizationId: input.organizationId,
    observationId: observation.id,
    previousObservationDigest: observation.digest,
    previousRunId: previousRun.id,
    previousGeneration: previousRun.generation,
    previousRunState: previousRun.state,
    lastAuthorizationId: latestAuth?.id ?? null,
    nextGeneration: generation,
    claimVersion: input.claimVersion.toISOString(),
    requestHash: input.requestHash,
    sourceHash: input.sourceHash,
    releaseId: input.releaseId,
    releasePolicyHash: input.releasePolicyHash,
    implementationArtifactSha256: input.implementationArtifactSha256,
    releaseSnapshotHash: hash(input.releaseSnapshot),
  };
  return {
    canAuthorize: blockedReason === null,
    blockedReason,
    previewDigest: hash(snapshot),
    previousObservationId: observation.id,
    previousObservationDigest: observation.digest,
    previousRunId: previousRun.id,
    previousGeneration: previousRun.generation,
    nextGeneration: generation,
  };
}

export async function previewObservationRegeneration(
  db: Db,
  input: PreviewObservationRegenerationInput,
): Promise<ObservationRegenerationPreview> {
  validate(input);
  const now = time(input.now);
  return db.$transaction(async (tx) => {
    await lockOrg(tx, input.organizationId);
    await actor(tx, input.organizationId, input.clerkUserId);
    return preview(tx, input, now);
  });
}

export async function authorizeObservationRegeneration(
  db: Db,
  input: AuthorizeObservationRegenerationInput,
): Promise<ObservationRegenerationAuthorization> {
  const now = time(input.now);
  const reason = input.reason.trim();
  if (
    !reason ||
    reason.length > 1000 ||
    !/^[A-Za-z0-9_.-]{1,128}$/.test(input.idempotencyKey) ||
    !/^[a-f0-9]{64}$/.test(input.expectedPreviewDigest)
  )
    fail('INVALID_INPUT');
  return db.$transaction(async (tx) => {
    await lockOrg(tx, input.organizationId);
    const user = await actor(tx, input.organizationId, input.clerkUserId);
    const existing = await tx.observationRegeneration.findFirst({
      where: { organizationId: input.organizationId, idempotencyKey: input.idempotencyKey },
    });
    if (existing) {
      if (
        existing.createdByUserId !== user.id ||
        existing.reason !== reason ||
        existing.previewDigest !== input.expectedPreviewDigest ||
        existing.previousObservationId !== input.observationId ||
        existing.callId !== input.callId
      )
        fail('IDEMPOTENCY_CONFLICT');
      return { kind: 'ALREADY_AUTHORIZED', authorization: existing };
    }
    validate(input);
    const result = await preview(tx, input, now);
    if (result.previewDigest !== input.expectedPreviewDigest) fail('STALE_PREVIEW');
    if (result.blockedReason) fail(result.blockedReason);
    const observation = await tx.claimObservation.findFirstOrThrow({
      where: { organizationId: input.organizationId, id: result.previousObservationId },
    });
    const authorization = await tx.observationRegeneration.create({
      data: {
        organizationId: input.organizationId,
        claimId: observation.claimId,
        callId: input.callId,
        previousObservationId: result.previousObservationId,
        previousObservationDigest: result.previousObservationDigest,
        previousRunId: result.previousRunId,
        previousGeneration: result.previousGeneration,
        generation: result.nextGeneration,
        createdByUserId: user.id,
        createdByRole: user.role,
        reason,
        idempotencyKey: input.idempotencyKey,
        claimVersion: input.claimVersion,
        requestPayload: input.requestPayload,
        requestHash: input.requestHash,
        sourceHash: input.sourceHash,
        releaseId: input.releaseId,
        releasePolicyHash: input.releasePolicyHash,
        implementationArtifactSha256: input.implementationArtifactSha256,
        releaseSnapshot: input.releaseSnapshot,
        previewDigest: result.previewDigest,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 15 * 60_000),
      },
    });
    await audit(
      {
        organizationId: input.organizationId,
        userId: user.id,
        action: 'claimObservation.regeneration_authorized',
        resourceType: 'ObservationRegeneration',
        resourceId: authorization.id,
        metadata: {
          claimId: observation.claimId,
          callId: input.callId,
          generation: authorization.generation,
          previousRunId: authorization.previousRunId,
          previousObservationId: observation.id,
        },
      },
      tx,
    );
    return { kind: 'AUTHORIZED', authorization };
  });
}

/** Called under the native ledger's organization lock, only before new allocation or HTTP admission. */
export async function checkObservationRegenerationAdmission(
  tx: Tx,
  input: ObservationRegenerationAdmissionInput,
): Promise<ObservationRegenerationCode | null> {
  const authorization = await tx.observationRegeneration.findFirst({
    where: { id: input.regenerationId, organizationId: input.organizationId },
  });
  if (
    authorization?.callId !== input.callId ||
    authorization.claimId !== input.claimId ||
    authorization.claimVersion.getTime() !== input.claimVersion.getTime() ||
    authorization.requestHash !== input.requestHash ||
    authorization.sourceHash !== input.sourceHash ||
    authorization.releaseId !== input.releaseId ||
    authorization.releasePolicyHash !== input.releasePolicyHash ||
    authorization.implementationArtifactSha256 !== input.implementationArtifactSha256 ||
    canonical(authorization.requestPayload) !== canonical(input.requestPayload)
  )
    return 'AUTHORIZATION_INVALID';
  if (authorization.expiresAt <= input.now) return 'AUTHORIZATION_EXPIRED';
  if (!validRelease(authorization.releaseSnapshot, input, input.now))
    return 'AUTHORIZATION_INVALID';
  const user = await tx.user.findFirst({
    where: { id: authorization.createdByUserId, organizationId: input.organizationId },
  });
  if (!user || (user.role !== 'OWNER' && user.role !== 'ADMIN')) return 'FORBIDDEN';
  const newer = await tx.observationRegeneration.findFirst({
    where: {
      organizationId: input.organizationId,
      callId: input.callId,
      generation: { gt: authorization.generation },
    },
    select: { id: true },
  });
  if (newer) return 'AUTHORIZATION_SUPERSEDED';
  return currentBinding(tx, input, authorization.generation);
}
