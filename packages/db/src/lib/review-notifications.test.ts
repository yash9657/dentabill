import { createHash, randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { prisma } from '../client.js';

import { MissingOrgScopeError } from './errors.js';
import {
  reserveInferenceRun,
  beginInferenceAttempt,
  saveInferenceReceipt,
  markInferenceApplied,
  markInferenceReviewed,
} from './inference.js';
import {
  beginReviewNotificationAttempt,
  completeReviewNotificationAttempt,
  enqueueReviewNotification,
  suppressReviewNotifications,
} from './review-notifications.js';
import { getOrgScopedDb } from './with-org.js';

const NOW = new Date('2026-10-14T12:00:00Z');
const at = (ms: number) => new Date(NOW.getTime() + ms);
async function fixture(
  options: { recipient?: boolean; enqueue?: boolean; required?: boolean } = {},
) {
  const org = await prisma.organization.create({
    data: { name: 'Synthetic outbox', clerkOrgId: randomUUID() },
  });
  const user =
    options.recipient === false
      ? null
      : await prisma.user.create({
          data: {
            organizationId: org.id,
            clerkUserId: randomUUID(),
            email: 'oldest@example.invalid',
            role: 'OWNER',
            createdAt: at(-1000),
          },
        });
  const claim = await prisma.claim.create({
    data: {
      organizationId: org.id,
      claimNumber: randomUUID(),
      patientDOBHash: 'synthetic',
      cdtCodes: ['D0150'],
      claimAmount: '100',
      payerCode: 'UNKNOWN',
      serviceDate: NOW,
      status: 'COMPLETED',
      updatedAt: NOW,
    },
  });
  const call = await prisma.call.create({
    data: {
      organizationId: org.id,
      claimId: claim.id,
      retellCallId: randomUUID(),
      status: 'COMPLETED',
      createdAt: NOW,
    },
  });
  const event = await prisma.callEvent.create({
    data: {
      callId: call.id,
      eventType: 'call.ended',
      timestamp: NOW,
      data: { transcript: { text: 'Synthetic source only', turns: null } },
    },
  });
  const reservation = await reserveInferenceRun(prisma, {
    organizationId: org.id,
    claimId: claim.id,
    callId: call.id,
    claimVersion: claim.updatedAt,
    sourceHash: 'a'.repeat(64),
    requestHash: 'b'.repeat(64),
    provider: 'SYNTHETIC',
    releaseId: 'synthetic-summary.v1',
    promptVersion: 'v1',
    requestPayload: {
      call: { rawTranscript: 'Synthetic source only' },
      input: {
        transcriptTurns: [
          { role: 'source', text: 'Synthetic source only', timestamp: NOW.toISOString() },
        ],
      },
    },
    reservationTokens: 100,
    dailyTokenLimit: 1000,
    now: NOW,
  });
  if (reservation.kind !== 'OWNED') throw new Error('TEST_OWNER');
  const ownership = {
    organizationId: org.id,
    runId: reservation.run.id,
    leaseToken: reservation.leaseToken,
    now: NOW,
  };
  await beginInferenceAttempt(prisma, ownership);
  await saveInferenceReceipt(prisma, {
    ...ownership,
    outcome: options.required ? 'REJECTED' : 'VALIDATED',
    resultPayload: options.required ? null : { synthetic: true },
    tokensUsed: 10,
    errorCode: options.required ? 'OUTPUT_SCHEMA_INVALID' : null,
  });
  if (options.required) {
    await prisma.$transaction((tx) => markInferenceReviewed(tx, ownership));
  } else {
    // Reacquire a publication lease after the synthetic receipt cleared its send lease.
    await prisma.inferenceRun.update({
      where: { id: reservation.run.id, organizationId: org.id },
      data: { leaseToken: ownership.leaseToken, leaseExpiresAt: at(60000) },
    });
    await prisma.$transaction(async (tx) => {
      const summary = await tx.callSummary.create({
        data: {
          organizationId: org.id,
          callId: call.id,
          claimStatus: 'pending',
          nextAction: 'MANUAL_REVIEW',
          rawTranscript: 'Synthetic source only',
          claudeSummary: 'Synthetic summary',
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: org.id,
          action: 'claim.transition',
          resourceType: 'Claim',
          resourceId: claim.id,
          metadata: { summaryId: summary.id },
        },
      });
      await markInferenceApplied(tx, { ...ownership, summaryId: summary.id });
      if (options.enqueue !== false)
        await enqueueReviewNotification(tx, {
          organizationId: org.id,
          runId: reservation.run.id,
          purpose: 'REVIEW_AVAILABLE',
          now: NOW,
        });
    });
  }
  const notification = await prisma.reviewNotificationIntent.findFirst({
    where: { organizationId: org.id },
  });
  return {
    org,
    user,
    claim,
    call,
    event,
    run: reservation.run,
    notification,
    input: { organizationId: org.id, notificationId: notification?.id ?? '', now: NOW },
  };
}
async function owned(f: Awaited<ReturnType<typeof fixture>>, ms = 0) {
  const result = await beginReviewNotificationAttempt(prisma, { ...f.input, now: at(ms) });
  if (result.kind !== 'OWNED') throw new Error(`TEST_OWNER_${result.kind}_${result.reason ?? ''}`);
  return result;
}
function completion(
  f: Awaited<ReturnType<typeof fixture>>,
  a: Awaited<ReturnType<typeof owned>>,
  ms = 1,
) {
  return {
    ...f.input,
    attemptId: a.attemptId,
    leaseToken: a.leaseToken,
    outcome: 'SIMULATED' as const,
    providerReceiptId: 'synthetic.receipt',
    acceptedAt: at(ms),
    now: at(ms),
  };
}
const delivery = (f: Awaited<ReturnType<typeof fixture>>) =>
  prisma.reviewNotificationDelivery.findFirstOrThrow({ where: { organizationId: f.org.id } });

describe('immutable review notification outbox', () => {
  it('freezes generic content and deterministic recipient, preserves org timestamp and replays exact identity', async () => {
    const f = await fixture();
    const before = await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } });
    await prisma.user.create({
      data: {
        organizationId: f.org.id,
        clerkUserId: randomUUID(),
        email: 'later@example.invalid',
        role: 'ADMIN',
        createdAt: at(1),
      },
    });
    const replay = await prisma.$transaction((tx) =>
      enqueueReviewNotification(tx, {
        organizationId: f.org.id,
        runId: f.run.id,
        purpose: 'REVIEW_AVAILABLE',
        now: at(2),
      }),
    );
    expect(replay).toMatchObject({
      kind: 'EXISTING',
      notification: { id: f.notification?.id, recipientUserId: f.user?.id, actorKind: 'SYSTEM' },
    });
    const a = await owned(f);
    expect(Object.keys(a.payload)).toEqual(['to', 'templateVersion', 'subject', 'text', 'appPath']);
    expect(a.payload).toEqual({
      to: 'oldest@example.invalid',
      templateVersion: 'review-available.v1',
      subject: 'Review available in DentaBill',
      text: 'A review is available. Sign in to DentaBill and open Claims to review it.',
      appPath: '/dashboard/claims',
    });
    expect(a.payloadHash).toBe(
      createHash('sha256').update(JSON.stringify(a.payload)).digest('hex'),
    );
    expect(a.retryDeadlineAt).toEqual(at(23 * 3600_000));
    expect(
      (await prisma.organization.findUniqueOrThrow({ where: { id: f.org.id } })).updatedAt,
    ).toEqual(before.updatedAt);
    expect(await completeReviewNotificationAttempt(prisma, completion(f, a))).toEqual({
      kind: 'RECORDED',
      state: 'SIMULATED',
    });
    expect(
      await completeReviewNotificationAttempt(prisma, { ...completion(f, a), now: at(100000) }),
    ).toEqual({ kind: 'EXISTING', state: 'SIMULATED' });
    await expect(
      completeReviewNotificationAttempt(prisma, {
        ...completion(f, a),
        providerReceiptId: 'different',
      }),
    ).rejects.toThrow('REVIEW_NOTIFICATION_CONFLICT');
    expect(
      await beginReviewNotificationAttempt(prisma, { ...f.input, now: at(100000) }),
    ).toMatchObject({ kind: 'TERMINAL', state: 'SIMULATED' });
  });
  it('permanently blocks missing recipient without selecting a later user', async () => {
    const f = await fixture({ recipient: false });
    expect(await delivery(f)).toMatchObject({
      state: 'BLOCKED',
      reason: 'MISSING_RECIPIENT',
      firstSubmissionAt: null,
    });
    expect(f.notification).toMatchObject({
      payload: null,
      payloadHash: null,
      recipientUserId: null,
    });
    await prisma.user.create({
      data: {
        organizationId: f.org.id,
        clerkUserId: randomUUID(),
        role: 'OWNER',
        email: 'added@example.invalid',
      },
    });
    expect(await beginReviewNotificationAttempt(prisma, f.input)).toMatchObject({
      kind: 'BLOCKED',
      reason: 'MISSING_RECIPIENT',
    });
  });
  it.each(['email', 'role'] as const)(
    'blocks frozen recipient %s drift without rebinding',
    async (field) => {
      const f = await fixture();
      await prisma.user.update({
        where: { id: f.user!.id, organizationId: f.org.id },
        data: field === 'email' ? { email: 'changed@example.invalid' } : { role: 'BILLING_STAFF' },
      });
      expect(await beginReviewNotificationAttempt(prisma, f.input)).toMatchObject({
        kind: 'BLOCKED',
        reason: 'RECIPIENT_CHANGED',
      });
      await prisma.user.update({
        where: { id: f.user!.id, organizationId: f.org.id },
        data: { email: 'oldest@example.invalid', role: 'OWNER' },
      });
      expect(await beginReviewNotificationAttempt(prisma, f.input)).toMatchObject({
        kind: 'BLOCKED',
        reason: 'RECIPIENT_CHANGED',
      });
    },
  );
  it('rolls back intent, delivery and enqueue audit together', async () => {
    const f = await fixture({ enqueue: false });
    await expect(
      prisma.$transaction(async (tx) => {
        await enqueueReviewNotification(tx, {
          organizationId: f.org.id,
          runId: f.run.id,
          purpose: 'REVIEW_AVAILABLE',
          now: NOW,
        });
        throw new Error('ROLLBACK');
      }),
    ).rejects.toThrow('ROLLBACK');
    expect(await prisma.reviewNotificationIntent.count()).toBe(0);
    expect(await prisma.reviewNotificationDelivery.count()).toBe(0);
    expect(await prisma.auditLog.count({ where: { action: 'notification.enqueued' } })).toBe(0);
  });
  it('admits required-review source without claiming a published summary', async () => {
    const f = await fixture({ required: true });
    expect(f.notification).toMatchObject({
      purpose: 'INFERENCE_REVIEW_REQUIRED',
      summaryId: null,
      observationId: null,
    });
    expect(await owned(f)).toMatchObject({ mode: 'SYNTHETIC' });
  });
  it.each(['claim', 'transcript', 'call'] as const)(
    'suppresses changed %s before submission',
    async (change) => {
      const f = await fixture();
      if (change === 'claim')
        await prisma.claim.update({
          where: { id: f.claim.id, organizationId: f.org.id },
          data: { status: 'RESOLVED' },
        });
      if (change === 'transcript')
        await prisma.callEvent.update({
          where: { id: f.event.id },
          data: { data: { transcript: { text: 'Changed', turns: null } } },
        });
      if (change === 'call')
        await prisma.call.create({
          data: {
            organizationId: f.org.id,
            claimId: f.claim.id,
            retellCallId: randomUUID(),
            status: 'COMPLETED',
            createdAt: at(1),
          },
        });
      expect(await beginReviewNotificationAttempt(prisma, f.input)).toMatchObject({
        kind: 'TERMINAL',
        state: 'SUPPRESSED',
        reason: change === 'call' ? 'SOURCE_SUPERSEDED' : 'SOURCE_CHANGED',
      });
    },
  );
  it.each([
    { text: 'Synthetic source only', turns: [{ role: 'user', text: 3, startOffsetSeconds: null }] },
    { text: 'Synthetic source only', turns: [{ role: 'user', text: 'x', startOffsetSeconds: -1 }] },
    { text: 'Synthetic source only' },
    { text: 'Synthetic source only', turns: 'malformed' },
  ])('rejects malformed final source snapshots', async (transcript) => {
    const f = await fixture();
    await prisma.callEvent.update({ where: { id: f.event.id }, data: { data: { transcript } } });
    expect(await beginReviewNotificationAttempt(prisma, f.input)).toMatchObject({
      state: 'SUPPRESSED',
      reason: 'SOURCE_CHANGED',
    });
  });
  it('retains ambiguity and permanent key through expired lease retry, fencing the old owner', async () => {
    const f = await fixture();
    const first = await owned(f);
    expect(
      await beginReviewNotificationAttempt(prisma, { ...f.input, now: at(59999) }),
    ).toMatchObject({ kind: 'BUSY' });
    const next = await owned(f, 60000);
    expect(next.deliveryKey).toBe(first.deliveryKey);
    expect(next.payloadHash).toBe(first.payloadHash);
    expect(next.retryDeadlineAt).toEqual(first.retryDeadlineAt);
    expect(await delivery(f)).toMatchObject({ attemptCount: 2, ambiguous: true });
    expect(
      await completeReviewNotificationAttempt(prisma, completion(f, first, 60001)),
    ).toMatchObject({ kind: 'STALE' });
    expect(
      await completeReviewNotificationAttempt(prisma, {
        ...completion(f, next, 60002),
        acceptedAt: at(1),
      }),
    ).toMatchObject({ state: 'SIMULATED' });
  });
  it('uses provider retry delay and never restarts the fixed retry deadline', async () => {
    const f = await fixture();
    const first = await owned(f);
    await completeReviewNotificationAttempt(prisma, {
      ...completion(f, first),
      outcome: 'UNKNOWN',
      code: 'TRANSPORT_UNKNOWN',
      providerReceiptId: null,
      acceptedAt: null,
      retryAfterMs: 120000,
    });
    expect(await delivery(f)).toMatchObject({
      state: 'PENDING',
      ambiguous: true,
      availableAt: at(120001),
    });
    expect(
      await beginReviewNotificationAttempt(prisma, { ...f.input, now: at(120000) }),
    ).toMatchObject({ kind: 'BUSY' });
    const next = await owned(f, 120001);
    expect(next.retryDeadlineAt).toEqual(first.retryDeadlineAt);
    await completeReviewNotificationAttempt(prisma, {
      ...completion(f, next, 120002),
      outcome: 'RETRYABLE',
      code: 'TRANSPORT_RETRYABLE',
      providerReceiptId: null,
      acceptedAt: null,
      retryAfterMs: 23 * 3600000,
    });
    expect(await delivery(f)).toMatchObject({
      state: 'QUARANTINED',
      reason: 'DEADLINE_EXPIRED',
      ambiguous: true,
    });
  });
  it('quarantines expired ambiguous work without submitting again', async () => {
    const f = await fixture();
    await owned(f);
    expect(
      await beginReviewNotificationAttempt(prisma, { ...f.input, now: at(23 * 3600000) }),
    ).toMatchObject({ state: 'QUARANTINED', reason: 'DEADLINE_EXPIRED' });
    expect(await prisma.reviewNotificationAttempt.count()).toBe(1);
  });
  it('caps attempts at five', async () => {
    const f = await fixture();
    for (let i = 0; i < 5; i++) {
      const a = await owned(f, i * 60001);
      await completeReviewNotificationAttempt(prisma, {
        ...completion(f, a, i * 60001 + 1),
        outcome: 'RETRYABLE',
        code: 'TRANSPORT_RETRYABLE',
        providerReceiptId: null,
        acceptedAt: null,
      });
    }
    expect(await delivery(f)).toMatchObject({
      state: 'QUARANTINED',
      reason: 'ATTEMPTS_EXHAUSTED',
      attemptCount: 5,
    });
  });
  it('quarantines source changes after a submission, never pretending it was unsent', async () => {
    const f = await fixture();
    await owned(f);
    await prisma.claim.update({
      where: { id: f.claim.id, organizationId: f.org.id },
      data: { status: 'RESOLVED' },
    });
    expect(
      await beginReviewNotificationAttempt(prisma, { ...f.input, now: at(60000) }),
    ).toMatchObject({ state: 'QUARANTINED', reason: 'SOURCE_CHANGED' });
    expect(await delivery(f)).toMatchObject({ ambiguous: true, firstSubmissionAt: NOW });
    expect(
      await prisma.$transaction((tx) =>
        suppressReviewNotifications(tx, {
          organizationId: f.org.id,
          runId: f.run.id,
          now: at(60001),
        }),
      ),
    ).toBe(0);
  });
  it('fails closed on live acceptance and invalid receipt shape', async () => {
    const f = await fixture();
    const a = await owned(f);
    await expect(
      completeReviewNotificationAttempt(prisma, { ...completion(f, a), outcome: 'ACCEPTED' }),
    ).rejects.toThrow();
    await expect(
      completeReviewNotificationAttempt(prisma, { ...completion(f, a), retryAfterMs: -1 }),
    ).rejects.toThrow('REVIEW_NOTIFICATION_CONFLICT');
    await expect(
      completeReviewNotificationAttempt(prisma, {
        ...completion(f, a),
        providerReceiptId: 'bad\n',
      }),
    ).rejects.toThrow('REVIEW_NOTIFICATION_CONFLICT');
    await expect(
      completeReviewNotificationAttempt(prisma, {
        ...completion(f, a),
        outcome: 'UNKNOWN',
        code: 'TRANSPORT_RETRYABLE',
        providerReceiptId: null,
        acceptedAt: null,
      }),
    ).rejects.toThrow();
    expect(await prisma.reviewNotificationReceipt.count()).toBe(0);
  });
  it('admits one concurrent owner and one exact enqueue identity', async () => {
    const f = await fixture({ enqueue: false });
    const outcomes = await Promise.all(
      Array.from({ length: 4 }, () =>
        prisma.$transaction((tx) =>
          enqueueReviewNotification(tx, {
            organizationId: f.org.id,
            runId: f.run.id,
            purpose: 'REVIEW_AVAILABLE',
            now: NOW,
          }),
        ),
      ),
    );
    expect(outcomes.filter((r) => r.kind === 'CREATED')).toHaveLength(1);
    f.input.notificationId = outcomes[0]!.notification.id;
    const attempts = await Promise.all(
      Array.from({ length: 4 }, () => beginReviewNotificationAttempt(prisma, f.input)),
    );
    expect(attempts.filter((r) => r.kind === 'OWNED')).toHaveLength(1);
    expect(attempts.filter((r) => r.kind === 'BUSY')).toHaveLength(3);
  });
  it('rejects repeatable-read stale enqueue snapshots through the organization write fence', async () => {
    const f = await fixture({ enqueue: false });
    let ready!: () => void;
    const observed = new Promise<void>((resolve) => {
      ready = resolve;
    });
    let advance!: () => void;
    const gate = new Promise<void>((resolve) => {
      advance = resolve;
    });
    const stale = prisma.$transaction(
      async (tx) => {
        await tx.organization.findUniqueOrThrow({ where: { id: f.org.id } });
        ready();
        await gate;
        return enqueueReviewNotification(tx, {
          organizationId: f.org.id,
          runId: f.run.id,
          purpose: 'REVIEW_AVAILABLE',
          now: NOW,
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );
    const settled = stale.then(
      () => 'unexpected',
      () => 'conflict',
    );
    await observed;
    await prisma.$transaction((tx) =>
      enqueueReviewNotification(tx, {
        organizationId: f.org.id,
        runId: f.run.id,
        purpose: 'REVIEW_AVAILABLE',
        now: NOW,
      }),
    );
    advance();
    expect(await settled).toBe('conflict');
    expect(await prisma.reviewNotificationIntent.count()).toBe(1);
  });
  it('isolates tenants in helpers and scoped reads and requires write org scope', async () => {
    const f = await fixture();
    const other = await fixture();
    expect(
      await beginReviewNotificationAttempt(prisma, { ...f.input, organizationId: other.org.id }),
    ).toMatchObject({ kind: 'NOT_FOUND' });
    expect(
      await getOrgScopedDb(other.org.id).reviewNotificationIntent.findMany({
        where: { id: f.input.notificationId },
      }),
    ).toEqual([]);
    await expect(
      prisma.reviewNotificationDelivery.update({
        where: { notificationId: f.input.notificationId },
        data: { reason: 'SOURCE_CHANGED' },
      }),
    ).rejects.toBeInstanceOf(MissingOrgScopeError);
  });
  it.each([
    'ReviewNotificationIntent',
    'ReviewNotificationAttempt',
    'ReviewNotificationReceipt',
  ] as const)('retains immutable %s fields and parent bindings', async (table) => {
    const f = await fixture();
    const a = await owned(f);
    await completeReviewNotificationAttempt(prisma, completion(f, a));
    await expect(
      prisma.$executeRawUnsafe(`UPDATE "${table}" SET "organizationId"="organizationId"`),
    ).rejects.toThrow('REVIEW_NOTIFICATION_IMMUTABLE');
    await expect(prisma.$executeRawUnsafe(`DELETE FROM "${table}"`)).rejects.toThrow(
      'REVIEW_NOTIFICATION_IMMUTABLE',
    );
  });
  it('rejects direct SQL reset, rebind, mode change, missing deadline and fake receipt state', async () => {
    const f = await fixture();
    await owned(f);
    for (const set of [
      '"retryDeadlineAt"=NULL',
      '"firstSubmissionAt"=NULL',
      'mode=NULL',
      '"attemptCount"=0',
      'state=\'SIMULATED\',"activeAttemptId"=NULL,"leaseToken"=NULL,"leaseExpiresAt"=NULL',
      '"retryDeadlineAt"="retryDeadlineAt"+interval \'1 hour\'',
    ]) {
      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE "ReviewNotificationDelivery" SET ${set} WHERE "notificationId"=$1::uuid`,
          f.input.notificationId,
        ),
      ).rejects.toThrow();
    }
    await expect(
      prisma.$executeRawUnsafe('DELETE FROM "ReviewNotificationDelivery"'),
    ).rejects.toThrow('REVIEW_NOTIFICATION_IMMUTABLE');
  });
  it.each([
    '.leading@example.invalid',
    'double..dot@example.invalid',
    'end.@example.invalid',
    'bad@-label.invalid',
    'bad!local@example.invalid',
    'bad@example..invalid',
    'bad@label.c',
  ])('freezes invalid eligible email %s as missing recipient', async (email) => {
    const f = await fixture({ enqueue: false });
    await prisma.user.update({
      where: { id: f.user!.id, organizationId: f.org.id },
      data: { email },
    });
    const result = await prisma.$transaction((tx) =>
      enqueueReviewNotification(tx, {
        organizationId: f.org.id,
        runId: f.run.id,
        purpose: 'REVIEW_AVAILABLE',
        now: NOW,
      }),
    );
    expect(result.notification).toMatchObject({ recipientUserId: null, payload: null });
    expect(await delivery(f)).toMatchObject({ state: 'BLOCKED', reason: 'MISSING_RECIPIENT' });
  });
  it('requires exact intent source, actor, recipient and payload, then seals its delivery at commit', async () => {
    const f = await fixture({ enqueue: false });
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { id: f.run.id, organizationId: f.org.id },
    });
    const outbound = {
      to: 'oldest@example.invalid',
      templateVersion: 'review-available.v1',
      subject: 'Review available in DentaBill',
      text: 'A review is available. Sign in to DentaBill and open Claims to review it.',
      appPath: '/dashboard/claims',
    };
    const base: Prisma.ReviewNotificationIntentUncheckedCreateInput = {
      organizationId: f.org.id,
      inferenceRunId: run.id,
      claimId: run.claimId,
      callId: run.callId,
      generation: run.generation,
      sourceHash: run.sourceHash,
      requestHash: run.requestHash,
      claimVersion: run.claimVersion,
      resultingClaimVersion: f.claim.updatedAt,
      sourceMarkerAt: NOW,
      purpose: 'REVIEW_AVAILABLE',
      summaryId: run.summaryId,
      actorKind: 'SYSTEM',
      recipientUserId: f.user!.id,
      recipientRole: 'OWNER',
      recipientEmail: f.user!.email,
      recipientSelectionVersion: 'oldest-owner-admin.v1',
      templateVersion: 'review-available.v1',
      payload: outbound,
      payloadHash: createHash('sha256').update(JSON.stringify(outbound)).digest('hex'),
      deliveryKey: randomUUID(),
      createdAt: NOW,
    };
    for (const changed of [
      { sourceHash: 'c'.repeat(64) },
      { actorKind: 'USER', actorUserId: f.user!.id, actorRole: 'OWNER' as const },
      { payload: { ...outbound, claimId: f.claim.id } },
      { recipientEmail: 'spoof@example.invalid' },
      { sourceMarkerAt: at(1) },
      { requestHash: 'd'.repeat(64) },
      { resultingClaimVersion: at(1) },
    ]) {
      await expect(
        prisma.reviewNotificationIntent.create({ data: { ...base, ...changed } }),
      ).rejects.toThrow();
    }
    await expect(prisma.reviewNotificationIntent.create({ data: base })).rejects.toThrow(
      'REVIEW_NOTIFICATION_INCOMPLETE',
    );
    expect(await prisma.reviewNotificationIntent.count()).toBe(0);
  });
  it('requires attempt sealing and exact key, payload and tenant bindings for direct writes', async () => {
    const f = await fixture();
    const data = {
      organizationId: f.org.id,
      notificationId: f.input.notificationId,
      attemptNumber: 1,
      mode: 'SYNTHETIC',
      deliveryKey: f.notification!.deliveryKey,
      payloadHash: f.notification!.payloadHash!,
      leaseToken: randomUUID(),
      startedAt: NOW,
      leaseExpiresAt: at(60000),
    };
    for (const changed of [
      { deliveryKey: randomUUID() },
      { payloadHash: 'c'.repeat(64) },
      { attemptNumber: 2 },
      { mode: 'LIVE' },
    ]) {
      await expect(
        prisma.reviewNotificationAttempt.create({ data: { ...data, ...changed } }),
      ).rejects.toThrow();
    }
    await expect(prisma.reviewNotificationAttempt.create({ data })).rejects.toThrow(
      'REVIEW_NOTIFICATION_ATTEMPT_INCOMPLETE',
    );
    expect(await prisma.reviewNotificationAttempt.count()).toBe(0);
  });
  it('requires receipt finalization and checks exact hash before allowing terminal state', async () => {
    const f = await fixture();
    const a = await owned(f);
    const result = {
      outcome: 'SIMULATED',
      code: null,
      providerReceiptId: 'synthetic',
      acceptedAt: at(1).toISOString(),
      retryAfterMs: null,
    };
    const data = {
      ...result,
      acceptedAt: at(1),
      organizationId: f.org.id,
      notificationId: f.input.notificationId,
      attemptId: a.attemptId,
      completedAt: at(1),
      receiptHash: createHash('sha256').update(JSON.stringify(result)).digest('hex'),
    };
    await expect(
      prisma.reviewNotificationReceipt.create({ data: { ...data, receiptHash: 'd'.repeat(64) } }),
    ).rejects.toThrow('REVIEW_NOTIFICATION_RECEIPT_HASH_INVALID');
    await expect(prisma.reviewNotificationReceipt.create({ data })).rejects.toThrow(
      'REVIEW_NOTIFICATION_RECEIPT_INCOMPLETE',
    );
    expect(await prisma.reviewNotificationReceipt.count()).toBe(0);
    expect(await delivery(f)).toMatchObject({ state: 'SENDING' });
  });
  it('rejects malformed helper dates before creating attempts', async () => {
    const f = await fixture();
    await expect(
      beginReviewNotificationAttempt(prisma, { ...f.input, now: new Date(NaN) }),
    ).rejects.toThrow('REVIEW_NOTIFICATION_CONFLICT');
    expect(await prisma.reviewNotificationAttempt.count()).toBe(0);
  });
});
