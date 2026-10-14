import { createHash, randomUUID } from 'node:crypto';

import { Prisma, type ReviewNotificationIntent } from '@prisma/client';

import type { prisma } from '../client.js';

import { audit } from './audit.js';

type Db = typeof prisma;
type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0];
const LEASE_MS = 60_000;
const DEADLINE_MS = 23 * 60 * 60_000;
export type ReviewNotificationPurpose = 'REVIEW_AVAILABLE' | 'INFERENCE_REVIEW_REQUIRED';
export type ReviewNotificationReason =
  | 'MISSING_RECIPIENT'
  | 'RECIPIENT_CHANGED'
  | 'SOURCE_NOT_READY'
  | 'SOURCE_REVIEWED'
  | 'SOURCE_SUPERSEDED'
  | 'SOURCE_CHANGED'
  | 'DEADLINE_EXPIRED'
  | 'ATTEMPTS_EXHAUSTED'
  | 'TRANSPORT_UNKNOWN'
  | 'TRANSPORT_RETRYABLE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'PAYLOAD_INVALID'
  | 'TRANSPORT_REJECTED'
  | 'LEASE_EXPIRED';
export interface ReviewNotificationPayload {
  to: string;
  templateVersion: 'review-available.v1';
  subject: 'Review available in DentaBill';
  text: 'A review is available. Sign in to DentaBill and open Claims to review it.';
  appPath: '/dashboard/claims';
}
export type ReviewNotificationOwnership =
  | {
      kind: 'OWNED';
      notificationId: string;
      attemptId: string;
      leaseToken: string;
      deliveryKey: string;
      payload: ReviewNotificationPayload;
      payloadHash: string;
      mode: 'SYNTHETIC';
      leaseExpiresAt: Date;
      retryDeadlineAt: Date;
    }
  | { kind: 'NOT_FOUND' | 'BUSY' | 'TERMINAL' | 'BLOCKED'; state?: string; reason?: string | null };
export interface CompleteReviewNotificationInput {
  organizationId: string;
  notificationId: string;
  attemptId: string;
  leaseToken: string;
  outcome: 'SIMULATED' | 'ACCEPTED' | 'UNKNOWN' | 'RETRYABLE' | 'CONFLICT';
  code?:
    | 'TRANSPORT_UNKNOWN'
    | 'TRANSPORT_RETRYABLE'
    | 'IDEMPOTENCY_CONFLICT'
    | 'PAYLOAD_INVALID'
    | 'TRANSPORT_REJECTED'
    | 'DEADLINE_EXPIRED'
    | null;
  providerReceiptId?: string | null;
  acceptedAt?: Date | null;
  retryAfterMs?: number | null;
  now?: Date;
}
function fail(): never {
  throw new Error('REVIEW_NOTIFICATION_CONFLICT');
}
function clock(value?: Date): Date {
  const now = value ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) fail();
  return now;
}
function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function payload(to: string): ReviewNotificationPayload {
  return {
    to,
    templateVersion: 'review-available.v1',
    subject: 'Review available in DentaBill',
    text: 'A review is available. Sign in to DentaBill and open Claims to review it.',
    appPath: '/dashboard/claims',
  };
}
async function lock(tx: Tx, organizationId: string): Promise<void> {
  if (
    !organizationId ||
    (await tx.$executeRaw`UPDATE "Organization" SET id=id WHERE id=${organizationId}`) !== 1
  )
    fail();
}
async function blocker(
  tx: Tx,
  organizationId: string,
  id: string,
  now: Date,
): Promise<string | null> {
  const [row] = await tx.$queryRaw<
    { reason: string | null }[]
  >`SELECT dentabill_notification_blocker(${organizationId},${id}::uuid,${now}::timestamp) AS reason`;
  return row?.reason ?? null;
}
async function log(
  tx: Tx,
  organizationId: string,
  id: string,
  action: string,
  metadata: Record<string, unknown>,
  userId?: string,
): Promise<void> {
  await audit(
    {
      action,
      resourceType: 'ReviewNotificationIntent',
      resourceId: id,
      organizationId,
      ...(userId ? { userId } : {}),
      metadata,
    },
    tx,
  );
}

