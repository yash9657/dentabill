import { randomUUID } from 'node:crypto';

import { prisma, reviewClaimObservation } from '@dentabill/db';
import {
  createFireworksTransport,
  GatewayRequestSchema,
  type ModelRelease,
} from '@dentabill/model-gateway';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  OBSERVATION_TEST_ARTIFACT,
  observationRelease,
  observationResponse,
  seedObservation,
} from './observation-inference.fixtures.js';
import { createDurableObservationGateway } from './observation-inference.js';
import { generateAndPublishObservation } from './observation-publication.js';
import {
  createObservationRegenerationService,
  type ObservationRegenerationConfig,
} from './observation-regeneration.js';

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await prisma.$disconnect();
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_regeneration_finish ON "AuditLog"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS fail_regeneration_finish()');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organization" CASCADE');
});

async function fixture(configure?: (release: ModelRelease) => void) {
  const input = await seedObservation(prisma);
  const organizationId = input.request.organizationId;
  const clerkUserId = `owner_${randomUUID()}`;
  const owner = await prisma.user.create({
    data: { organizationId, clerkUserId, email: 'synthetic@example.invalid', role: 'OWNER' },
  });
  const release = observationRelease(organizationId);
  configure?.(release);
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { organizationId, callId: input.callId },
      orderBy: { generation: 'desc' },
      include: { attempts: true },
    });
    expect(run.attempts.length).toBeGreaterThan(0);
    if (run.generation > 1) {
      expect(run.regenerationId).not.toBeNull();
      expect(
        await prisma.auditLog.count({
          where: {
            organizationId,
            action: 'claimObservation.regeneration_authorized',
            resourceId: run.regenerationId!,
          },
        }),
      ).toBe(1);
    }
    return new Response(observationResponse(GatewayRequestSchema.parse(run.requestPayload)), {
      status: 200,
    });
  });
  const config: ObservationRegenerationConfig = {
    apiKey: 'synthetic-fixture',
    releases: [release],
    implementationArtifactSha256: OBSERVATION_TEST_ARTIFACT,
    dailyTokenLimit: 1_000_000,
    transport: createFireworksTransport({ fetch }),
  };
  const publication = await generateAndPublishObservation({
    prisma,
    callId: input.callId,
    request: input.request,
    gateway: createDurableObservationGateway({
      prisma,
      callId: input.callId,
      ...config,
      apiKey: 'synthetic-fixture',
      releases: [release],
      implementationArtifactSha256: OBSERVATION_TEST_ARTIFACT,
    }),
  });
  const service = createObservationRegenerationService({ prisma, config });
  const actor = { organizationId, clerkUserId };
  const target = { ...actor, observationId: publication.observation.id };
  const preview = await service.preview(target);
  expect(preview.canRegenerate).toBe(true);
  const submission = {
    ...target,
    expectedPreviewDigest: preview.previewDigest!,
    idempotencyKey: randomUUID(),
    reason: 'Review corrected synthetic transcript',
  };
  return {
    ...input,
    actor,
    owner,
    target,
    config,
    service,
    publication,
    preview,
    submission,
    fetch,
  };
}

