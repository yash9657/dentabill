import { prisma, reviewClaimObservation } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import { createFireworksTransport } from '@dentabill/model-gateway';
import { FakeClaude } from '@dentabill/summarizer';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { loadSummaryWorkerEnv } from './env.js';
import { createSummaryJobHandler } from './handler.js';
import type { ObservationJobConfig } from './observation-handler.js';
import {
  OBSERVATION_TEST_ARTIFACT,
  observationRelease,
  observationResponse,
  seedObservation,
} from './observation-inference.fixtures.js';
import { createDurableObservationGateway } from './observation-inference.js';
import { createRuntimeSummarizer } from './runtime-summarizer.js';

const organizations: string[] = [];
const baseEnv = loadSummaryWorkerEnv({
  DATABASE_URL: 'postgresql://localhost/test',
  REDIS_URL: 'redis://localhost:6379',
  SUMMARY_ANALYSIS_PROVIDER: 'FIREWORKS',
  NODE_ENV: 'test',
});

const logger = createLogger({ level: 'fatal' });

async function fixture() {
  const seeded = await seedObservation(prisma);
  organizations.push(seeded.request.organizationId);
  const owner = await prisma.user.create({
    data: {
      organizationId: seeded.request.organizationId,
      clerkUserId: `notification-owner-${seeded.request.organizationId}`,
      email: 'synthetic-owner@example.invalid',
      role: 'OWNER',
    },
  });
  const fetcher = vi.fn(async () => new Response(observationResponse(seeded.request)));
  const transport = createFireworksTransport({ fetch: fetcher });
  const config: ObservationJobConfig = {
    apiKey: 'synthetic-local-key',
    releaseId: seeded.request.releaseId,
    implementationArtifactSha256: OBSERVATION_TEST_ARTIFACT,
    dailyTokenLimit: 1_000_000,
    dataClass: 'SYNTHETIC',
    releases: [observationRelease(seeded.request.organizationId)],
    transport,
  };
  const job = {
    id: `call.${seeded.callId}`,
    data: {
      organizationId: seeded.request.organizationId,
      callId: seeded.callId,
      promptVersion: 'v1',
      idempotencyKey: `call.${seeded.callId}`,
    },
  };
  const handler = (override: Partial<ObservationJobConfig> = {}, synthetic = false) =>
    createSummaryJobHandler({
      logger,
      prisma,
      env: { ...baseEnv, SUMMARY_ANALYSIS_PROVIDER: synthetic ? 'SYNTHETIC' : 'FIREWORKS' },
      summarizer: new FakeClaude({ deriveWhenUnregistered: true }),
      observationConfig: { ...config, ...override },
    });
  const run = () =>
    prisma.inferenceRun.findFirstOrThrow({
      where: {
        organizationId: seeded.request.organizationId,
        callId: seeded.callId,
        generation: 1,
      },
      include: { attempts: true, observation: true },
    });
  return { ...seeded, owner, config, transport, fetcher, job, handler, run };
}

async function failAudit(action: string): Promise<void> {
  if (
    ![
      'claimObservation.published',
      'inference.native_finalized',
      'observation.inference_review_required',
      'notification.enqueued',
      'notification.suppressed',
    ].includes(action)
  )
    throw new Error('Unsupported test action.');
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION observation_job_fail() RETURNS trigger AS $$
    BEGIN IF NEW.action = '${action}' THEN RAISE EXCEPTION 'synthetic failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  await prisma.$executeRawUnsafe(
    'CREATE TRIGGER observation_job_fail BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION observation_job_fail()',
  );
}
async function clearFault(): Promise<void> {
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS observation_job_fail ON "AuditLog"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS observation_job_fail()');
}

beforeAll(async () => prisma.$connect());
afterEach(async () => {
  vi.useRealTimers();
  await clearFault();
  // Immutable observations deliberately prohibit ordinary deletion; this is an isolated fixture DB.
  await prisma.$executeRawUnsafe('TRUNCATE "Organization" CASCADE');
  organizations.length = 0;
});
afterAll(async () => prisma.$disconnect());