/** Called inside the source publication/review transaction; all bindings are read from retained rows. */
export async function enqueueReviewNotification(
  tx: Tx,
  input: {
    organizationId: string;
    runId: string;
    purpose: ReviewNotificationPurpose;
    now?: Date;
  },
): Promise<{ kind: 'CREATED' | 'EXISTING'; notification: ReviewNotificationIntent }> {
  const now = clock(input.now);
  await lock(tx, input.organizationId);
  const existing = await tx.reviewNotificationIntent.findFirst({
    where: {
      organizationId: input.organizationId,
      inferenceRunId: input.runId,
      purpose: input.purpose,
    },
  });
  if (existing) return { kind: 'EXISTING', notification: existing };
  const run = await tx.inferenceRun.findFirstOrThrow({
    where: { id: input.runId, organizationId: input.organizationId },
  });
  const claim = await tx.claim.findFirstOrThrow({
    where: { id: run.claimId, organizationId: input.organizationId },
  });
  const observation =
    input.purpose === 'REVIEW_AVAILABLE' && run.provider === 'FIREWORKS'
      ? await tx.claimObservation.findFirst({
          where: { inferenceRunId: run.id, organizationId: input.organizationId },
        })
      : null;
  const regeneration = run.regenerationId
    ? await tx.observationRegeneration.findFirstOrThrow({
        where: {
          id: run.regenerationId,
          organizationId: input.organizationId,
        },
      })
    : null;
  const [recipient] = await tx.$queryRaw<{ id: string; role: 'OWNER' | 'ADMIN'; email: string }[]>`
    SELECT id,role,email FROM "User" WHERE "organizationId"=${input.organizationId} AND role IN ('OWNER','ADMIN')
    AND dentabill_notification_email_valid(email) ORDER BY "createdAt",id LIMIT 1 FOR SHARE`;
  const outbound = recipient ? payload(recipient.email) : null;
  const marker = input.purpose === 'REVIEW_AVAILABLE' ? run.appliedAt : run.reviewAppliedAt;
  if (!marker) fail();
  const notification = await tx.reviewNotificationIntent.create({
    data: {
      organizationId: input.organizationId,
      inferenceRunId: run.id,
      claimId: run.claimId,
      callId: run.callId,
      generation: run.generation,
      sourceHash: run.sourceHash,
      requestHash: run.requestHash,
      claimVersion: run.claimVersion,
      resultingClaimVersion: claim.updatedAt,
      sourceMarkerAt: marker,
      purpose: input.purpose,
      observationId: observation?.id ?? null,
      summaryId:
        input.purpose === 'REVIEW_AVAILABLE' && run.provider === 'SYNTHETIC' ? run.summaryId : null,
      regenerationId: regeneration?.id ?? null,
      actorKind: regeneration ? 'USER' : 'SYSTEM',
      actorUserId: regeneration?.createdByUserId ?? null,
      actorRole: regeneration?.createdByRole ?? null,
      recipientUserId: recipient?.id ?? null,
      recipientRole: recipient?.role ?? null,
      recipientEmail: recipient?.email ?? null,
      recipientSelectionVersion: 'oldest-owner-admin.v1',
      templateVersion: 'review-available.v1',
      payload: outbound ? { ...outbound } : Prisma.DbNull,
      payloadHash: outbound ? hash(outbound) : null,
      deliveryKey: randomUUID(),
      createdAt: now,
    },
  });
  const reason = recipient
    ? await blocker(tx, input.organizationId, notification.id, now)
    : 'MISSING_RECIPIENT';
  const state =
    reason === null
      ? 'PENDING'
      : ['MISSING_RECIPIENT', 'RECIPIENT_CHANGED'].includes(reason)
        ? 'BLOCKED'
        : 'SUPPRESSED';
  await tx.reviewNotificationDelivery.create({
    data: {
      notificationId: notification.id,
      organizationId: input.organizationId,
      state,
      reason,
      availableAt: now,
      updatedAt: now,
    },
  });
  await log(
    tx,
    input.organizationId,
    notification.id,
    'notification.enqueued',
    { purpose: input.purpose, state, reason },
    regeneration?.createdByUserId,
  );
  return { kind: 'CREATED', notification };
}

