import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from '@dentabill/db';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { seedObservation } from './observation-inference.fixtures.js';
import type {
  ObservationProcessCommand,
  ObservationProcessReply,
} from './observation-process.fixture.js';

const children: ChildProcess[] = [];
const organizations: string[] = [];
const directories: string[] = [];

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

async function expire(input: Awaited<ReturnType<typeof seed>>) {
  await prisma.inferenceRun.updateMany({
    where: { organizationId: input.request.organizationId, callId: input.callId },
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
  for (const organizationId of organizations.splice(0)) {
    await prisma.inferenceAttempt.deleteMany({ where: { organizationId } });
    await prisma.inferenceRun.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('Native observation inference across fresh processes', () => {
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