describe('automatic native post-call jobs', () => {
  it('publishes exact final evidence once across duplicate deliveries/config changes without financial effects', async () => {
    const f = await fixture();
    const first = await f.handler()(f.job);
    expect(first).toMatchObject({
      outcome: 'OBSERVATION_PUBLISHED',
      summaryId: null,
      tokensUsed: 31,
    });
    expect(first.observationId).toBeTruthy();
    const stored = await f.run();
    expect(stored.state).toBe('APPLIED');
    expect(typeof stored.releaseSnapshot).toBe('string');
    const intent = await prisma.reviewNotificationIntent.findFirstOrThrow({
      where: { organizationId: f.request.organizationId, inferenceRunId: stored.id },
    });
    expect(intent).toMatchObject({
      purpose: 'REVIEW_AVAILABLE',
      observationId: first.observationId,
      generation: 1,
      actorKind: 'SYSTEM',
      recipientUserId: f.owner.id,
      sourceHash: stored.sourceHash,
      requestHash: stored.requestHash,
      claimVersion: stored.claimVersion,
    });
    expect(stored.requestPayload).toMatchObject({
      invocationId: `observation.${f.callId}.g1`,
      dataClass: 'SYNTHETIC',
    });
    expect(
      await f.handler(
        { apiKey: '', releases: [], releaseId: 'changed', implementationArtifactSha256: '' },
        true,
      )(f.job),
    ).toEqual(first);
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(
      await prisma.reviewNotificationIntent.findMany({
        where: { organizationId: f.request.organizationId },
      }),
    ).toEqual([intent]);
    expect(
      await prisma.callSummary.count({ where: { organizationId: f.request.organizationId } }),
    ).toBe(0);
    expect(
      await prisma.claim.findFirst({
        where: { id: f.request.claim.id, organizationId: f.request.organizationId },
      }),
    ).toMatchObject({ status: 'COMPLETED', updatedAt: new Date(f.request.claim.version) });
  });

  it('defaults real queued work to PROTECTED and cannot use a synthetic-only release', async () => {
    const f = await fixture();
    const { dataClass: _fixtureClass, ...productionConfig } = f.config;
    const handler = createSummaryJobHandler({
      logger,
      prisma,
      env: baseEnv,
      summarizer: new FakeClaude(),
      observationConfig: productionConfig,
    });
    await expect(handler(f.job)).rejects.toMatchObject({ code: 'OBSERVATION_RELEASE_UNAVAILABLE' });
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(
      await prisma.inferenceRun.count({ where: { organizationId: f.request.organizationId } }),
    ).toBe(0);
  });

  it('unapproved or missing configuration, source, and budget remain retryable without fallback', async () => {
    const f = await fixture();
    await expect(f.handler({ releases: [] })(f.job)).rejects.toMatchObject({
      code: 'OBSERVATION_RELEASE_UNAVAILABLE',
    });
    await expect(f.handler({ apiKey: '' })(f.job)).rejects.toMatchObject({
      code: 'OBSERVATION_CONFIGURATION_UNAVAILABLE',
    });
    await expect(f.handler({ dailyTokenLimit: 1 })(f.job)).rejects.toMatchObject({
      code: 'OBSERVATION_BUDGET_EXCEEDED',
    });
    await prisma.callEvent.deleteMany({
      where: { callId: f.callId, call: { organizationId: f.request.organizationId } },
    });
    await expect(f.handler()(f.job)).rejects.toMatchObject({
      code: 'OBSERVATION_SOURCE_UNAVAILABLE',
    });
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(
      await prisma.callSummary.count({ where: { organizationId: f.request.organizationId } }),
    ).toBe(0);
  });

  it.each(['claimObservation.published', 'notification.enqueued'])(
    'recovers a saved final result without configuration after %s fails',
    async (action) => {
      const f = await fixture();
      await failAudit(action);
      await expect(f.handler()(f.job)).rejects.toMatchObject({
        code: 'OBSERVATION_EXECUTION_UNCONFIRMED',
      });
      expect(await f.run()).toMatchObject({
        state: 'RESPONDED',
        totalTokens: 31n,
        observation: null,
      });
      expect(
        await prisma.reviewNotificationIntent.count({
          where: { organizationId: f.request.organizationId },
        }),
      ).toBe(0);
      await clearFault();
      expect(
        await f.handler(
          { apiKey: '', releases: [], implementationArtifactSha256: '' },
          true,
        )(f.job),
      ).toMatchObject({ outcome: 'OBSERVATION_PUBLISHED', tokensUsed: 31 });
      expect(f.fetcher).toHaveBeenCalledTimes(1);
      expect(
        await prisma.reviewNotificationIntent.count({
          where: { organizationId: f.request.organizationId, purpose: 'REVIEW_AVAILABLE' },
        }),
      ).toBe(1);
    },
  );

  it('uses its archived release to recover raw evidence after expiry with no key/catalog or send', async () => {
    const f = await fixture();
    const release = observationRelease(f.request.organizationId);
    if (!release.approval) throw new Error('Fixture approval missing.');
    release.approval.expiresAt = new Date(Date.now() + 10_000).toISOString();
    await failAudit('inference.native_finalized');
    await expect(f.handler({ releases: [release] })(f.job)).rejects.toMatchObject({
      code: 'OBSERVATION_EXECUTION_UNCONFIRMED',
    });
    const saved = await f.run();
    expect(saved.attempts[0]?.responseRecordedAt).not.toBeNull();
    await clearFault();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(Date.now() + 180_000));
    expect(
      await f.handler({ apiKey: '', releases: [], releaseId: 'changed' }, true)(f.job),
    ).toMatchObject({ outcome: 'OBSERVATION_PUBLISHED' });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(await f.run()).toMatchObject({ totalTokens: 31n, reservedTokens: 0n });
  });

  it('retains unknown usage and ACKs only after review marker/audit commit, without claim transition', async () => {
    const f = await fixture();
    const transport = createFireworksTransport({
      fetch: vi.fn(async () => {
        throw new Error('synthetic network interruption');
      }),
    });
    await failAudit('observation.inference_review_required');
    await expect(f.handler({ transport })(f.job)).rejects.toMatchObject({
      code: 'OBSERVATION_EXECUTION_UNCONFIRMED',
    });
    expect(await f.run()).toMatchObject({
      state: 'UNKNOWN',
      reviewAppliedAt: null,
      totalTokens: null,
    });
    expect(
      await prisma.reviewNotificationIntent.count({
        where: { organizationId: f.request.organizationId },
      }),
    ).toBe(0);
    await clearFault();
    expect(
      await f.handler({ apiKey: '', implementationArtifactSha256: '', releases: [] }, true)(f.job),
    ).toMatchObject({ outcome: 'INFERENCE_REVIEW_REQUIRED', tokensUsed: null });
    const saved = await f.run();
    expect(saved.reviewAppliedAt).not.toBeNull();
    expect(saved.reservedTokens).toBeGreaterThan(0n);
    expect(saved.attempts).toHaveLength(1);
    expect(
      await prisma.claim.findFirst({
        where: { id: f.request.claim.id, organizationId: f.request.organizationId },
      }),
    ).toMatchObject({ status: 'COMPLETED' });
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(
      await prisma.reviewNotificationIntent.findFirstOrThrow({
        where: { organizationId: f.request.organizationId, inferenceRunId: saved.id },
      }),
    ).toMatchObject({ purpose: 'INFERENCE_REVIEW_REQUIRED', actorKind: 'SYSTEM' });
  });

  it('suppresses pending review delivery atomically with an exact observation acknowledgement', async () => {
    const f = await fixture();
    await f.handler()(f.job);
    const run = await f.run();
    const observation = run.observation!;
    const intent = await prisma.reviewNotificationIntent.findFirstOrThrow({
      where: { organizationId: f.request.organizationId, inferenceRunId: run.id },
    });
    const review = {
      organizationId: f.request.organizationId,
      clerkUserId: f.owner.clerkUserId,
      observationId: observation.id,
      expectedObservationDigest: observation.digest,
      expectedClaimVersion: observation.claimVersion,
      decision: 'ACKNOWLEDGED' as const,
    };
    await failAudit('notification.suppressed');
    await expect(reviewClaimObservation(prisma, review)).rejects.toThrow();
    expect(
      await prisma.claimObservationReview.count({
        where: { organizationId: f.request.organizationId, observationId: observation.id },
      }),
    ).toBe(0);
    expect(
      await prisma.reviewNotificationDelivery.findFirstOrThrow({
        where: { organizationId: f.request.organizationId, notificationId: intent.id },
      }),
    ).toMatchObject({ state: 'PENDING' });
    await clearFault();
    const recorded = await reviewClaimObservation(prisma, review);
    expect(recorded.kind).toBe('RECORDED');
    expect(
      await prisma.reviewNotificationDelivery.findFirstOrThrow({
        where: { organizationId: f.request.organizationId, notificationId: intent.id },
      }),
    ).toMatchObject({ state: 'SUPPRESSED' });
    expect(await reviewClaimObservation(prisma, review)).toMatchObject({
      kind: 'ALREADY_RECORDED',
      review: recorded.review,
    });
    expect(
      await prisma.auditLog.count({
        where: { organizationId: f.request.organizationId, action: 'notification.suppressed' },
      }),
    ).toBe(1);
    expect(
      await prisma.reviewNotificationIntent.findFirstOrThrow({
        where: { organizationId: f.request.organizationId, id: intent.id },
      }),
    ).toEqual(intent);
  });

  it('keeps a persisted synthetic provider when new-job selection changes to Fireworks', async () => {
    const f = await fixture();
    const legacy = await f.handler({}, true)(f.job);
    expect(['MANUAL_REVIEW', 'AUTO_TRANSITIONED']).toContain(legacy.outcome);
    const repeated = await f.handler()(f.job);
    expect(repeated).toMatchObject({ outcome: 'ALREADY_PROCESSED', summaryId: legacy.summaryId });
    expect(f.fetcher).not.toHaveBeenCalled();
    expect(await f.run()).toMatchObject({ provider: 'SYNTHETIC', generation: 1 });
  });

  it('waits for active ownership and keeps caller overrides outside the queue contract', async () => {
    const f = await fixture();
    const pause = createFireworksTransport({
      fetch: vi.fn(async () => new Response(observationResponse(f.request))),
    });
    let releaseTransport: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      releaseTransport = resolve;
    });
    const running = f.handler({
      transport: async (input) => {
        entered?.();
        await blocked;
        return pause(input);
      },
    })(f.job);
    await enteredPromise;
    await expect(f.handler()(f.job)).rejects.toMatchObject({ code: 'SUMMARY_INFERENCE_BUSY' });
    releaseTransport?.();
    expect(await running).toMatchObject({ outcome: 'OBSERVATION_PUBLISHED' });
    const invalid = {
      ...f.job,
      data: { ...f.job.data, dataClass: 'SYNTHETIC', model: 'unapproved' },
    };
    expect(await f.handler()(invalid)).toMatchObject({ outcome: 'DLQ' });
  });

  it('legacy key cannot prevent saved native publication or invoke legacy reasoning', async () => {
    const f = await fixture();
    const gateway = createDurableObservationGateway({
      prisma,
      callId: f.callId,
      dailyTokenLimit: 1_000_000,
      apiKey: 'synthetic-local-key',
      implementationArtifactSha256: OBSERVATION_TEST_ARTIFACT,
      releases: [observationRelease(f.request.organizationId)],
      transport: f.transport,
    });
    expect((await gateway.generate(f.request)).status).toBe('VALIDATED');
    const env = { ...baseEnv, ANTHROPIC_API_KEY: 'synthetic-unused-legacy-key' };
    const handler = createSummaryJobHandler({
      logger,
      prisma,
      env,
      summarizer: createRuntimeSummarizer(env),
    });
    expect(await handler(f.job)).toMatchObject({ outcome: 'OBSERVATION_PUBLISHED' });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not read or publish another tenant’s call', async () => {
    const f = await fixture();
    const other = await fixture();
    await expect(
      f.handler()({
        ...f.job,
        data: { ...f.job.data, organizationId: other.request.organizationId },
      }),
    ).rejects.toMatchObject({ code: 'OBSERVATION_SOURCE_UNAVAILABLE' });
    expect(f.fetcher).not.toHaveBeenCalled();
  });
});