/** Reserves the permanent key before the only permitted (synthetic) submission boundary. */
export async function beginReviewNotificationAttempt(
  db: Db,
  input: {
    organizationId: string;
    notificationId: string;
    now?: Date;
  },
): Promise<ReviewNotificationOwnership> {
  const now = clock(input.now);
  return db.$transaction(async (tx) => {
    await lock(tx, input.organizationId);
    const n = await tx.reviewNotificationIntent.findFirst({
      where: { id: input.notificationId, organizationId: input.organizationId },
      include: { delivery: true },
    });
    if (!n?.delivery) return { kind: 'NOT_FOUND' };
    const d = n.delivery;
    if (['SIMULATED', 'ACCEPTED', 'SUPPRESSED', 'QUARANTINED'].includes(d.state))
      return { kind: 'TERMINAL', state: d.state, reason: d.reason };
    if (now < d.updatedAt || (d.state === 'SENDING' && d.leaseExpiresAt && now < d.leaseExpiresAt))
      return { kind: 'BUSY', state: d.state, reason: d.reason };
    const reason =
      n.recipientUserId === null
        ? 'MISSING_RECIPIENT'
        : await blocker(tx, input.organizationId, n.id, now);
    const stop =
      reason ??
      (d.retryDeadlineAt && now >= d.retryDeadlineAt
        ? 'DEADLINE_EXPIRED'
        : d.attemptCount >= 5
          ? 'ATTEMPTS_EXHAUSTED'
          : null);
    if (stop) {
      const state = d.firstSubmissionAt
        ? 'QUARANTINED'
        : ['MISSING_RECIPIENT', 'RECIPIENT_CHANGED'].includes(stop)
          ? 'BLOCKED'
          : 'SUPPRESSED';
      if (d.state !== state || d.reason !== stop) {
        await tx.reviewNotificationDelivery.update({
          where: { notificationId: n.id, organizationId: input.organizationId },
          data: {
            state,
            reason: stop,
            activeAttemptId: null,
            leaseToken: null,
            leaseExpiresAt: null,
            availableAt: now,
            updatedAt: now,
            ambiguous: d.ambiguous || d.state === 'SENDING',
          },
        });
        await log(tx, input.organizationId, n.id, `notification.${state.toLowerCase()}`, {
          reason: stop,
          state,
        });
      }
      return { kind: state === 'BLOCKED' ? 'BLOCKED' : 'TERMINAL', state, reason: stop };
    }
    // A frozen blocked recipient is never rebound or reset, even if the user later changes back.
    if (d.state === 'BLOCKED') return { kind: 'BLOCKED', state: d.state, reason: d.reason };
    if (now < d.availableAt) return { kind: 'BUSY', state: d.state, reason: d.reason };
    if (!n.recipientEmail || !n.payloadHash) fail();
    const outbound = payload(n.recipientEmail);
    if (hash(outbound) !== n.payloadHash) fail();
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_MS);
    const retryDeadlineAt = d.retryDeadlineAt ?? new Date(now.getTime() + DEADLINE_MS);
    const attempt = await tx.reviewNotificationAttempt.create({
      data: {
        organizationId: input.organizationId,
        notificationId: n.id,
        attemptNumber: d.attemptCount + 1,
        mode: 'SYNTHETIC',
        deliveryKey: n.deliveryKey,
        payloadHash: n.payloadHash,
        leaseToken,
        startedAt: now,
        leaseExpiresAt,
      },
    });
    await tx.reviewNotificationDelivery.update({
      where: { notificationId: n.id, organizationId: input.organizationId },
      data: {
        state: 'SENDING',
        reason: null,
        mode: 'SYNTHETIC',
        attemptCount: attempt.attemptNumber,
        activeAttemptId: attempt.id,
        leaseToken,
        leaseExpiresAt,
        firstSubmissionAt: d.firstSubmissionAt ?? now,
        retryDeadlineAt,
        availableAt: now,
        updatedAt: now,
        ambiguous: d.ambiguous || d.state === 'SENDING',
      },
    });
    await log(tx, input.organizationId, n.id, 'notification.attempt_started', {
      attemptId: attempt.id,
      attemptNumber: attempt.attemptNumber,
      mode: 'SYNTHETIC',
    });
    return {
      kind: 'OWNED',
      notificationId: n.id,
      attemptId: attempt.id,
      leaseToken,
      deliveryKey: n.deliveryKey,
      payload: outbound,
      payloadHash: n.payloadHash,
      mode: 'SYNTHETIC',
      leaseExpiresAt,
      retryDeadlineAt,
    };
  });
}

