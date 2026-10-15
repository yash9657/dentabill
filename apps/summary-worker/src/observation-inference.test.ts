import { once } from 'node:events';
import { createServer, type Server } from 'node:http';

import { prisma } from '@dentabill/db';
import {
  createFireworksTransport,
  type GatewayRequest,
  type GatewayResult,
  type TransportResult,
} from '@dentabill/model-gateway';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import {
  OBSERVATION_TEST_ARTIFACT,
  observationRelease,
  observationResponse,
  seedObservation,
  type ObservationResponseVariant,
} from './observation-inference.fixtures.js';
import { createDurableObservationGateway } from './observation-inference.js';

const organizations: string[] = [];
const servers: Server[] = [];

function withoutTiming(result: GatewayResult): unknown {
  // PostgreSQL JSON serialization may round an insignificant fractional timing digit.
  return JSON.parse(
    JSON.stringify(result, (key: string, value: unknown) =>
      key === 'elapsedMs' ? undefined : value,
    ),
  ) as unknown;
}

async function seed() {
  const value = await seedObservation(prisma);
  organizations.push(value.request.organizationId);
  return value;
}

async function localProvider(
  request: GatewayRequest,
  statuses = [200],
  variant: ObservationResponseVariant = 'valid',
  lowerLimitAfterFirst = false,
) {
  const admissions: {
    attempts: number;
    reservedTokens: bigint;
    allowance: bigint;
    bodyBytes: number;
  }[] = [];
  let count = 0;
  const server = createServer((incoming, response) => {
    void (async () => {
      const buffers: Buffer[] = [];
      for await (const chunk of incoming) buffers.push(Buffer.from(chunk as Uint8Array));
      const run = await prisma.inferenceRun.findFirstOrThrow({
        where: { organizationId: request.organizationId, claimId: request.claim.id },
      });
      const attempts = await prisma.inferenceAttempt.count({
        where: { organizationId: request.organizationId, runId: run.id },
      });
      admissions.push({
        attempts,
        reservedTokens: run.reservedTokens,
        allowance: run.tokenAllowance,
        bodyBytes: Buffer.concat(buffers).length,
      });
      if (lowerLimitAfterFirst && count === 0) {
        await prisma.inferenceBudget.updateMany({
          where: { organizationId: request.organizationId },
          data: { tokenLimit: run.tokenAllowance },
        });
      }
      const status = statuses[count++] ?? 200;
      response.writeHead(status, { 'content-type': 'application/json', 'retry-after': '0' });
      response.end(
        status === 200
          ? observationResponse(request, variant)
          : '{"error":"synthetic unavailable"}',
      );
    })().catch(() => {
      response.writeHead(500);
      response.end();
    });
  });
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local provider did not listen.');
  const transport = createFireworksTransport({
    fetch: async (url, init) => {
      expect(typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).toBe(
        'https://us.api.fireworks.ai/inference/v1/chat/completions',
      );
      return fetch(`http://127.0.0.1:${String(address.port)}/synthetic-observation`, init);
    },
  });
  return { transport, admissions, count: () => count };
}