it.each(['synthetic', 'disabled'] as const)(
  'retries a stale %s selection when native ownership is created after its routing read',
  async (legacyMode) => {
    const f = await fixture();
    const staleEnv = {
      ...baseEnv,
      SUMMARY_ANALYSIS_PROVIDER: 'SYNTHETIC' as const,
      ANTHROPIC_API_KEY: legacyMode === 'disabled' ? 'synthetic-unused-legacy-key' : '',
    };
    const staleHandler = createSummaryJobHandler({
      logger,
      prisma,
      env: staleEnv,
      summarizer:
        legacyMode === 'disabled'
          ? createRuntimeSummarizer(staleEnv)
          : new FakeClaude({ deriveWhenUnregistered: true }),
      observationConfig: f.config,
    });
    let unlock: (() => void) | undefined;
    const lockGate = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    let lockAcquired = false;
    let lockError: unknown;
    // The routing query has returned no run when its next real SELECT blocks here.
    const lockWork = prisma
      .$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe('LOCK TABLE "CallSummary" IN ACCESS EXCLUSIVE MODE');
          lockAcquired = true;
          await lockGate;
        },
        { timeout: 10_000 },
      )
      .catch((error: unknown) => {
        lockError = error;
      });
    let releaseTransport: (() => void) | undefined;
    const transportGate = new Promise<void>((resolve) => {
      releaseTransport = resolve;
    });
    let transportEntered = false;
    const gateway = createDurableObservationGateway({
      prisma,
      callId: f.callId,
      dailyTokenLimit: 1_000_000,
      apiKey: 'synthetic-local-key',
      implementationArtifactSha256: OBSERVATION_TEST_ARTIFACT,
      releases: [observationRelease(f.request.organizationId)],
      transport: async (input) => {
        transportEntered = true;
        await transportGate;
        return f.transport(input);
      },
    });
    let nativeWork: ReturnType<typeof gateway.generate> | undefined;
    let staleWork: Promise<unknown> | undefined;
    try {
      await vi.waitFor(
        () => {
          if (lockError)
            throw lockError instanceof Error
              ? lockError
              : new Error('Test lock acquisition failed.');
          expect(lockAcquired).toBe(true);
        },
        { timeout: 3000, interval: 20 },
      );
      staleWork = staleHandler(f.job).then(
        (result) => ({ result }),
        (error: unknown) => ({ error }),
      );
      await vi.waitFor(
        async () => {
          const blocked = await prisma.$queryRaw<{ count: number }[]>`
          SELECT count(*)::int AS count FROM pg_locks
          WHERE relation = '"CallSummary"'::regclass AND NOT granted AND mode = 'AccessShareLock'`;
          expect(blocked[0]?.count).toBeGreaterThan(0);
        },
        { timeout: 3000, interval: 20 },
      );
      nativeWork = gateway.generate(f.request);
      await vi.waitFor(
        () => {
          expect(transportEntered).toBe(true);
        },
        { timeout: 3000, interval: 20 },
      );
      expect(await f.run()).toMatchObject({ provider: 'FIREWORKS', state: 'RESERVED' });
      unlock?.();
      await lockWork;
      expect(lockError).toBeUndefined();
      expect(await staleWork).toMatchObject({ error: { code: 'SUMMARY_INFERENCE_BUSY' } });
      expect(f.fetcher).not.toHaveBeenCalled();
      releaseTransport?.();
      expect(await nativeWork).toMatchObject({ status: 'VALIDATED' });
      expect(await f.handler({}, true)(f.job)).toMatchObject({ outcome: 'OBSERVATION_PUBLISHED' });
      expect(f.fetcher).toHaveBeenCalledTimes(1);
    } finally {
      unlock?.();
      releaseTransport?.();
      await lockWork;
      await staleWork;
      await nativeWork;
    }
  },
  15_000,
);