async function failFinish(
  action:
    | 'inference.native_attempt_finished'
    | 'inference.native_response_recorded'
    | 'notification.enqueued' = 'inference.native_attempt_finished',
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `CREATE FUNCTION fail_regeneration_finish() RETURNS trigger AS $$ BEGIN IF NEW.action = '${action}' THEN RAISE EXCEPTION 'synthetic finish fault'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
  );
  await prisma.$executeRawUnsafe(
    'CREATE TRIGGER fail_regeneration_finish BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fail_regeneration_finish()',
  );
}

describe('authorized native observation regeneration', () => {
  it('publishes a new version exactly once while preserving prior reviews, claims and accounting', async () => {
    const f = await fixture();
    const before = await prisma.claim.findFirstOrThrow({
      where: { id: f.request.claim.id, organizationId: f.actor.organizationId },
    });
    await reviewClaimObservation(prisma, {
      ...f.actor,
      observationId: f.publication.observation.id,
      expectedObservationDigest: f.publication.observation.digest,
      expectedClaimVersion: before.updatedAt,
      decision: 'ACKNOWLEDGED',
      note: null,
    });
    const result = await f.service.regenerate(f.submission);
    expect(result).toMatchObject({ state: 'PUBLISHED', canResume: false });
    expect(await f.service.regenerate(f.submission)).toEqual(result);
    expect(await f.service.resume({ ...f.actor, authorizationId: result.id })).toEqual(result);
    expect(f.fetch).toHaveBeenCalledTimes(2);
    const observations = await prisma.claimObservation.findMany({
      where: { organizationId: f.actor.organizationId },
      orderBy: { version: 'asc' },
      include: { review: true, inferenceRun: true },
    });
    expect(observations).toHaveLength(2);
    expect(observations[0]?.review?.decision).toBe('ACKNOWLEDGED');
    expect(observations[1]?.inferenceRun.generation).toBe(2);
    expect(observations[1]?.supersedesObservationId).toBe(f.publication.observation.id);
    const notifications = await prisma.reviewNotificationIntent.findMany({
      where: { organizationId: f.actor.organizationId },
      orderBy: { generation: 'asc' },
      include: { delivery: true },
    });
    expect(notifications).toHaveLength(2);
    expect(notifications[0]).toMatchObject({
      actorKind: 'SYSTEM',
      delivery: { state: 'SUPPRESSED', reason: 'SOURCE_REVIEWED' },
    });
    expect(notifications[1]).toMatchObject({
      purpose: 'REVIEW_AVAILABLE',
      generation: 2,
      regenerationId: result.id,
      observationId: result.observationId,
      actorKind: 'USER',
      actorUserId: f.owner.id,
      actorRole: 'OWNER',
      recipientUserId: f.owner.id,
    });
    expect(
      await prisma.claim.findFirst({
        where: { id: before.id, organizationId: f.actor.organizationId },
      }),
    ).toEqual(before);
    expect(
      await prisma.inferenceBudget.findFirst({ where: { organizationId: f.actor.organizationId } }),
    ).toMatchObject({ knownTokens: 62n, reservedTokens: 0n });
    expect(
      (await f.service.preview({ ...f.actor, observationId: result.observationId! })).canRegenerate,
    ).toBe(true);
  }, 30_000);
  it('rejects a stale preview after a corrected final transcript, then binds explicit approval to the correction', async () => {
    const f = await fixture();
    const event = await prisma.callEvent.create({
      data: {
        callId: f.callId,
        eventType: 'webhook.call.ended',
        timestamp: new Date(Date.now() + 1000),
        data: {
          transcript: { text: 'Payer: The corrected claim is pending review.', turns: null },
        },
      },
    });
    await expect(f.service.regenerate(f.submission)).rejects.toMatchObject({
      code: 'STALE_PREVIEW',
    });
    expect(f.fetch).toHaveBeenCalledTimes(1);
    const preview = await f.service.preview(f.target);
    expect(preview.source?.id).toBe(`transcript.${event.id}`);
    const result = await f.service.regenerate({
      ...f.submission,
      expectedPreviewDigest: preview.previewDigest!,
    });
    expect(result.state).toBe('PUBLISHED');
    await expect(
      f.service.regenerate({
        ...f.submission,
        expectedPreviewDigest: preview.previewDigest!,
        reason: 'A changed reason',
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(f.fetch).toHaveBeenCalledTimes(2);
  }, 30_000);
  it('recovers a durable raw response after authorization and release expiry with no API key or new HTTP', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = Date.now();
    const f = await fixture((release) => {
      release.approval!.expiresAt = new Date(now + 10 * 60_000).toISOString();
    });
    await failFinish();
    const pending = await f.service.regenerate(f.submission);
    expect(pending.state).toBe('RUNNING');
    expect(f.fetch).toHaveBeenCalledTimes(2);
    await prisma.$executeRawUnsafe('DROP TRIGGER fail_regeneration_finish ON "AuditLog"');
    vi.setSystemTime(now + 20 * 60_000);
    const { apiKey: _key, ...withoutKey } = f.config;
    const service = createObservationRegenerationService({ prisma, config: withoutKey });
    expect((await service.preview(f.target)).activeAuthorization).toMatchObject({
      id: pending.id,
      state: 'RESULT_SAVED',
      canResume: true,
    });
    const result = await service.resume({ ...f.actor, authorizationId: pending.id });
    expect(result.state).toBe('PUBLISHED');
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(
      await prisma.inferenceBudget.findFirst({ where: { organizationId: f.actor.organizationId } }),
    ).toMatchObject({ knownTokens: 62n, reservedTokens: 0n });
  }, 30_000);
  it('recovers a final result after local publication fails, even with configuration unavailable', async () => {
    const f = await fixture();
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION fail_regeneration_finish() RETURNS trigger AS $$ BEGIN IF NEW.action = 'claimObservation.published' THEN RAISE EXCEPTION 'synthetic publication fault'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER fail_regeneration_finish BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fail_regeneration_finish()',
    );
    await expect(f.service.regenerate(f.submission)).rejects.toThrow();
    await prisma.$executeRawUnsafe('DROP TRIGGER fail_regeneration_finish ON "AuditLog"');
    const service = createObservationRegenerationService({
      prisma,
      config: { dailyTokenLimit: 1_000_000 },
    });
    const preview = await service.preview(f.target);
    expect(preview.activeAuthorization?.state).toBe('RESULT_SAVED');
    const result = await service.resume({
      ...f.actor,
      authorizationId: preview.activeAuthorization!.id,
    });
    expect(result.state).toBe('PUBLISHED');
    expect(f.fetch).toHaveBeenCalledTimes(2);
  }, 30_000);
  it('withholds previews and execution for a downgraded actor and keeps unknown sends unresolved', async () => {
    const f = await fixture();
    f.fetch.mockRejectedValue(new Error('synthetic network loss'));
    const result = await f.service.regenerate(f.submission);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 20 * 60_000);
    expect(await f.service.resume({ ...f.actor, authorizationId: result.id })).toMatchObject({
      state: 'REVIEW_REQUIRED',
      canResume: false,
    });
    expect((await f.service.preview(f.target)).canRegenerate).toBe(false);
    expect(f.fetch).toHaveBeenCalledTimes(2);
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { organizationId: f.actor.organizationId, regenerationId: result.id },
    });
    expect(run).toMatchObject({ state: 'UNKNOWN', reviewAppliedAt: expect.any(Date) });
    expect(
      await prisma.reviewNotificationIntent.findMany({
        where: { organizationId: f.actor.organizationId, inferenceRunId: run.id },
      }),
    ).toMatchObject([
      {
        purpose: 'INFERENCE_REVIEW_REQUIRED',
        actorKind: 'USER',
        actorUserId: f.owner.id,
      },
    ]);
    await prisma.user.updateMany({
      where: { organizationId: f.actor.organizationId },
      data: { role: 'BILLING_STAFF' },
    });
    await expect(f.service.preview(f.target)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      f.service.resume({ ...f.actor, authorizationId: result.id }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  }, 30_000);

  it.each(['REJECTED', 'UNKNOWN'] as const)(
    'rolls back %s review application if notification audit fails, then resumes without another inference',
    async (state) => {
      const f = await fixture();
      f.fetch.mockImplementation(async () => {
        if (state === 'UNKNOWN') throw new Error('synthetic network interruption');
        const run = await prisma.inferenceRun.findFirstOrThrow({
          where: { organizationId: f.actor.organizationId },
          orderBy: { generation: 'desc' },
        });
        return new Response(
          observationResponse(GatewayRequestSchema.parse(run.requestPayload), 'schema'),
        );
      });
      await failFinish('notification.enqueued');
      await expect(f.service.regenerate(f.submission)).rejects.toThrow();
      const run = await prisma.inferenceRun.findFirstOrThrow({
        where: { organizationId: f.actor.organizationId, generation: 2 },
      });
      expect(run).toMatchObject({ state, reviewAppliedAt: null });
      expect(
        await prisma.reviewNotificationIntent.count({
          where: { organizationId: f.actor.organizationId, inferenceRunId: run.id },
        }),
      ).toBe(0);
      await prisma.$executeRawUnsafe('DROP TRIGGER fail_regeneration_finish ON "AuditLog"');
      const recovered = await f.service.resume({
        ...f.actor,
        authorizationId: run.regenerationId!,
      });
      expect(recovered.state).toBe(state === 'REJECTED' ? 'FAILED' : 'REVIEW_REQUIRED');
      const notification = await prisma.reviewNotificationIntent.findFirstOrThrow({
        where: { organizationId: f.actor.organizationId, inferenceRunId: run.id },
      });
      expect(notification).toMatchObject({
        purpose: 'INFERENCE_REVIEW_REQUIRED',
        generation: 2,
        actorKind: 'USER',
        actorUserId: f.owner.id,
        actorRole: 'OWNER',
      });
      expect(await f.service.regenerate(f.submission)).toEqual(recovered);
      expect(
        await prisma.reviewNotificationIntent.findMany({
          where: { organizationId: f.actor.organizationId, inferenceRunId: run.id },
        }),
      ).toEqual([notification]);
      expect(f.fetch).toHaveBeenCalledTimes(2);
    },
    30_000,
  );

  it('settles an expired regeneration submission without a receipt into durable review without credentials', async () => {
    const f = await fixture();
    await failFinish('inference.native_response_recorded');
    const pending = await f.service.regenerate(f.submission);
    expect(pending.state).toBe('RUNNING');
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { organizationId: f.actor.organizationId, regenerationId: pending.id },
    });
    expect(run.reviewAppliedAt).toBeNull();
    await prisma.$executeRawUnsafe('DROP TRIGGER fail_regeneration_finish ON "AuditLog"');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(run.leaseExpiresAt!.getTime() + 1));
    const recovery = createObservationRegenerationService({
      prisma,
      config: { dailyTokenLimit: 1_000_000 },
    });
    expect(await recovery.resume({ ...f.actor, authorizationId: pending.id })).toMatchObject({
      state: 'REVIEW_REQUIRED',
      canResume: false,
    });
    expect(
      await prisma.inferenceRun.findFirstOrThrow({
        where: { organizationId: f.actor.organizationId, id: run.id },
      }),
    ).toMatchObject({ state: 'UNKNOWN', reviewAppliedAt: expect.any(Date) });
    expect(
      await prisma.reviewNotificationIntent.findFirstOrThrow({
        where: { organizationId: f.actor.organizationId, inferenceRunId: run.id },
      }),
    ).toMatchObject({ purpose: 'INFERENCE_REVIEW_REQUIRED', actorUserId: f.owner.id });
    expect(f.fetch).toHaveBeenCalledTimes(2);
  }, 30_000);
  it('closes an expired unused reservation without credentials and permits a new explicit approval', async () => {
    const f = await fixture();
    const controller = new AbortController();
    const service = createObservationRegenerationService({
      prisma,
      config: {
        ...f.config,
        transport: async (request) => {
          controller.abort();
          return f.config.transport!(request);
        },
      },
    });
    const first = await service.regenerate({ ...f.submission, signal: controller.signal });
    expect(f.fetch).toHaveBeenCalledTimes(1);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 60_000);
    const { apiKey: _key, ...withoutKey } = f.config;
    const recovery = createObservationRegenerationService({ prisma, config: withoutKey });
    expect(await recovery.resume({ ...f.actor, authorizationId: first.id })).toMatchObject({
      state: 'PROVEN_UNSENT_FAILED',
      canResume: false,
    });
    const preview = await f.service.preview(f.target);
    expect(preview).toMatchObject({ canRegenerate: true, nextGeneration: 3 });
    const next = await f.service.regenerate({
      ...f.submission,
      idempotencyKey: randomUUID(),
      expectedPreviewDigest: preview.previewDigest!,
    });
    expect(next.state).toBe('PUBLISHED');
    expect(f.fetch).toHaveBeenCalledTimes(2);
    expect(
      await prisma.inferenceBudget.findFirst({ where: { organizationId: f.actor.organizationId } }),
    ).toMatchObject({ knownTokens: 62n, reservedTokens: 0n });
  }, 30_000);
  it('blocks a source change after authorization but before admission and allows a separately reviewed replacement', async () => {
    const f = await fixture();
    const service = createObservationRegenerationService({
      prisma,
      config: {
        ...f.config,
        transport: async (request) => {
          await prisma.callEvent.create({
            data: {
              callId: f.callId,
              eventType: 'webhook.call.ended',
              timestamp: new Date(Date.now() + 1000),
              data: {
                transcript: { text: 'Payer: A later correction is pending review.', turns: null },
              },
            },
          });
          return f.config.transport!(request);
        },
      },
    });
    const first = await service.regenerate(f.submission);
    expect(first.state).toBe('FAILED');
    expect(f.fetch).toHaveBeenCalledTimes(1);
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { organizationId: f.actor.organizationId, regenerationId: first.id },
      include: { attempts: true },
    });
    expect(run).toMatchObject({
      state: 'REJECTED',
      totalTokens: 0n,
      reservedTokens: 0n,
      attempts: [],
    });
    const preview = await f.service.preview(f.target);
    expect(preview.canRegenerate).toBe(true);
    expect(
      (
        await f.service.regenerate({
          ...f.submission,
          idempotencyKey: randomUUID(),
          expectedPreviewDigest: preview.previewDigest!,
        })
      ).state,
    ).toBe('PUBLISHED');
    expect(f.fetch).toHaveBeenCalledTimes(2);
  }, 30_000);
});