export async function completeReviewNotificationAttempt(
  db: Db,
  input: CompleteReviewNotificationInput,
): Promise<{ kind: 'RECORDED' | 'EXISTING' | 'STALE'; state: string }> {
  const now = clock(input.now);
  const acceptedAt = input.acceptedAt == null ? null : clock(input.acceptedAt);
  const code = input.code ?? null;
  const providerReceiptId = input.providerReceiptId ?? null;
  const retryAfterMs = input.retryAfterMs ?? null;
  if (
    retryAfterMs !== null &&
    (!Number.isSafeInteger(retryAfterMs) || retryAfterMs <= 0 || retryAfterMs > DEADLINE_MS)
  )
    fail();
  if (
    providerReceiptId !== null &&
    (!providerReceiptId.length ||
      providerReceiptId.length > 200 ||
      providerReceiptId.trim() !== providerReceiptId ||
      /[\p{Cc}\p{Cf}\p{Cs}]/u.test(providerReceiptId))
  )
    fail();
  const result = {
    outcome: input.outcome,
    code,
    providerReceiptId,
    acceptedAt: acceptedAt?.toISOString() ?? null,
    retryAfterMs,
  };
  const receiptHash = hash(result);
  return db.$transaction(async (tx) => {
    await lock(tx, input.organizationId);
    const a = await tx.reviewNotificationAttempt.findFirst({
      where: {
        id: input.attemptId,
        notificationId: input.notificationId,
        organizationId: input.organizationId,
      },
      include: { receipt: true },
    });
    const d = await tx.reviewNotificationDelivery.findFirst({
      where: { notificationId: input.notificationId, organizationId: input.organizationId },
    });
    if (!a || !d || a.leaseToken !== input.leaseToken)
      return { kind: 'STALE', state: d?.state ?? 'UNKNOWN' };
    if (a.receipt) {
      if (a.receipt.receiptHash !== receiptHash) fail();
      return { kind: 'EXISTING', state: d.state };
    }
    if (
      d.state !== 'SENDING' ||
      d.activeAttemptId !== a.id ||
      d.leaseToken !== input.leaseToken ||
      !d.leaseExpiresAt ||
      now >= d.leaseExpiresAt ||
      now < a.startedAt
    )
      return { kind: 'STALE', state: d.state };
    await tx.reviewNotificationReceipt.create({
      data: {
        organizationId: input.organizationId,
        notificationId: input.notificationId,
        attemptId: a.id,
        outcome: input.outcome,
        code,
        providerReceiptId,
        acceptedAt,
        retryAfterMs,
        receiptHash,
        completedAt: now,
      },
    });
    let state = 'PENDING';
    let reason: string | null = code;
    let availableAt = now;
    let ambiguous = d.ambiguous || input.outcome === 'UNKNOWN' || input.outcome === 'CONFLICT';
    if (input.outcome === 'SIMULATED') {
      state = 'SIMULATED';
      ambiguous = false;
    } else if (input.outcome === 'CONFLICT') state = 'QUARANTINED';
    else if (d.attemptCount >= 5) {
      state = 'QUARANTINED';
      reason = 'ATTEMPTS_EXHAUSTED';
    } else {
      availableAt = new Date(now.getTime() + Math.max(LEASE_MS, retryAfterMs ?? 0));
      if (!d.retryDeadlineAt || availableAt >= d.retryDeadlineAt) {
        state = 'QUARANTINED';
        reason = 'DEADLINE_EXPIRED';
        availableAt = now;
      }
    }
    await tx.reviewNotificationDelivery.update({
      where: { notificationId: d.notificationId, organizationId: input.organizationId },
      data: {
        state,
        reason,
        availableAt,
        ambiguous,
        updatedAt: now,
        activeAttemptId: null,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    await log(tx, input.organizationId, input.notificationId, 'notification.receipt_saved', {
      attemptId: a.id,
      outcome: input.outcome,
      code,
      state,
    });
    return { kind: 'RECORDED', state };
  });
}

/** Human source acknowledgement only suppresses intents which never reached a submission boundary. */
export async function suppressReviewNotifications(
  tx: Tx,
  input: { organizationId: string; runId: string; now?: Date },
): Promise<number> {
  const now = clock(input.now);
  await lock(tx, input.organizationId);
  const notifications = await tx.reviewNotificationIntent.findMany({
    where: {
      organizationId: input.organizationId,
      inferenceRunId: input.runId,
      delivery: { state: { in: ['PENDING', 'BLOCKED'] }, firstSubmissionAt: null },
    },
    include: { delivery: true },
  });
  let count = 0;
  for (const n of notifications) {
    if (
      !n.observationId ||
      !n.delivery ||
      now < n.delivery.updatedAt ||
      !(await tx.claimObservationReview.findFirst({
        where: {
          organizationId: input.organizationId,
          observationId: n.observationId,
        },
      }))
    )
      continue;
    await tx.reviewNotificationDelivery.update({
      where: { notificationId: n.id, organizationId: input.organizationId },
      data: {
        state: 'SUPPRESSED',
        reason: 'SOURCE_REVIEWED',
        availableAt: now,
        updatedAt: now,
      },
    });
    await log(tx, input.organizationId, n.id, 'notification.suppressed', {
      reason: 'SOURCE_REVIEWED',
      state: 'SUPPRESSED',
    });
    count++;
  }
  return count;
}