it('returns the committed observation after transcript correction without revalidating or rewriting historical evidence', async () => {
  const f = await fixture();
  const first = await f.handler()(f.job);
  const applied = await f.run();
  if (!applied.observation) throw new Error('Synthetic publication missing.');
  const claimBefore = await prisma.claim.findFirstOrThrow({
    where: { id: f.request.claim.id, organizationId: f.request.organizationId },
  });
  await prisma.callEvent.updateMany({
    where: { callId: f.callId, call: { organizationId: f.request.organizationId } },
    data: { data: { transcript: { text: 'Corrected synthetic final transcript.', turns: null } } },
  });
  expect(
    await f.handler({ apiKey: '', releases: [], implementationArtifactSha256: '' }, true)(f.job),
  ).toEqual(first);
  expect(f.fetcher).toHaveBeenCalledTimes(1);
  expect((await f.run()).observation).toEqual(applied.observation);
  expect(
    await prisma.auditLog.count({
      where: {
        organizationId: f.request.organizationId,
        action: 'claimObservation.published',
        resourceId: applied.observation.id,
      },
    }),
  ).toBe(1);
  expect(
    await prisma.claim.findFirstOrThrow({
      where: { id: f.request.claim.id, organizationId: f.request.organizationId },
    }),
  ).toEqual(claimBefore);
  const { getClaimObservationEligibility } = await import('@dentabill/db');
  expect(
    await getClaimObservationEligibility(prisma, {
      organizationId: f.request.organizationId,
      observationId: applied.observation.id,
    }),
  ).toMatchObject({ canReview: false, staleReason: 'TRANSCRIPT_CHANGED' });
});

