import { createHash } from 'node:crypto';

import { audit, Prisma, type JobOutbox } from '@dentabill/db';
import { CallJobDataSchema, SummaryJobDataSchema } from '@dentabill/queue';
import { z } from 'zod';

import type { DbClient } from './handler.js';

export const JobRecoveryBlockedReasonSchema = z.enum([
  'NOT_QUARANTINED',
  'ACTIVE_LEASE',
  'PAYLOAD_INVALID',
  'DOMAIN_BINDING_MISMATCH',
  'CLAIM_CHANGED',
  'CLAIM_NOT_QUEUED',
  'CALL_RECONCILIATION_REQUIRED',
  'CALL_OBSERVATION_REQUIRED',
  'SUMMARY_RETRY_UNSAFE',
  'DELIVERY_NOT_EXHAUSTED',
]);
export type JobRecoveryBlockedReason = z.infer<typeof JobRecoveryBlockedReasonSchema>;
export interface JobRecoveryPreview {
  id: string;
  kind: JobOutbox['kind'];
  state: JobOutbox['state'];
  deliveryAttempts: number;
  deliveryAttemptLimit: number;
  recoveryCount: number;
  lastErrorCode: string | null;
  availableAt: string;
  leaseExpiresAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deliveredAt: string | null;
  reviewVersion: string;
  action: 'RETRY' | 'CLOSE' | 'BLOCKED';
  blockedReason: JobRecoveryBlockedReason | null;
  followUp: {
    kind: 'CALL_RECONCILIATION' | 'CALL_OBSERVATION';
    intentId: string;
    claimId: string;
    callId: string | null;
  } | null;
}
export type JobRecoveryResult =
  | { ok: true; preview: JobRecoveryPreview }
  | {
      ok: false;
      code: 'FORBIDDEN' | 'NOT_FOUND' | 'STALE_REVIEW' | 'RECOVERY_BLOCKED' | 'RECOVERY_FAILED';
      preview?: JobRecoveryPreview;
    };
export interface PreviewJobRecoveryOptions {
  prisma: DbClient;
  organizationId: string;
  outboxId: string;
  clerkUserId: string;
  clock?: () => Date;
}
export interface RecoverJobOutboxOptions extends PreviewJobRecoveryOptions {
  action: 'RETRY' | 'CLOSE';
  reviewVersion: string;
}

type RecoveryDb = Omit<
  DbClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
