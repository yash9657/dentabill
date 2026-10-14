import { fork, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  authorizeObservationRegeneration,
  previewObservationRegeneration,
  prisma,
  type Prisma,
} from '@dentabill/db';
import {
  createFireworksTransport,
  GatewayRequestSchema,
  ReleaseSchema,
  releasePolicyHash,
} from '@dentabill/model-gateway';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  OBSERVATION_TEST_ARTIFACT,
  observationRelease,
  observationResponse,
  seedObservation,
} from './observation-inference.fixtures.js';
import { createDurableObservationGateway } from './observation-inference.js';
import type {
  ObservationProcessCommand,
  ObservationProcessReply,
} from './observation-process.fixture.js';
import { generateAndPublishObservation } from './observation-publication.js';

const children: ChildProcess[] = [];
const organizations: string[] = [];
const directories: string[] = [];
let immutableRowsCreated = false;

function fixture() {
  const child = fork(fileURLToPath(new URL('./observation-process.fixture.ts', import.meta.url)), {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    execArgv: ['--import', 'tsx'],
    env: { NODE_ENV: 'test', DATABASE_URL: process.env.DATABASE_URL, PATH: process.env.PATH },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  children.push(child);
  child.stderr?.resume();
  const replies: ObservationProcessReply[] = [];
  let exited = false;
  child.on('message', (value: ObservationProcessReply) => {
    replies.push(value);
  });
  child.on('exit', () => {
    exited = true;
  });
  return {
    child,
    send(command: ObservationProcessCommand): void {
      child.send(command);
    },
    async reply<T extends ObservationProcessReply['type']>(
      type: T,
    ): Promise<Extract<ObservationProcessReply, { type: T }>> {
      return vi.waitFor(
        () => {
          if (replies.some((value) => value.type === 'fixture.failed'))
            throw new Error('Synthetic process failed.');
          const completed = replies.find((value) => value.type === 'worker.result');
          if (type === 'worker.paused' && completed?.type === 'worker.result') {
            const outcome =
              completed.result.status === 'FAILED'
                ? completed.result.code
                : completed.result.status;
            throw new Error(`Worker finished before the requested fault boundary: ${outcome}`);
          }
          const value = replies.find(
            (value): value is Extract<ObservationProcessReply, { type: T }> => value.type === type,
          );
          if (!value) throw new Error(`Waiting for ${type}; exited=${String(exited)}`);
          return value;
        },
        { timeout: 15_000, interval: 20 },
      );
    },
    async exited(): Promise<void> {
      await vi.waitFor(
        () => {
          expect(exited).toBe(true);
        },
        { timeout: 5000, interval: 20 },
      );
    },
  };
}

async function seed() {
  const value = await seedObservation(prisma);
  organizations.push(value.request.organizationId);
  return value;
}

async function provider(
  input: Awaited<ReturnType<typeof seed>>,
  mode: Extract<ObservationProcessCommand, { type: 'provider.start' }>['mode'],
) {
  const directory = await mkdtemp(join(tmpdir(), 'dentabill-observation-process-'));
  directories.push(directory);
  const ledgerPath = join(directory, 'synthetic-http-acceptances.jsonl');
  // Private synthetic fixture file owned by this test.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(ledgerPath, '', { mode: 0o600 });
  const external = fixture();
  external.send({ type: 'provider.start', ledgerPath, request: input.request, mode });
  const ready = await external.reply('provider.ready');
  return {
    ...external,
    url: ready.url,
    async ledger(): Promise<unknown[]> {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const value = await readFile(ledgerPath, 'utf8');
      return value
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((row) => JSON.parse(row) as unknown);
    },
  };
}

async function expire(input: Awaited<ReturnType<typeof seed>>, runId?: string) {
  await prisma.inferenceRun.updateMany({
    where: {
      organizationId: input.request.organizationId,
      callId: input.callId,
      ...(runId ? { id: runId } : {}),
    },
    data: { leaseExpiresAt: new Date(0) },
  });
}

beforeAll(async () => {
  await prisma.$connect();
});
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((resolve) =>
        child.once('exit', () => {
          resolve();
        }),
      );
      child.kill('SIGKILL');
      await exited;
    }
  }
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS observation_pending_admission ON "InferenceAttempt"',
  );
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS observation_pending_admission()');
  if (organizations.splice(0).length > 0 || immutableRowsCreated) {
    // Dedicated local process-test database. Immutable history requires TRUNCATE cleanup.
    await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organization" CASCADE');
    immutableRowsCreated = false;
  }
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('Native observation inference across fresh processes', () => {
  it.each(['valid', 'hold'] as const)(
    'recovers an automatic %s job after SIGKILL using its saved provider identity',
    async (mode) => {
      const input = await seed();
      const external = await provider(input, mode);
      const first = fixture();
      first.send({
        type: 'worker.run',
        ...input,
        providerUrl: external.url,
        jobMode: 'new',
        ...(mode === 'valid' ? { pause: 'raw-response' } : {}),
      });
      if (mode === 'valid') await first.reply('worker.paused');
      else await external.reply('provider.accepted');
      first.child.kill('SIGKILL');
      await first.exited();
      await expire(input);
      immutableRowsCreated = mode === 'valid';
      let observationId: string | null | undefined;
      for (let delivery = 0; delivery < 2; delivery++) {
        const restarted = fixture();
        restarted.send({
          type: 'worker.run',
          ...input,
          providerUrl: external.url,
          jobMode: 'recover',
        });
        const recovered = await restarted.reply('job.result');
        expect(recovered).toMatchObject({
          sends: 0,
          result: {
            summaryId: null,
            outcome: mode === 'valid' ? 'OBSERVATION_PUBLISHED' : 'INFERENCE_REVIEW_REQUIRED',
          },
        });
        if (delivery === 0) observationId = recovered.result.observationId;
        else expect(recovered.result.observationId).toBe(observationId);
        await restarted.exited();
      }
      expect(await external.ledger()).toEqual([{ ordinal: 1 }]);
      const run = await prisma.inferenceRun.findFirstOrThrow({
        where: {
          organizationId: input.request.organizationId,
          callId: input.callId,
          generation: 1,
        },
        include: { attempts: true },
      });
      expect(run.attempts).toHaveLength(1);
      if (mode === 'valid')
        expect(run).toMatchObject({ state: 'APPLIED', totalTokens: 31n, reservedTokens: 0n });
      else {
        expect(run).toMatchObject({
          state: 'UNKNOWN',
          totalTokens: null,
          reservedTokens: run.tokenAllowance,
        });
        expect(run.reviewAppliedAt).not.toBeNull();
      }
      expect(
        await prisma.claim.findFirst({
          where: { id: input.request.claim.id, organizationId: input.request.organizationId },
        }),
      ).toMatchObject({ status: 'COMPLETED' });
    },
    20000,
  );

  it('recovers approved generation two after raw-response SIGKILL and publishes once with one independent HTTP acceptance', async () => {
    const input = await seed();
    const organizationId = input.request.organizationId;
    const clerkUserId = `owner_${randomUUID()}`;
    await prisma.user.create({
      data: { organizationId, clerkUserId, email: 'owner@synthetic.invalid', role: 'OWNER' },
    });
    const release = observationRelease(organizationId, { deadlineMs: 5000 });
    immutableRowsCreated = true;
    // Generation one is a local fixture baseline, with no HTTP or provider process.
    const original = await generateAndPublishObservation({
      prisma,
      ...input,
      gateway: createDurableObservationGateway({
        prisma,
        callId: input.callId,
        dailyTokenLimit: 1_000_000,
        apiKey: 'synthetic-local-baseline',
        releases: [release],
        implementationArtifactSha256: OBSERVATION_TEST_ARTIFACT,
        transport: createFireworksTransport({
          fetch: async () => new Response(observationResponse(input.request), { status: 200 }),
        }),
      }),
    });
    const request = GatewayRequestSchema.parse({
      ...input.request,
      invocationId: `observation.${input.callId}.g2`,
    });
    const hash = (value: unknown) =>
      createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const previewInput = {
      organizationId,
      clerkUserId,
      observationId: original.observation.id,
      callId: input.callId,
      claimVersion: new Date(request.claim.version),
      requestPayload: JSON.parse(JSON.stringify(request)) as Prisma.InputJsonValue,
      requestHash: hash(request),
      sourceHash: hash(request.sources),
      releaseId: request.releaseId,
      releasePolicyHash: releasePolicyHash(release.policy),
      implementationArtifactSha256: OBSERVATION_TEST_ARTIFACT,
      releaseSnapshot: JSON.stringify(ReleaseSchema.parse(release)),
    };
    const preview = await previewObservationRegeneration(prisma, previewInput);
    expect(preview).toMatchObject({ canAuthorize: true, nextGeneration: 2 });
    const authorization = (
      await authorizeObservationRegeneration(prisma, {
        ...previewInput,
        expectedPreviewDigest: preview.previewDigest,
        idempotencyKey: randomUUID(),
        reason: 'Synthetic process restart proof',
      })
    ).authorization;
    const regenerated = { callId: input.callId, request };
    const external = await provider(regenerated, 'valid');
    const first = fixture();
    first.send({
      type: 'worker.run',
      ...regenerated,
      regenerationId: authorization.id,
      providerUrl: external.url,
      pause: 'raw-response',
      deadlineMs: 5000,
    });
    expect(await first.reply('worker.paused')).toMatchObject({ boundary: 'raw-response' });
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { organizationId, regenerationId: authorization.id },
      include: { attempts: true },
    });
    expect(run).toMatchObject({
      generation: 2,
      state: 'SUBMITTING',
      resultPayload: null,
      totalTokens: null,
    });
    expect(run.attempts).toHaveLength(1);
    const raw = run.attempts[0]!;
    expect(raw.responseHash).not.toBeNull();
    expect(raw.completionHash).toBeNull();
    expect(await external.ledger()).toEqual([{ ordinal: 1 }]);
    first.child.kill('SIGKILL');
    await first.exited();
    await expire(regenerated, run.id);
    await vi.waitFor(
      () => {
        expect(Date.now()).toBeGreaterThan(run.executionDeadlineAt?.getTime() ?? Infinity);
      },
      { timeout: 6000, interval: 20 },
    );
    for (let delivery = 0; delivery < 2; delivery++) {
      const restarted = fixture();
      restarted.send({
        type: 'worker.run',
        ...regenerated,
        regenerationId: authorization.id,
        providerUrl: external.url,
        deadlineMs: 5000,
      });
      expect(await restarted.reply('worker.result')).toMatchObject({
        sends: 0,
        result: { status: 'VALIDATED' },
      });
      await restarted.exited();
    }
    expect(await external.ledger()).toEqual([{ ordinal: 1 }]);
    const final = await prisma.inferenceRun.findFirstOrThrow({
      where: { id: run.id, organizationId },
      include: { attempts: true, observation: true },
    });
    expect(final).toMatchObject({
      generation: 2,
      regenerationId: authorization.id,
      state: 'APPLIED',
      requestHash: run.requestHash,
      sourceHash: run.sourceHash,
      wireRequestHash: run.wireRequestHash,
      executionDeadlineAt: run.executionDeadlineAt,
      totalTokens: 31n,
      reservedTokens: 0n,
    });
    expect(final.attempts).toHaveLength(1);
    expect(final.attempts[0]).toMatchObject({
      id: raw.id,
      responseHash: raw.responseHash,
      totalTokens: 31n,
    });
    expect(final.observation).toMatchObject({
      version: 2,
      supersedesObservationId: original.observation.id,
    });
    expect(await prisma.claimObservation.count({ where: { organizationId } })).toBe(2);
    expect(await prisma.inferenceRun.count({ where: { organizationId } })).toBe(2);
    expect(await prisma.inferenceBudget.findFirst({ where: { organizationId } })).toMatchObject({
      knownTokens: 62n,
      reservedTokens: 0n,
    });
    expect(
      await prisma.auditLog.count({
        where: {
          organizationId,
          action: 'claimObservation.published',
          resourceId: final.observation?.id ?? '',
        },
      }),
    ).toBe(1);
  }, 25000);

  it('refunds a proven unsent reservation after a pre-admission crash and the original deadline expires', async () => {
    const input = await seed();
    const external = await provider(input, 'valid');
    const first = fixture();
    first.send({
      type: 'worker.run',
      ...input,
      providerUrl: external.url,
      pause: 'before-first-admission',
      deadlineMs: 5000,
    });
    expect(await first.reply('worker.paused')).toMatchObject({
      boundary: 'before-first-admission',
    });
    const reserved = await prisma.inferenceRun.findFirstOrThrow({
      where: { organizationId: input.request.organizationId, callId: input.callId },
    });
    expect(reserved).toMatchObject({ state: 'RESERVED', reservedTokens: reserved.tokenAllowance });
    first.child.kill('SIGKILL');
    await first.exited();
    await vi.waitFor(
      () => {
        expect(Date.now()).toBeGreaterThan(reserved.executionDeadlineAt?.getTime() ?? Infinity);
      },
      { timeout: 6000, interval: 20 },
    );
    for (let attempt = 0; attempt < 2; attempt++) {
      const restarted = fixture();
      restarted.send({ type: 'worker.run', ...input, providerUrl: external.url, deadlineMs: 5000 });
      expect(await restarted.reply('worker.result')).toMatchObject({
        sends: 0,
        result: { status: 'FAILED', code: 'DEADLINE_EXCEEDED' },
      });
      await restarted.exited();
    }
    expect(await external.ledger()).toHaveLength(0);
    expect(
      await prisma.inferenceAttempt.count({
        where: { organizationId: input.request.organizationId },
      }),
    ).toBe(0);
    expect(
      await prisma.inferenceRun.findFirst({
        where: { organizationId: input.request.organizationId, callId: input.callId },
      }),
    ).toMatchObject({
      state: 'REJECTED',
      reservedTokens: 0n,
      totalTokens: 0n,
      requestHash: reserved.requestHash,
    });
    expect(
      await prisma.inferenceBudget.findFirst({
        where: { organizationId: input.request.organizationId },
      }),
    ).toMatchObject({ reservedTokens: 0n, knownTokens: 0n });
  }, 20_000);

  it.each([
    ['valid', 'VALIDATED', null],
    ['model', 'FAILED', 'MODEL_IDENTITY_MISMATCH'],
    ['finish', 'FAILED', 'TRUNCATED'],
    ['schema', 'FAILED', 'OUTPUT_SCHEMA_INVALID'],
  ] as const)(
    'replays a committed raw %s response after SIGKILL before validation with no HTTP resend',
    async (mode, status, code) => {
      const input = await seed();
      const external = await provider(input, mode);
      const first = fixture();
      first.send({
        type: 'worker.run',
        ...input,
        providerUrl: external.url,
        pause: 'raw-response',
        deadlineMs: 5000,
      });
      expect(await first.reply('worker.paused')).toMatchObject({ boundary: 'raw-response' });
      const run = await prisma.inferenceRun.findFirstOrThrow({
        where: { organizationId: input.request.organizationId, callId: input.callId },
      });
      const attempt = await prisma.inferenceAttempt.findFirstOrThrow({
        where: { organizationId: input.request.organizationId, runId: run.id },
      });
      expect(run.resultPayload).toBeNull();
      expect(attempt.responseHash).not.toBeNull();
      expect(attempt.completionHash).toBeNull();
      expect(attempt.totalTokens).toBeNull();
      first.child.kill('SIGKILL');
      await first.exited();
      await expire(input);
      await vi.waitFor(
        () => {
          expect(Date.now()).toBeGreaterThan(run.executionDeadlineAt?.getTime() ?? Infinity);
        },
        { timeout: 6000, interval: 20 },
      );
      const restarted = fixture();
      restarted.send({ type: 'worker.run', ...input, providerUrl: external.url, deadlineMs: 5000 });
      const reply = await restarted.reply('worker.result');
      expect(reply.sends).toBe(0);
      expect(reply.result).toMatchObject({ status, ...(code ? { code } : {}) });
      await restarted.exited();
      expect(await external.ledger()).toEqual([{ ordinal: 1 }]);
      expect(
        await prisma.inferenceAttempt.count({
          where: { organizationId: input.request.organizationId },
        }),
      ).toBe(1);
      expect(
        await prisma.inferenceBudget.findFirst({
          where: { organizationId: input.request.organizationId },
        }),
      ).toMatchObject({ knownTokens: 31n, reservedTokens: 0n });
      expect(
        await prisma.inferenceRun.findFirst({
          where: { organizationId: input.request.organizationId, callId: input.callId },
        }),
      ).toMatchObject({
        requestHash: run.requestHash,
        sourceHash: run.sourceHash,
        wireRequestHash: run.wireRequestHash,
        totalTokens: 31n,
      });
    },
    20_000,
  );

  it('retains UNKNOWN and its full reservation after external acceptance with no durable response', async () => {
    const input = await seed();
    const external = await provider(input, 'hold');
    const first = fixture();
    first.send({ type: 'worker.run', ...input, providerUrl: external.url });
    await external.reply('provider.accepted');
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { organizationId: input.request.organizationId, callId: input.callId },
    });
    first.child.kill('SIGKILL');
    await first.exited();
    await expire(input);
    const restarted = fixture();
    restarted.send({ type: 'worker.run', ...input, providerUrl: external.url });
    expect(await restarted.reply('worker.result')).toMatchObject({
      sends: 0,
      result: { status: 'FAILED', code: 'INFERENCE_REVIEW_REQUIRED' },
    });
    await restarted.exited();
    expect(await external.ledger()).toEqual([{ ordinal: 1 }]);
    expect(
      await prisma.inferenceRun.findFirst({
        where: { id: run.id, organizationId: input.request.organizationId },
      }),
    ).toMatchObject({ state: 'UNKNOWN', totalTokens: null, reservedTokens: run.tokenAllowance });
  }, 20_000);

  it('retains both reservations when killed after retry admission but before its HTTP send', async () => {
    const input = await seed();
    const external = await provider(input, 'retry');
    const first = fixture();
    first.send({
      type: 'worker.run',
      ...input,
      providerUrl: external.url,
      pause: 'second-admission',
    });
    expect(await first.reply('worker.paused')).toMatchObject({ boundary: 'second-admission' });
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { organizationId: input.request.organizationId, callId: input.callId },
    });
    expect(run.reservedTokens).toBe(run.tokenAllowance * 2n);
    expect(
      await prisma.inferenceAttempt.count({
        where: { organizationId: input.request.organizationId },
      }),
    ).toBe(2);
    first.child.kill('SIGKILL');
    await first.exited();
    await expire(input);
    const restarted = fixture();
    restarted.send({ type: 'worker.run', ...input, providerUrl: external.url });
    expect(await restarted.reply('worker.result')).toMatchObject({
      sends: 0,
      result: { status: 'FAILED', code: 'INFERENCE_REVIEW_REQUIRED' },
    });
    await restarted.exited();
    expect(await external.ledger()).toEqual([{ ordinal: 1 }]);
    expect(
      await prisma.inferenceBudget.findFirst({
        where: { organizationId: input.request.organizationId },
      }),
    ).toMatchObject({ knownTokens: 0n, reservedTokens: run.tokenAllowance * 2n });
  }, 20_000);

  it('never sends when cancellation wins while real PostgreSQL attempt admission remains pending', async () => {
    const input = await seed();
    const external = await provider(input, 'valid');
    const key = 411337;
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION observation_pending_admission() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${String(key)}); RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER observation_pending_admission BEFORE INSERT ON "InferenceAttempt" FOR EACH ROW EXECUTE FUNCTION observation_pending_admission()',
    );
    const worker = fixture();
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${key})::text`;
        worker.send({ type: 'worker.run', ...input, providerUrl: external.url });
        await vi.waitFor(
          async () => {
            const waiting = await prisma.$queryRaw<
              { count: bigint }[]
            >`SELECT count(*) FROM pg_locks WHERE locktype='advisory' AND objid::bigint=${BigInt(key)} AND NOT granted`;
            expect(waiting[0]?.count).toBeGreaterThan(0n);
          },
          { timeout: 10_000, interval: 20 },
        );
        worker.send({ type: 'worker.cancel' });
        const result = await worker.reply('worker.result');
        expect(result.sends).toBe(0);
        expect(result.result.status).toBe('FAILED');
        expect(await external.ledger()).toHaveLength(0);
      },
      { timeout: 20_000 },
    );
    await worker.exited();
    expect(await external.ledger()).toHaveLength(0);
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { organizationId: input.request.organizationId, callId: input.callId },
    });
    expect(run.resultPayload).toBeNull();
    expect(run.reservedTokens).toBe(run.tokenAllowance);
    await expire(input);
    const restarted = fixture();
    restarted.send({ type: 'worker.run', ...input, providerUrl: external.url });
    expect(await restarted.reply('worker.result')).toMatchObject({
      sends: 0,
      result: { status: 'FAILED', code: 'INFERENCE_REVIEW_REQUIRED' },
    });
    await restarted.exited();
    expect(await external.ledger()).toHaveLength(0);
  }, 25_000);
});