it.each(['unpublished-response', 'missing-publication-audit'] as const)(
  'does not acknowledge historical publication with %s',
  async (missingProof) => {
    const f = await fixture();
    if (missingProof === 'unpublished-response') {
      await failAudit('claimObservation.published');
      await expect(f.handler()(f.job)).rejects.toMatchObject({
        code: 'OBSERVATION_EXECUTION_UNCONFIRMED',
      });
      await clearFault();
      expect(await f.run()).toMatchObject({ state: 'RESPONDED', observation: null });
      await prisma.callEvent.updateMany({
        where: { callId: f.callId, call: { organizationId: f.request.organizationId } },
        data: { data: { transcript: { text: 'Changed before first publication.', turns: null } } },
      });
    } else {
      await f.handler()(f.job);
      await prisma.auditLog.deleteMany({
        where: { organizationId: f.request.organizationId, action: 'claimObservation.published' },
      });
    }
    await expect(f.handler()(f.job)).rejects.toMatchObject({
      code: 'OBSERVATION_EXECUTION_UNCONFIRMED',
    });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    expect(
      await prisma.claimObservation.count({ where: { organizationId: f.request.organizationId } }),
    ).toBe(missingProof === 'unpublished-response' ? 0 : 1);
    expect(
      await prisma.auditLog.count({
        where: { organizationId: f.request.organizationId, action: 'claimObservation.published' },
      }),
    ).toBe(0);
  },
);