const SAFE_ERRORS = new Set([
  'PAYLOAD_INVALID',
  'DELIVERY_EXHAUSTED',
  'DISPATCH_FAILED',
  'DISPATCH_TIMEOUT',
]);
const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function evaluate(
  db: RecoveryDb,
  row: JobOutbox,
  now: Date,
  lockDomain = false,
): Promise<JobRecoveryPreview> {
  let action: JobRecoveryPreview['action'] = 'BLOCKED';
  let blockedReason: JobRecoveryBlockedReason | null = null;
  let followUp: JobRecoveryPreview['followUp'] = null;
  let domain: unknown = null;
  const callPayload =
    row.kind === 'CALL_PLACE' ? CallJobDataSchema.strict().safeParse(row.payload) : null;
  const summaryPayload =
    row.kind === 'SUMMARY_GENERATE' ? SummaryJobDataSchema.strict().safeParse(row.payload) : null;
  const parsed = callPayload ?? summaryPayload;
  if (
    !parsed?.success ||
    parsed.data.organizationId !== row.organizationId ||
    parsed.data.idempotencyKey !== row.idempotencyKey ||
    digest(parsed.data) !== row.payloadHash
  ) {
    blockedReason = 'PAYLOAD_INVALID';
  } else if (callPayload?.success) {
    const data = callPayload.data;
    if (lockDomain) {
      await db.$queryRaw`SELECT id FROM "Claim" WHERE id = ${data.claimId} AND "organizationId" = ${row.organizationId} FOR SHARE`;
      if (data.resume)
        await db.$queryRaw`SELECT id FROM "CallIntent" WHERE id = ${data.resume.intentId} AND "organizationId" = ${row.organizationId} FOR SHARE`;
      else
        await db.$queryRaw`SELECT id FROM "CallIntent" WHERE "idempotencyKey" = ${data.idempotencyKey} AND "organizationId" = ${row.organizationId} FOR SHARE`;
    }
    const intent = await db.callIntent.findFirst({
      where: {
        organizationId: row.organizationId,
        ...(data.resume ? { id: data.resume.intentId } : { idempotencyKey: data.idempotencyKey }),
      },
      select: {
        id: true,
        claimId: true,
        idempotencyKey: true,
        state: true,
        callId: true,
        payerCode: true,
        attemptNumber: true,
        claimPriority: true,
        claimVersion: true,
        updatedAt: true,
        requestHash: true,
        submittedAt: true,
      },
    });
    const claim = await db.claim.findFirst({
      where: { id: data.claimId, organizationId: row.organizationId },
      select: { id: true, status: true, updatedAt: true },
    });
    const boundCall = intent?.callId
      ? await db.call.findFirst({
          where: { id: intent.callId, organizationId: row.organizationId, claimId: data.claimId },
          select: { id: true, status: true, endedAt: true },
        })
      : null;
    domain = { intent, claim, boundCall };
    if (
      !intent ||
      !claim ||
      intent.claimId !== data.claimId ||
      intent.payerCode !== data.payerCode ||
      intent.attemptNumber !== data.attemptNumber ||
      intent.claimPriority !== data.claimPriority ||
      (intent.callId !== null && !boundCall) ||
      (data.resume &&
        (data.idempotencyKey !== `call.resume.${intent.id}` ||
          data.resume.callId !== intent.callId))
    ) {
      blockedReason = 'DOMAIN_BINDING_MISMATCH';
    } else if (intent.state === 'SUBMITTING' || intent.state === 'UNKNOWN') {
      blockedReason = 'CALL_RECONCILIATION_REQUIRED';
      followUp = {
        kind: 'CALL_RECONCILIATION',
        intentId: intent.id,
        claimId: intent.claimId,
        callId: intent.callId,
      };
    } else if (intent.state === 'ACCEPTED') {
      if (!boundCall) blockedReason = 'DOMAIN_BINDING_MISMATCH';
      else {
        blockedReason = 'CALL_OBSERVATION_REQUIRED';
        followUp = {
          kind: 'CALL_OBSERVATION',
          intentId: intent.id,
          claimId: intent.claimId,
          callId: intent.callId,
        };
      }
    } else if (intent.state === 'TERMINAL' || intent.state === 'CANCELLED') {
      if (intent.state === 'TERMINAL' && !boundCall) blockedReason = 'DOMAIN_BINDING_MISMATCH';
      else action = 'CLOSE';
    } else if (
      data.resume ||
      intent.callId !== null ||
      intent.submittedAt !== null ||
      intent.requestHash !== null
    )
      blockedReason = 'DOMAIN_BINDING_MISMATCH';
    else if (claim.updatedAt.getTime() !== intent.claimVersion.getTime())
      blockedReason = 'CLAIM_CHANGED';
    else if (claim.status !== 'IN_QUEUE') blockedReason = 'CLAIM_NOT_QUEUED';
    else action = 'RETRY';
  } else if (summaryPayload?.success) {
    const data = summaryPayload.data;
    if (lockDomain) {
      await db.$queryRaw`SELECT id FROM "Call" WHERE id = ${data.callId} AND "organizationId" = ${row.organizationId} FOR SHARE`;
      await db.$queryRaw`SELECT id FROM "CallSummary" WHERE "callId" = ${data.callId} AND "organizationId" = ${row.organizationId} FOR SHARE`;
    }
    const call = await db.call.findFirst({
      where: { id: data.callId, organizationId: row.organizationId },
      select: { id: true, claimId: true, status: true, endedAt: true },
    });
    const summary = await db.callSummary.findFirst({
      where: { callId: data.callId, organizationId: row.organizationId },
      select: { id: true, callId: true, createdAt: true },
    });
    domain = { call, summary };
    const baseKey = `call.${data.callId}`;
    const retryPrefix = `${baseKey}.retry.`;
    const boundKey =
      data.idempotencyKey === baseKey ||
      (data.idempotencyKey.startsWith(retryPrefix) &&
        /^[1-9][0-9]*$/.test(data.idempotencyKey.slice(retryPrefix.length)));
    if (!call || !boundKey) blockedReason = 'DOMAIN_BINDING_MISMATCH';
    else if (summary) action = 'CLOSE';
    else blockedReason = 'SUMMARY_RETRY_UNSAFE';
  }
  if (action === 'RETRY' && row.deliveryAttempts < row.deliveryAttemptLimit) {
    action = 'BLOCKED';
    blockedReason = 'DELIVERY_NOT_EXHAUSTED';
  }
  if (row.state !== 'QUARANTINED') {
    action = 'BLOCKED';
    blockedReason = 'NOT_QUARANTINED';
  } else if (
    (row.leaseExpiresAt && row.leaseExpiresAt > now) ||
    (row.leaseToken && !row.leaseExpiresAt)
  ) {
    action = 'BLOCKED';
    blockedReason = 'ACTIVE_LEASE';
  }
  const preview: JobRecoveryPreview = {
    id: row.id,
    kind: row.kind,
    state: row.state,
    deliveryAttempts: row.deliveryAttempts,
    deliveryAttemptLimit: row.deliveryAttemptLimit,
    recoveryCount: row.recoveryCount,
    lastErrorCode:
      row.lastErrorCode === null
        ? null
        : SAFE_ERRORS.has(row.lastErrorCode)
          ? row.lastErrorCode
          : 'UNKNOWN',
    availableAt: row.availableAt.toISOString(),
    leaseExpiresAt: row.leaseExpiresAt?.toISOString() ?? null,
    closedAt: row.closedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    reviewVersion: '',
    action,
    blockedReason,
    followUp,
  };
  preview.reviewVersion = digest({
    preview,
    payloadHash: row.payloadHash,
    leaseToken: row.leaseToken,
    domain,
  });
  return preview;
}

