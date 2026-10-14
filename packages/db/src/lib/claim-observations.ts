import { createHash } from 'node:crypto';

import type {
  ClaimObservation,
  ClaimObservationReview,
  InferenceRun,
  Prisma,
  User,
} from '@prisma/client';

import type { prisma } from '../client.js';

import { audit } from './audit.js';
import { enqueueReviewNotification, suppressReviewNotifications } from './review-notifications.js';

type Db = typeof prisma;
type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];
export const CLAIM_OBSERVATION_CONFLICT_CODES = [
  'NOT_FOUND',
  'FORBIDDEN',
  'INVALID_INPUT',
  'INVALID_INFERENCE_RESULT',
  'INFERENCE_NOT_READY',
  'REVIEW_CONFLICT',
  'OBSERVATION_STALE',
  'CLAIM_CHANGED',
] as const;
export type ClaimObservationConflictCode = (typeof CLAIM_OBSERVATION_CONFLICT_CODES)[number];
export class ClaimObservationConflictError extends Error {
  public constructor(public readonly code: ClaimObservationConflictCode) {
    super('Claim observation operation could not be completed.');
    this.name = 'ClaimObservationConflictError';
  }
}
export interface PublishClaimObservationInput {
  organizationId: string;
  runId: string;
  /** Produced by the worker's gateway schema and source-bound semantic validator, never API input. */
  validatedResult: Prisma.InputJsonValue;
  now?: Date;
}
export interface ClaimObservationPublication {
  kind: 'PUBLISHED' | 'ALREADY_PUBLISHED';
  observation: ClaimObservation;
}
export interface ReviewClaimObservationInput {
  organizationId: string;
  clerkUserId: string;
  observationId: string;
  expectedObservationDigest: string;
  expectedClaimVersion: Date;
  decision: 'ACKNOWLEDGED' | 'DISMISSED';
  note?: string | null;
  now?: Date;
}
export interface ClaimObservationReviewResult {
  kind: 'RECORDED' | 'ALREADY_RECORDED';
  review: ClaimObservationReview;
}
export interface ClaimObservationEligibility {
  isCurrent: boolean;
  canReview: boolean;
  reviewed: boolean;
  staleReason:
    | 'SUPERSEDED'
    | 'CLAIM_CHANGED'
    | 'NEWER_CALL'
    | 'TRANSCRIPT_CHANGED'
    | 'NEWER_GENERATION'
    | 'ALREADY_REVIEWED'
    | null;
}
export interface ClaimObservationEligibilityInput {
  organizationId: string;
  observationId: string;
  clerkUserId?: string;
}
const ROLES = ['OWNER', 'ADMIN', 'BILLING_STAFF'];
const TASK = 'claim-observation.v1';
const SCHEMA = 'claim-observation-schema.v1';
const PROMPT = 'claim-observation-prompt.v1';
function fail(code: ClaimObservationConflictCode): never {
  throw new ClaimObservationConflictError(code);
}
function now(value?: Date): Date {
  const time = value ?? new Date();
  if (!Number.isFinite(time.getTime())) fail('INVALID_INPUT');
  return time;
}
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const row = object(value);
  if (row)
    return `{${Object.keys(row)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
function jsonHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
async function lockOrg(tx: Tx, organizationId: string): Promise<void> {
  if (!organizationId) fail('INVALID_INPUT');
  const rows = await tx.$queryRaw<
    { id: string }[]
  >`SELECT "id" FROM "Organization" WHERE "id" = ${organizationId} FOR NO KEY UPDATE`;
  if (rows.length !== 1) fail('NOT_FOUND');
}
async function actor(db: Db | Tx, organizationId: string, clerkUserId: string): Promise<User> {
  if (!clerkUserId) fail('FORBIDDEN');
  const user = await db.user.findFirst({ where: { organizationId, clerkUserId } });
  if (!user || !ROLES.includes(user.role)) fail('FORBIDDEN');
  return user;
}

interface OrderedObservation {
  id: string;
  callId: string;
  sourceOrderAt: Date;
  generation: number;
}
async function currentObservation(
  db: Db | Tx,
  organizationId: string,
  claimId: string,
): Promise<OrderedObservation | null> {
  // A recovered Call can be inserted long after its actual submission. Its original
  // intent creation time, rather than recovery insertion time, orders its evidence.
  const rows = await db.$queryRaw<OrderedObservation[]>`
    SELECT o."id", o."callId", r."generation", COALESCE(i."createdAt", c."createdAt") AS "sourceOrderAt"
    FROM "ClaimObservation" o
    JOIN "InferenceRun" r ON r."id" = o."inferenceRunId" AND r."organizationId" = o."organizationId"
    JOIN "Call" c ON c."id" = o."callId" AND c."claimId" = o."claimId" AND c."organizationId" = o."organizationId"
    LEFT JOIN "CallIntent" i ON i."callId" = c."id" AND i."claimId" = c."claimId" AND i."organizationId" = c."organizationId"
    WHERE o."organizationId" = ${organizationId} AND o."claimId" = ${claimId}
    ORDER BY COALESCE(i."createdAt", c."createdAt") DESC, c."id" DESC, r."generation" DESC, o."version" DESC
    LIMIT 1`;
  return rows[0] ?? null;
}

function snapshots(
  run: InferenceRun,
  validatedResult: Prisma.InputJsonValue,
): {
  output: Prisma.InputJsonObject;
  sources: Prisma.InputJsonArray;
  provenance: Prisma.InputJsonObject;
  dataClass: 'SYNTHETIC' | 'PROTECTED';
} {
  const request = object(run.requestPayload);
  const result = object(run.resultPayload);
  const claim = object(request?.claim);
  const output = object(result?.output);
  const provenance = object(result?.provenance);
  if (
    !request ||
    !result ||
    !claim ||
    !output ||
    !provenance ||
    canonical(result) !== canonical(validatedResult) ||
    (result.status !== 'VALIDATED' && result.status !== 'ABSTAINED') ||
    request.organizationId !== run.organizationId ||
    claim.organizationId !== run.organizationId ||
    claim.id !== run.claimId ||
    claim.version !== run.claimVersion.toISOString() ||
    request.releaseId !== run.releaseId ||
    request.task !== TASK ||
    (request.dataClass !== 'SYNTHETIC' && request.dataClass !== 'PROTECTED') ||
    output.claimId !== run.claimId ||
    output.claimVersion !== run.claimVersion.toISOString() ||
    (result.status === 'ABSTAINED') !== (output.disposition === 'ABSTAIN') ||
    provenance.kind !== 'FIREWORKS' ||
    provenance.releaseId !== run.releaseId ||
    provenance.task !== TASK ||
    provenance.schemaVersion !== SCHEMA ||
    provenance.promptVersion !== PROMPT ||
    run.promptVersion !== PROMPT ||
    !Array.isArray(request.sources) ||
    request.sources.length < 1 ||
    request.sources.length > 8
  )
    fail('INVALID_INFERENCE_RESULT');
  const ids = new Set<string>();
  const sources = (request.sources as unknown[]).map((value) => {
    const source = object(value);
    if (
      !source ||
      typeof source.id !== 'string' ||
      !source.id ||
      ids.has(source.id) ||
      source.organizationId !== run.organizationId ||
      source.claimId !== run.claimId ||
      source.claimVersion !== run.claimVersion.toISOString() ||
      source.kind !== 'FINAL_CALL_TRANSCRIPT' ||
      typeof source.version !== 'string' ||
      typeof source.text !== 'string'
    )
      fail('INVALID_INFERENCE_RESULT');
    ids.add(source.id);
    // Frozen v1 schema order matches the request hash made at the gateway boundary.
    return {
      id: source.id,
      organizationId: source.organizationId,
      claimId: source.claimId,
      claimVersion: source.claimVersion,
      version: source.version,
      kind: source.kind,
      text: source.text,
    };
  });
  const orderedRequest = {
    organizationId: request.organizationId,
    invocationId: request.invocationId,
    releaseId: request.releaseId,
    task: request.task,
    dataClass: request.dataClass,
    claim: {
      id: claim.id,
      organizationId: claim.organizationId,
      version: claim.version,
      billedMinorUnits: claim.billedMinorUnits,
      currency: claim.currency,
    },
    sources,
  };
  if (jsonHash(sources) !== run.sourceHash || jsonHash(orderedRequest) !== run.requestHash)
    fail('INVALID_INFERENCE_RESULT');
  return {
    output: output as Prisma.InputJsonObject,
    sources,
    provenance: provenance as Prisma.InputJsonObject,
    dataClass: request.dataClass,
  };
}

async function verifySourceEvent(tx: Tx, run: InferenceRun): Promise<void> {
  const request = object(run.requestPayload);
  if (!Array.isArray(request?.sources) || request.sources.length !== 1)
    fail('INVALID_INFERENCE_RESULT');
  const source = object(request.sources[0]);
  if (!source || typeof source.id !== 'string' || !source.id.startsWith('transcript.'))
    fail('INVALID_INFERENCE_RESULT');
  const events = await tx.$queryRaw<{ data: Prisma.JsonValue }[]>`
    SELECT e."data" FROM "CallEvent" e JOIN "Call" c ON c."id" = e."callId"
    WHERE e."id" = ${source.id.slice('transcript.'.length)} AND e."callId" = ${run.callId}
      AND c."organizationId" = ${run.organizationId} AND c."claimId" = ${run.claimId}
      AND e."eventType" IN ('call.ended', 'webhook.call.ended')
    FOR SHARE OF e`;
  const transcript = object(object(events[0]?.data)?.transcript);
  const text = transcript?.text;
  if (
    typeof text !== 'string' ||
    !text.trim() ||
    source.text !== text ||
    source.version !== createHash('sha256').update(text).digest('hex')
  )
    fail('INVALID_INFERENCE_RESULT');
}

async function sourceIsCurrent(db: Db | Tx, observation: ClaimObservation): Promise<boolean> {
  if (!Array.isArray(observation.sources) || observation.sources.length !== 1) return false;
  const source = object(observation.sources[0]);
  const events = await db.$queryRaw<{ id: string; data: Prisma.JsonValue }[]>`
    SELECT e."id", e."data" FROM "CallEvent" e JOIN "Call" c ON c."id" = e."callId"
    WHERE e."callId" = ${observation.callId} AND c."organizationId" = ${observation.organizationId}
      AND c."claimId" = ${observation.claimId}
      AND e."eventType" IN ('call.ended', 'webhook.call.ended') AND e."data" ? 'transcript'
    ORDER BY e."timestamp" DESC, e."id" DESC
    LIMIT 1 FOR SHARE OF e`;
  // During review this shared row lock fences mutation/deletion through commit.
  // A concurrently appended correction can linearize after the snapshot review.
  const event = events[0];
  const text = object(object(event?.data)?.transcript)?.text;
  return (
    event !== undefined &&
    source?.id === `transcript.${event.id}` &&
    typeof text === 'string' &&
    text.trim().length > 0 &&
    source.text === text &&
    source.version === createHash('sha256').update(text).digest('hex')
  );
}

/** The organization lock serializes publication versions and the final inference marker. */
export async function publishClaimObservation(
  db: Db,
  input: PublishClaimObservationInput,
): Promise<ClaimObservationPublication> {
  const time = now(input.now);
  return db.$transaction(async (tx) => {
    await lockOrg(tx, input.organizationId);
    const run = await tx.inferenceRun.findFirst({
      where: { id: input.runId, organizationId: input.organizationId },
    });
    if (!run) fail('NOT_FOUND');
    if (run.provider !== 'FIREWORKS' || !['RESPONDED', 'APPLIED'].includes(run.state))
      fail('INFERENCE_NOT_READY');
    const snapshot = snapshots(run, input.validatedResult);
    const existing = await tx.claimObservation.findFirst({
      where: { organizationId: input.organizationId, inferenceRunId: run.id },
    });
    if (existing) {
      if (run.state !== 'APPLIED') fail('INVALID_INFERENCE_RESULT');
      return { kind: 'ALREADY_PUBLISHED', observation: existing };
    }
    if (run.state !== 'RESPONDED') fail('INVALID_INFERENCE_RESULT');
    await verifySourceEvent(tx, run);
    const call = await tx.call.findFirst({
      where: { id: run.callId, claimId: run.claimId, organizationId: run.organizationId },
      include: { intent: true },
    });
    if (!call) fail('INVALID_INFERENCE_RESULT');
    const previous = await tx.claimObservation.findFirst({
      where: { organizationId: run.organizationId, claimId: run.claimId },
      orderBy: { version: 'desc' },
    });
    const current = await currentObservation(tx, run.organizationId, run.claimId);
    const sourceOrderAt = call.intent?.createdAt ?? call.createdAt;
    const newerSource =
      !current ||
      sourceOrderAt > current.sourceOrderAt ||
      (sourceOrderAt.getTime() === current.sourceOrderAt.getTime() && call.id > current.callId) ||
      (call.id === current.callId && run.generation > current.generation);
    const data = {
      organizationId: run.organizationId,
      claimId: run.claimId,
      callId: run.callId,
      inferenceRunId: run.id,
      version: (previous?.version ?? 0) + 1,
      claimVersion: run.claimVersion,
      previousObservationId: previous?.id ?? null,
      supersedesObservationId: newerSource ? (current?.id ?? null) : null,
      sourceHash: run.sourceHash,
      requestHash: run.requestHash,
      releaseId: run.releaseId,
      provider: run.provider,
      promptVersion: run.promptVersion,
      schemaVersion: SCHEMA,
      taskVersion: TASK,
      ...snapshot,
    };
    const observation = await tx.claimObservation.create({
      data: {
        ...data,
        digest: digest({ ...data, claimVersion: data.claimVersion.toISOString() }),
        createdAt: time,
      },
    });
    await tx.inferenceRun.update({
      where: { id: run.id, organizationId: run.organizationId },
      data: { state: 'APPLIED', appliedAt: time, leaseToken: null, leaseExpiresAt: null },
    });
    await audit(
      {
        organizationId: run.organizationId,
        action: 'claimObservation.published',
        resourceType: 'ClaimObservation',
        resourceId: observation.id,
        metadata: {
          inferenceRunId: run.id,
          claimId: run.claimId,
          callId: run.callId,
          version: observation.version,
          dataClass: observation.dataClass,
        },
      },
      tx,
    );
    await enqueueReviewNotification(tx, {
      organizationId: run.organizationId,
      runId: run.id,
      purpose: 'REVIEW_AVAILABLE',
      now: time,
    });
    return { kind: 'PUBLISHED', observation };
  });
}

/** Source-call chronology, rather than arrival order, determines the currently reviewable evidence. */
export async function getClaimObservationEligibility(
  db: Db | Tx,
  input: ClaimObservationEligibilityInput,
): Promise<ClaimObservationEligibility> {
  if (!input.organizationId || !input.observationId) fail('INVALID_INPUT');
  if (input.clerkUserId !== undefined) await actor(db, input.organizationId, input.clerkUserId);
  const observation = await db.claimObservation.findFirst({
    where: { organizationId: input.organizationId, id: input.observationId },
    include: {
      call: { include: { intent: true } },
      review: true,
      claim: true,
      inferenceRun: { select: { generation: true } },
    },
  });
  if (!observation) fail('NOT_FOUND');
  const current = await currentObservation(db, input.organizationId, observation.claimId);
  const isCurrent = current?.id === observation.id;
  let staleReason: ClaimObservationEligibility['staleReason'] = !isCurrent
    ? 'SUPERSEDED'
    : observation.claim.updatedAt.getTime() !== observation.claimVersion.getTime()
      ? 'CLAIM_CHANGED'
      : null;
  if (!staleReason) {
    const sourceOrderAt = observation.call.intent?.createdAt ?? observation.call.createdAt;
    const newer = await db.$queryRaw<{ id: string }[]>`
      SELECT c."id" FROM "Call" c
      LEFT JOIN "CallIntent" i ON i."callId" = c."id" AND i."claimId" = c."claimId" AND i."organizationId" = c."organizationId"
      WHERE c."organizationId" = ${input.organizationId} AND c."claimId" = ${observation.claimId}
        AND (COALESCE(i."createdAt", c."createdAt") > ${sourceOrderAt}
          OR (COALESCE(i."createdAt", c."createdAt") = ${sourceOrderAt} AND c."id" > ${observation.callId}))
      LIMIT 1`;
    if (newer.length) staleReason = 'NEWER_CALL';
  }
  if (!staleReason && !(await sourceIsCurrent(db, observation))) staleReason = 'TRANSCRIPT_CHANGED';
  if (!staleReason) {
    const newerRun = await db.inferenceRun.findFirst({
      where: {
        organizationId: input.organizationId,
        callId: observation.callId,
        generation: { gt: observation.inferenceRun.generation },
      },
      select: { id: true },
    });
    const newerAuthorization = await db.observationRegeneration.findFirst({
      where: {
        organizationId: input.organizationId,
        callId: observation.callId,
        generation: { gt: observation.inferenceRun.generation },
        expiresAt: { gt: new Date() },
        inferenceRun: { is: null },
      },
      select: { id: true },
    });
    if (newerRun || newerAuthorization) staleReason = 'NEWER_GENERATION';
  }
  if (!staleReason && observation.review) staleReason = 'ALREADY_REVIEWED';
  return {
    isCurrent,
    canReview: staleReason === null,
    reviewed: observation.review !== null,
    staleReason,
  };
}

export async function reviewClaimObservation(
  db: Db,
  input: ReviewClaimObservationInput,
): Promise<ClaimObservationReviewResult> {
  const time = now(input.now);
  if (
    !input.observationId ||
    !/^[a-f0-9]{64}$/.test(input.expectedObservationDigest) ||
    !(input.expectedClaimVersion instanceof Date) ||
    !Number.isFinite(input.expectedClaimVersion.getTime()) ||
    !['ACKNOWLEDGED', 'DISMISSED'].includes(input.decision) ||
    (input.note !== undefined && input.note !== null && typeof input.note !== 'string')
  )
    fail('INVALID_INPUT');
  const trimmedNote = input.note?.trim() ?? '';
  const note = trimmedNote.length > 0 ? trimmedNote : null;
  if ((note?.length ?? 0) > 1000 || (input.decision === 'DISMISSED' && !note))
    fail('INVALID_INPUT');
  return db.$transaction(async (tx) => {
    await lockOrg(tx, input.organizationId);
    const user = await actor(tx, input.organizationId, input.clerkUserId);
    const observation = await tx.claimObservation.findFirst({
      where: { id: input.observationId, organizationId: input.organizationId },
    });
    if (!observation) fail('NOT_FOUND');
    if (
      observation.digest !== input.expectedObservationDigest ||
      observation.claimVersion.getTime() !== input.expectedClaimVersion.getTime()
    )
      fail('REVIEW_CONFLICT');
    const existing = await tx.claimObservationReview.findFirst({
      where: { organizationId: input.organizationId, observationId: observation.id },
    });
    if (existing) {
      if (
        existing.reviewedByUserId !== user.id ||
        existing.decision !== input.decision ||
        existing.note !== note
      )
        fail('REVIEW_CONFLICT');
      return { kind: 'ALREADY_RECORDED', review: existing };
    }
    await tx.$queryRaw`SELECT "id" FROM "Claim" WHERE "id" = ${observation.claimId} AND "organizationId" = ${input.organizationId} FOR NO KEY UPDATE`;
    const eligibility = await getClaimObservationEligibility(tx, {
      organizationId: input.organizationId,
      observationId: observation.id,
    });
    if (!eligibility.canReview)
      fail(eligibility.staleReason === 'CLAIM_CHANGED' ? 'CLAIM_CHANGED' : 'OBSERVATION_STALE');
    const review = await tx.claimObservationReview.create({
      data: {
        organizationId: input.organizationId,
        claimId: observation.claimId,
        observationId: observation.id,
        reviewedByUserId: user.id,
        reviewedByRole: user.role,
        decision: input.decision,
        note,
        observationDigest: observation.digest,
        claimVersion: observation.claimVersion,
        reviewedAt: time,
      },
    });
    await audit(
      {
        organizationId: input.organizationId,
        userId: user.id,
        action: 'claimObservation.reviewed',
        resourceType: 'ClaimObservation',
        resourceId: observation.id,
        metadata: {
          decision: input.decision,
          version: observation.version,
          noteProvided: note !== null,
        },
      },
      tx,
    );
    await suppressReviewNotifications(tx, {
      organizationId: input.organizationId,
      runId: observation.inferenceRunId,
      now: time,
    });
    return { kind: 'RECORDED', review };
  });
}