it('refunds an expired unused native reservation through the job router with no key, artifact, or catalog', async () => {
  const f = await fixture();
  const controller = new AbortController();
  let enteredAfterReservation = false;
  const gateway = createDurableObservationGateway({
    prisma,
    callId: f.callId,
    dailyTokenLimit: 1_000_000,
    apiKey: 'synthetic-local-key',
    implementationArtifactSha256: OBSERVATION_TEST_ARTIFACT,
    releases: [observationRelease(f.request.organizationId)],
    transport: async (input) => {
      enteredAfterReservation = true;
      controller.abort();
      return f.transport(input);
    },
  });
  expect(await gateway.generate(f.request, { signal: controller.signal })).toMatchObject({
    status: 'FAILED',
    code: 'CANCELLED',
  });
  const reserved = await f.run();
  expect(enteredAfterReservation).toBe(true);
  expect(reserved).toMatchObject({ state: 'RESERVED', attempts: [], totalTokens: null });
  expect(reserved.reservedTokens).toBeGreaterThan(0n);
  if (!reserved.executionDeadlineAt || !reserved.leaseExpiresAt)
    throw new Error('Synthetic reservation deadline missing.');
  expect(reserved.leaseExpiresAt.getTime()).toBeGreaterThan(reserved.executionDeadlineAt.getTime());
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(reserved.executionDeadlineAt.getTime() + 1));
  expect(
    await f.handler(
      { apiKey: '', implementationArtifactSha256: '', releases: [], releaseId: '' },
      true,
    )(f.job),
  ).toMatchObject({ outcome: 'INFERENCE_REVIEW_REQUIRED', tokensUsed: 0 });
  const recovered = await f.run();
  expect(recovered).toMatchObject({
    state: 'REJECTED',
    attempts: [],
    reservedTokens: 0n,
    totalTokens: 0n,
  });
  expect(recovered.reviewAppliedAt).not.toBeNull();
  expect(
    await prisma.inferenceBudget.findFirstOrThrow({
      where: { organizationId: f.request.organizationId },
    }),
  ).toMatchObject({ knownTokens: 0n, reservedTokens: 0n });
  expect(
    await prisma.auditLog.count({
      where: {
        organizationId: f.request.organizationId,
        resourceId: recovered.id,
        action: 'inference.native_unsent_deadline',
      },
    }),
  ).toBe(1);
  expect(f.fetcher).not.toHaveBeenCalled();
  expect(
    await prisma.callSummary.count({ where: { organizationId: f.request.organizationId } }),
  ).toBe(0);
});