async function load(db: RecoveryDb, options: PreviewJobRecoveryOptions, lock = false) {
  if (lock)
    await db.$queryRaw`SELECT id FROM "User" WHERE "clerkUserId" = ${options.clerkUserId} AND "organizationId" = ${options.organizationId} FOR SHARE`;
  const actor = await db.user.findFirst({
    where: {
      organizationId: options.organizationId,
      clerkUserId: options.clerkUserId,
      role: { in: ['OWNER', 'ADMIN'] },
    },
    select: { id: true },
  });
  if (!actor) return { ok: false, code: 'FORBIDDEN' } as const;
  if (lock)
    await db.$queryRaw`SELECT id FROM "JobOutbox" WHERE id = ${options.outboxId} AND "organizationId" = ${options.organizationId} FOR UPDATE`;
  const row = await db.jobOutbox.findFirst({
    where: { id: options.outboxId, organizationId: options.organizationId },
  });
  if (!row) return { ok: false, code: 'NOT_FOUND' } as const;
  return { ok: true, row, actor } as const;
}

/** Safe review metadata only; payloads and transcripts never leave the core. */
export async function previewJobRecovery(
  options: PreviewJobRecoveryOptions,
): Promise<JobRecoveryResult> {
  try {
    const loaded = await load(options.prisma, options);
    if (!loaded.ok) return loaded;
    return {
      ok: true,
      preview: await evaluate(options.prisma, loaded.row, options.clock?.() ?? new Date()),
    };
  } catch {
    return { ok: false, code: 'RECOVERY_FAILED' };
  }
}

/** Approval changes only delivery allowance/disposition; it never resets domain ownership. */
export async function recoverJobOutbox(
  options: RecoverJobOutboxOptions,
): Promise<JobRecoveryResult> {
  if (!z.enum(['RETRY', 'CLOSE']).safeParse(options.action).success)
    return { ok: false, code: 'RECOVERY_BLOCKED' };
  try {
    return await options.prisma.$transaction(
      async (tx) => {
        const loaded = await load(tx, options, true);
        if (!loaded.ok) return loaded;
        const { row, actor } = loaded;
        const now = options.clock?.() ?? new Date();
        const preview = await evaluate(tx, row, now, true);
        if (preview.reviewVersion !== options.reviewVersion)
          return { ok: false, code: 'STALE_REVIEW', preview };
        if (preview.action !== options.action)
          return { ok: false, code: 'RECOVERY_BLOCKED', preview };
        const changed = await tx.jobOutbox.updateMany({
          where: {
            id: row.id,
            organizationId: row.organizationId,
            state: 'QUARANTINED',
            updatedAt: row.updatedAt,
            payloadHash: row.payloadHash,
            deliveryAttempts: row.deliveryAttempts,
            deliveryAttemptLimit: row.deliveryAttemptLimit,
            recoveryCount: row.recoveryCount,
            leaseToken: row.leaseToken,
            leaseExpiresAt: row.leaseExpiresAt,
          },
          data:
            options.action === 'RETRY'
              ? {
                  state: 'PENDING',
                  deliveryAttemptLimit: row.deliveryAttempts + 3,
                  recoveryCount: { increment: 1 },
                  availableAt: now,
                  leaseToken: null,
                  leaseExpiresAt: null,
                  lastErrorCode: null,
                }
              : { state: 'CLOSED', closedAt: now, leaseToken: null, leaseExpiresAt: null },
        });
        if (changed.count !== 1) return { ok: false, code: 'STALE_REVIEW' };
        await audit(
          {
            organizationId: row.organizationId,
            userId: actor.id,
            action: options.action === 'RETRY' ? 'jobOutbox.retried' : 'jobOutbox.closed',
            resourceType: 'JobOutbox',
            resourceId: row.id,
            metadata: {
              kind: row.kind,
              reviewVersion: options.reviewVersion,
              deliveryAttempts: row.deliveryAttempts,
              deliveryAttemptLimit:
                options.action === 'RETRY' ? row.deliveryAttempts + 3 : row.deliveryAttemptLimit,
              recoveryCount: row.recoveryCount + (options.action === 'RETRY' ? 1 : 0),
            },
          },
          tx,
        );
        const updated = await tx.jobOutbox.findFirstOrThrow({
          where: { id: row.id, organizationId: row.organizationId },
        });
        return { ok: true, preview: await evaluate(tx, updated, now) };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    return {
      ok: false,
      code:
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' ||
          (error.code === 'P2010' &&
            (error.meta?.code === '40001' || error.meta?.code === '40P01')))
          ? 'STALE_REVIEW'
          : 'RECOVERY_FAILED',
    };
  }
}