beforeAll(async () => {
  await prisma.$connect();
});
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) =>
      server.close(() => {
        resolve();
      }),
    );
  }
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS observation_fail_response ON "AuditLog"');
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS observation_fail_response()');
  for (const organizationId of organizations.splice(0)) {
    await prisma.inferenceAttempt.deleteMany({ where: { organizationId } });
    await prisma.inferenceRun.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('Durable native observation gateway', () => {
  it('journals admission before local HTTP and replays the frozen result without another send or claim application', async () => {
    const { callId, request } = await seed();
    const provider = await localProvider(request);
    const options = {
      prisma,
      callId,
      dailyTokenLimit: 1_000_000,
      apiKey: 'synthetic-test-key',
      releases: [observationRelease(request.organizationId)],
      implementationArtifactSha256: OBSERVATION_TEST_ARTIFACT,
      transport: provider.transport,
    };
    const result = await createDurableObservationGateway(options).generate(request);
    expect(result.status).toBe('VALIDATED');
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { organizationId: request.organizationId, callId },
    });
    expect(run).toMatchObject({
      provider: 'FIREWORKS',
      generation: 1,
      state: 'RESPONDED',
      totalTokens: 31n,
      reservedTokens: 0n,
      requestPayload: request,
    });
    expect(provider.admissions).toHaveLength(1);
    const first = provider.admissions[0];
    expect(first?.attempts).toBe(1);
    expect(first?.reservedTokens).toBe(first?.allowance);
    expect(first?.allowance).toBe(BigInt((first?.bodyBytes ?? 0) * 2 + 4096));
    await prisma.claim.updateMany({
      where: { id: request.claim.id, organizationId: request.organizationId },
      data: { status: 'RESOLVED', claimAmount: '50.00' },
    });
    const replay = await createDurableObservationGateway(options).generate(request);
    expect(withoutTiming(replay)).toEqual(withoutTiming(result));
    expect(withoutTiming(await createDurableObservationGateway(options).generate(request))).toEqual(
      withoutTiming(result),
    );
    expect(provider.count()).toBe(1);
    expect(
      await prisma.callSummary.count({ where: { organizationId: request.organizationId } }),
    ).toBe(0);
    expect(
      await prisma.claim.findFirst({
        where: { id: request.claim.id, organizationId: request.organizationId },
      }),
    ).toMatchObject({ status: 'RESOLVED' });
  });

  it('reserves attempt two separately while retaining unknown usage from an explicit 503', async () => {
    const { callId, request } = await seed();
    const provider = await localProvider(request, [503, 200]);
    const result = await createDurableObservationGateway({
      prisma,
      callId,
      dailyTokenLimit: 1_000_000,
      apiKey: 'synthetic-test-key',
      releases: [observationRelease(request.organizationId)],
      implementationArtifactSha256: OBSERVATION_TEST_ARTIFACT,
      transport: provider.transport,
    }).generate(request);
    expect(result.status).toBe('VALIDATED');
    expect(provider.admissions).toHaveLength(2);
    expect(provider.admissions[1]?.attempts).toBe(2);
    expect(provider.admissions[1]?.reservedTokens).toBe(
      (provider.admissions[0]?.allowance ?? 0n) * 2n,
    );
    const attempts = await prisma.inferenceAttempt.findMany({
      where: { organizationId: request.organizationId },
      orderBy: { attemptNumber: 'asc' },
    });
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      httpStatus: 503,
      totalTokens: null,
      reservedTokens: attempts[0]?.tokenAllowance,
    });
    expect(attempts[1]).toMatchObject({ httpStatus: 200, totalTokens: 31n, reservedTokens: 0n });
    expect(
      await prisma.inferenceBudget.findFirst({ where: { organizationId: request.organizationId } }),
    ).toMatchObject({ knownTokens: 31n, reservedTokens: attempts[0]?.tokenAllowance });
    expect(
      await prisma.inferenceRun.findFirst({
        where: { organizationId: request.organizationId, callId },
      }),
    ).toMatchObject({
      state: 'RESPONDED',
      totalTokens: null,
      reservedTokens: attempts[0]?.tokenAllowance,
    });
  });

  it.each([
    ['model', 'MODEL_IDENTITY_MISMATCH'],
    ['finish', 'TRUNCATED'],
    ['schema', 'OUTPUT_SCHEMA_INVALID'],
  ] as const)(
    'keeps the raw %s rejection and known usage for repeatable local validation',
    async (variant, code) => {
      const { callId, request } = await seed();
      const provider = await localProvider(request, [200], variant);
      const options = {
        prisma,
        callId,
        dailyTokenLimit: 1_000_000,
        apiKey: 'synthetic-test-key',
        releases: [observationRelease(request.organizationId)],
        implementationArtifactSha256: OBSERVATION_TEST_ARTIFACT,
        transport: provider.transport,
      };
      const result = await createDurableObservationGateway(options).generate(request);
      expect(result).toMatchObject({ status: 'FAILED', code });
      const attempt = await prisma.inferenceAttempt.findFirstOrThrow({
        where: { organizationId: request.organizationId },
      });
      expect(attempt.responseRecordedAt).not.toBeNull();
      expect(attempt.responsePayload).toMatchObject({
        status: 200,
        body: observationResponse(request, variant),
      });
      expect(attempt.totalTokens).toBe(31n);
      expect(
        withoutTiming(await createDurableObservationGateway(options).generate(request)),
      ).toEqual(withoutTiming(result));
      expect(provider.count()).toBe(1);
    },
  );

  it('denies a second HTTP attempt when its additional allowance no longer fits the persisted budget', async () => {
    const { callId, request } = await seed();
    const provider = await localProvider(request, [503, 200], 'valid', true);
    const result = await createDurableObservationGateway({
      prisma,
      callId,
      dailyTokenLimit: 1_000_000,
      apiKey: 'synthetic-test-key',
      releases: [observationRelease(request.organizationId)],
      implementationArtifactSha256: OBSERVATION_TEST_ARTIFACT,
      transport: provider.transport,
    }).generate(request);
    expect(result).toMatchObject({ status: 'FAILED', code: 'BUDGET_EXCEEDED' });
    expect(provider.count()).toBe(1);
    const attempts = await prisma.inferenceAttempt.findMany({
      where: { organizationId: request.organizationId },
    });
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ httpStatus: 503, totalTokens: null });
    expect(
      await prisma.inferenceBudget.findFirst({ where: { organizationId: request.organizationId } }),
    ).toMatchObject({ knownTokens: 0n, reservedTokens: attempts[0]?.tokenAllowance });
  });

  it('retains the full liability when native usage contradicts its known input and output counts', async () => {
    const { callId, request } = await seed();
    const provider = await localProvider(request, [200], 'usage');
    const result = await createDurableObservationGateway({
      prisma,
      callId,
      dailyTokenLimit: 1_000_000,
      apiKey: 'synthetic-test-key',
      releases: [observationRelease(request.organizationId)],
      implementationArtifactSha256: OBSERVATION_TEST_ARTIFACT,
      transport: provider.transport,
    }).generate(request);
    expect(result).toMatchObject({ status: 'FAILED', code: 'INVALID_RESPONSE' });
    expect(provider.count()).toBe(1);
    const attempt = await prisma.inferenceAttempt.findFirstOrThrow({
      where: { organizationId: request.organizationId },
    });
    expect(attempt).toMatchObject({
      totalTokens: null,
      inputTokens: 19n,
      outputTokens: 12n,
      reservedTokens: attempt.tokenAllowance,
    });
    expect(
      await prisma.inferenceBudget.findFirst({ where: { organizationId: request.organizationId } }),
    ).toMatchObject({ knownTokens: 0n, reservedTokens: attempt.tokenAllowance });
  });

  it.each(['valid', 'model'] as const)(
    'replays a %s response cancelled after usage parsing without sending or charging again',
    async (variant) => {
      const { callId, request } = await seed();
      const provider = await localProvider(request, [200], variant);
      const controller = new AbortController();
      const nativeWork: Promise<TransportResult>[] = [];
      const options = {
        prisma,
        callId,
        dailyTokenLimit: 1_000_000,
        apiKey: 'synthetic-test-key',
        releases: [observationRelease(request.organizationId)],
        implementationArtifactSha256: OBSERVATION_TEST_ARTIFACT,
      };
      const interrupted = await createDurableObservationGateway({
        ...options,
        transport: (input) => {
          const work = provider.transport({
            ...input,
            onProgress: (progress) => {
              input.onProgress?.(progress);
              if (progress.activeAttempt?.usage.totalTokens === 31) controller.abort();
            },
          });
          nativeWork.push(work);
          return work;
        },
      }).generate(request, { signal: controller.signal });
      expect(interrupted).toMatchObject({ status: 'FAILED', code: 'CANCELLED' });
      await Promise.allSettled(nativeWork);
      const attempt = await prisma.inferenceAttempt.findFirstOrThrow({
        where: { organizationId: request.organizationId },
      });
      expect(attempt.responseRecordedAt).not.toBeNull();
      expect(attempt.completedAt).not.toBeNull();
      expect(attempt).toMatchObject({ totalTokens: 31n, reservedTokens: 0n });
      await prisma.inferenceRun.updateMany({
        where: { organizationId: request.organizationId, callId },
        data: { leaseExpiresAt: new Date(0) },
      });
      const replay = await createDurableObservationGateway({
        ...options,
        transport: provider.transport,
      }).generate(request);
      expect(replay).toMatchObject(
        variant === 'valid'
          ? { status: 'VALIDATED' }
          : { status: 'FAILED', code: 'MODEL_IDENTITY_MISMATCH' },
      );
      expect(provider.count()).toBe(1);
      expect(
        await prisma.inferenceBudget.findFirst({
          where: { organizationId: request.organizationId },
        }),
      ).toMatchObject({ knownTokens: 31n, reservedTokens: 0n });
      expect(
        await prisma.inferenceAttempt.count({ where: { organizationId: request.organizationId } }),
      ).toBe(1);
    },
  );

  it('does not finalize a transient raw-response journal failure or submit again after ownership expires', async () => {
    const { callId, request } = await seed();
    const provider = await localProvider(request);
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION observation_fail_response() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'inference.native_response_recorded' THEN RAISE EXCEPTION 'synthetic receipt failure'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER observation_fail_response BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION observation_fail_response()',
    );
    const options = {
      prisma,
      callId,
      dailyTokenLimit: 1_000_000,
      apiKey: 'synthetic-test-key',
      releases: [observationRelease(request.organizationId)],
      implementationArtifactSha256: OBSERVATION_TEST_ARTIFACT,
      transport: provider.transport,
    };
    expect(await createDurableObservationGateway(options).generate(request)).toMatchObject({
      status: 'FAILED',
      code: 'JOURNAL_ERROR',
    });
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { organizationId: request.organizationId, callId },
    });
    expect(run).toMatchObject({
      state: 'SUBMITTING',
      resultPayload: null,
      reservedTokens: run.tokenAllowance,
    });
    await prisma.$executeRawUnsafe('DROP TRIGGER observation_fail_response ON "AuditLog"');
    await prisma.$executeRawUnsafe('DROP FUNCTION observation_fail_response()');
    await prisma.inferenceRun.updateMany({
      where: { id: run.id, organizationId: request.organizationId },
      data: { leaseExpiresAt: new Date(0) },
    });
    expect(await createDurableObservationGateway(options).generate(request)).toMatchObject({
      status: 'FAILED',
      code: 'INFERENCE_REVIEW_REQUIRED',
    });
    expect(provider.count()).toBe(1);
  });

  it('rejects a changed invocation or request instead of creating another generation', async () => {
    const { callId, request } = await seed();
    const provider = await localProvider(request);
    const gateway = createDurableObservationGateway({
      prisma,
      callId,
      dailyTokenLimit: 1_000_000,
      apiKey: 'synthetic-test-key',
      releases: [observationRelease(request.organizationId)],
      implementationArtifactSha256: OBSERVATION_TEST_ARTIFACT,
      transport: provider.transport,
    });
    expect((await gateway.generate(request)).status).toBe('VALIDATED');
    expect(
      await gateway.generate({ ...request, invocationId: 'another-invocation' }),
    ).toMatchObject({ status: 'FAILED', code: 'INFERENCE_REVIEW_REQUIRED' });
    expect(provider.count()).toBe(1);
    expect(
      await prisma.inferenceRun.count({
        where: { organizationId: request.organizationId, callId },
      }),
    ).toBe(1);
  });

  it.each(['active', 'different-call', 'stale-claim', 'wrong-amount'] as const)(
    'denies %s source binding before reservation or HTTP',
    async (variant) => {
      const { callId, request } = await seed();
      if (variant === 'active')
        await prisma.call.updateMany({
          where: { organizationId: request.organizationId, id: callId },
          data: { status: 'COLLECTING' },
        });
      if (variant === 'stale-claim')
        await prisma.claim.updateMany({
          where: { organizationId: request.organizationId, id: request.claim.id },
          data: { updatedAt: new Date(0) },
        });
      const provider = await localProvider(request);
      const result = await createDurableObservationGateway({
        prisma,
        callId: variant === 'different-call' ? 'unrelated-call' : callId,
        dailyTokenLimit: 1_000_000,
        apiKey: 'synthetic-test-key',
        releases: [observationRelease(request.organizationId)],
        implementationArtifactSha256: OBSERVATION_TEST_ARTIFACT,
        transport: provider.transport,
      }).generate(
        variant === 'wrong-amount'
          ? { ...request, claim: { ...request.claim, billedMinorUnits: 1 } }
          : request,
      );
      expect(result).toMatchObject({ status: 'FAILED', code: 'INVALID_REQUEST' });
      expect(provider.count()).toBe(0);
      expect(
        await prisma.inferenceRun.count({ where: { organizationId: request.organizationId } }),
      ).toBe(0);
    },
  );
});