it.each(['removed', 'disabled'] as const)(
  'requires the current release catalog for unsent reserved work when its release is %s',
  async (change) => {
    const f = await fixture();
    const release = observationRelease(f.request.organizationId);
    const controller = new AbortController();
    const gateway = createDurableObservationGateway({
      prisma,
      callId: f.callId,
      dailyTokenLimit: 1_000_000,
      apiKey: 'synthetic-local-key',
      implementationArtifactSha256: OBSERVATION_TEST_ARTIFACT,
      releases: [release],
      transport: async (input) => {
        controller.abort();
        return f.transport(input);
      },
    });
    expect(await gateway.generate(f.request, { signal: controller.signal })).toMatchObject({
      status: 'FAILED',
      code: 'CANCELLED',
    });
    const reserved = await f.run();
    expect(reserved).toMatchObject({ state: 'RESERVED', attempts: [] });
    if (!reserved.executionDeadlineAt) throw new Error('Synthetic send deadline missing.');
    expect(reserved.executionDeadlineAt.getTime()).toBeGreaterThan(Date.now());
    // Exercise an expired-owner window without extending the immutable original send deadline.
    await prisma.inferenceRun.update({
      where: { id: reserved.id, organizationId: f.request.organizationId },
      data: { leaseExpiresAt: new Date(Date.now() - 1) },
    });
    const disabled = structuredClone(release);
    disabled.policy.state = 'DISABLED';
    await expect(
      f.handler({ releases: change === 'removed' ? [] : [disabled] })(f.job),
    ).rejects.toMatchObject({ code: 'OBSERVATION_RELEASE_UNAVAILABLE' });
    expect(f.fetcher).not.toHaveBeenCalled();
    const blocked = await f.run();
    expect(blocked).toMatchObject({ state: 'RESERVED', attempts: [] });
    expect(blocked.reservedTokens).toBe(reserved.reservedTokens);
    expect(await f.handler({ releases: [release] })(f.job)).toMatchObject({
      outcome: 'OBSERVATION_PUBLISHED',
    });
    expect(f.fetcher).toHaveBeenCalledTimes(1);
  },
);
