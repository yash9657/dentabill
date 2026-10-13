import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from '@dentabill/db';
import type { SummaryJobData } from '@dentabill/queue';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  InferenceFixtureCommand,
  InferenceFixtureReply,
} from './inference-process.fixture.js';

const children: ChildProcess[] = [];
const organizations: string[] = [];
const directories: string[] = [];

function fixture() {
  const child = fork(fileURLToPath(new URL('./inference-process.fixture.ts', import.meta.url)), {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    execArgv: ['--import', 'tsx'],
    env: { NODE_ENV: 'test', DATABASE_URL: process.env.DATABASE_URL, PATH: process.env.PATH },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  children.push(child);
  const replies: InferenceFixtureReply[] = [];
  let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  child.stderr?.resume();
  child.on('message', (reply: InferenceFixtureReply) => {
    replies.push(reply);
  });
  child.on('exit', (code, signal) => {
    exit = { code, signal };
  });
  return {
    child,
    send(command: InferenceFixtureCommand): void {
      child.send(command);
    },
    async reply<T extends InferenceFixtureReply['type']>(
      type: T,
    ): Promise<Extract<InferenceFixtureReply, { type: T }>> {
      return vi.waitFor(
        () => {
          const failure = replies.find((reply) => reply.type === 'fixture.failed');
          if (failure) throw new Error(failure.message);
          const found = replies.find(
            (reply): reply is Extract<InferenceFixtureReply, { type: T }> => reply.type === type,
          );
          if (!found) throw new Error(`Waiting for ${type}; exit=${JSON.stringify(exit)}`);
          return found;
        },
        { timeout: 15_000, interval: 20 },
      );
    },
    async exited() {
      return vi.waitFor(
        () => {
          if (!exit) throw new Error('Fixture has not exited.');
          return exit;
        },
        { timeout: 5000, interval: 20 },
      );
    },
  };
}

async function provider(response: 'hold' | 'accept') {
  const directory = await mkdtemp(join(tmpdir(), 'dentabill-inference-process-'));
  directories.push(directory);
  const ledgerPath = join(directory, 'synthetic-acceptances.jsonl');
  // This path belongs to the test's private synthetic-only temporary directory.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(ledgerPath, '', { mode: 0o600 });
  const processFixture = fixture();
  processFixture.send({ type: 'provider.start', ledgerPath, response });
  const ready = await processFixture.reply('provider.ready');
  return {
    ...processFixture,
    ...ready,
    async ledger(): Promise<unknown[]> {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const text = await readFile(ledgerPath, 'utf8');
      return text
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((row) => JSON.parse(row) as unknown);
    },
  };
}

async function seed(): Promise<SummaryJobData> {
  const id = randomUUID();
  const org = await prisma.organization.create({
    data: { name: 'Synthetic inference practice', clerkOrgId: `inference_process_${id}` },
  });
  organizations.push(org.id);
  const claim = await prisma.claim.create({
    data: {
      organizationId: org.id,
      patientDOBHash: 'synthetic',
      claimNumber: 'SYNTHETIC-INFERENCE',
      cdtCodes: ['D1110'],
      claimAmount: '100.00',
      payerCode: 'DELTA_DENTAL_PPO',
      serviceDate: new Date('2026-10-01T00:00:00Z'),
      status: 'COMPLETED',
    },
  });
  const call = await prisma.call.create({
    data: {
      organizationId: org.id,
      claimId: claim.id,
      retellCallId: `synthetic_inference_${id}`,
      status: 'COMPLETED',
      endedAt: new Date(),
    },
  });
  await prisma.callEvent.create({
    data: {
      callId: call.id,
      eventType: 'call.transcript',
      data: { role: 'representative', text: 'This synthetic claim needs manual review.' },
    },
  });
  return {
    organizationId: org.id,
    callId: call.id,
    promptVersion: 'v1',
    idempotencyKey: `call.${call.id}`,
  };
}

beforeAll(async () => {
  await prisma.$connect();
});
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const done = new Promise<void>((resolve) => {
        child.once('exit', () => {
          resolve();
        });
      });
      child.kill('SIGKILL');
      await done;
    }
  }
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS inference_process_fail_audit ON "AuditLog"',
  );
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS inference_process_fail_audit()');
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS inference_process_before_attempt ON "InferenceAttempt"',
  );
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS inference_process_before_attempt()');
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

describe('Durable inference across fresh processes and SIGKILL', () => {
  it('keeps unknown acceptance and its reservation after provider fsync and worker death', async () => {
    const data = await seed();
    const external = await provider('hold');
    const command: InferenceFixtureCommand = {
      type: 'worker.run',
      data,
      providerUrl: external.url,
    };
    const first = fixture();
    first.send(command);
    await external.reply('provider.accepted');
    const submitted = await prisma.inferenceRun.findFirstOrThrow({
      where: { organizationId: data.organizationId, callId: data.callId, generation: 1 },
    });
    expect(submitted.state).toBe('SUBMITTING');
    expect(submitted.reservedTokens).toBeGreaterThan(0n);
    expect(submitted.totalTokens).toBeNull();
    expect(external.pid).not.toBe(first.child.pid);
    first.child.kill('SIGKILL');
    expect(await first.exited()).toEqual({ code: null, signal: 'SIGKILL' });
    await prisma.inferenceRun.updateMany({
      where: { id: submitted.id, organizationId: data.organizationId },
      data: { leaseExpiresAt: new Date(0) },
    });
    for (let delivery = 0; delivery < 2; delivery++) {
      const restarted = fixture();
      restarted.send(command);
      expect(await restarted.reply('worker.result')).toMatchObject({
        submissions: 0,
        result: { outcome: 'INFERENCE_REVIEW_REQUIRED', tokensUsed: null },
      });
      await restarted.exited();
    }
    expect(await external.ledger()).toEqual([
      { organizationId: data.organizationId, callId: data.callId },
    ]);
    const run = await prisma.inferenceRun.findFirstOrThrow({
      where: { id: submitted.id, organizationId: data.organizationId },
    });
    expect(run).toMatchObject({
      state: 'UNKNOWN',
      requestHash: submitted.requestHash,
      sourceHash: submitted.sourceHash,
      reservedTokens: submitted.reservedTokens,
      totalTokens: null,
    });
    expect(
      await prisma.inferenceAttempt.count({ where: { organizationId: data.organizationId } }),
    ).toBe(1);
    expect(await prisma.callSummary.count({ where: { organizationId: data.organizationId } })).toBe(
      0,
    );
    expect(
      (
        await prisma.inferenceBudget.findFirstOrThrow({
          where: { organizationId: data.organizationId },
        })
      ).reservedTokens,
    ).toBe(submitted.reservedTokens);
  });

  it('replays a saved response after application rollback without another inference or charge', async () => {
    const data = await seed();
    const external = await provider('accept');
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION inference_process_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'claim.transition' THEN RAISE EXCEPTION 'synthetic application failure'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER inference_process_fail_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION inference_process_fail_audit()',
    );
    const command: InferenceFixtureCommand = {
      type: 'worker.run',
      data,
      providerUrl: external.url,
    };
    const first = fixture();
    first.send(command);
    expect(await first.reply('worker.error')).toMatchObject({ submissions: 1 });
    await first.exited();
    const saved = await prisma.inferenceRun.findFirstOrThrow({
      where: { organizationId: data.organizationId, callId: data.callId, generation: 1 },
    });
    expect(saved).toMatchObject({ state: 'RESPONDED', totalTokens: 37n, reservedTokens: 0n });
    expect(saved.resultPayload).not.toBeNull();
    expect(await prisma.callSummary.count({ where: { organizationId: data.organizationId } })).toBe(
      0,
    );
    const budget = await prisma.inferenceBudget.findFirstOrThrow({
      where: { organizationId: data.organizationId },
    });
    expect(budget.knownTokens).toBe(37n);
    await prisma.$executeRawUnsafe('DROP TRIGGER inference_process_fail_audit ON "AuditLog"');
    await prisma.$executeRawUnsafe('DROP FUNCTION inference_process_fail_audit()');
    await prisma.inferenceRun.updateMany({
      where: { id: saved.id, organizationId: data.organizationId },
      data: { leaseExpiresAt: new Date(0) },
    });
    const restarted = fixture();
    restarted.send(command);
    expect(await restarted.reply('worker.result')).toMatchObject({
      submissions: 0,
      result: { outcome: 'MANUAL_REVIEW', tokensUsed: 37 },
    });
    await restarted.exited();
    expect(await external.ledger()).toHaveLength(1);
    expect(await prisma.callSummary.count({ where: { organizationId: data.organizationId } })).toBe(
      1,
    );
    expect(
      await prisma.inferenceAttempt.count({ where: { organizationId: data.organizationId } }),
    ).toBe(1);
    expect(
      (
        await prisma.inferenceBudget.findFirstOrThrow({
          where: { organizationId: data.organizationId },
        })
      ).knownTokens,
    ).toBe(37n);
    expect(
      await prisma.inferenceRun.findFirst({
        where: { id: saved.id, organizationId: data.organizationId },
      }),
    ).toMatchObject({
      state: 'APPLIED',
      requestHash: saved.requestHash,
      sourceHash: saved.sourceHash,
    });
  });

  it('reclaims a reservation after SIGKILL before the submission marker commits, with exactly one later send', async () => {
    const data = await seed();
    const external = await provider('accept');
    const key = 261337;
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION inference_process_before_attempt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(${String(key)}); RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER inference_process_before_attempt BEFORE INSERT ON "InferenceAttempt" FOR EACH ROW EXECUTE FUNCTION inference_process_before_attempt()',
    );
    const command: InferenceFixtureCommand = {
      type: 'worker.run',
      data,
      providerUrl: external.url,
    };
    const first = fixture();
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(${key})::text`;
        first.send(command);
        await vi.waitFor(
          async () => {
            const waiting = await prisma.$queryRaw<
              { waiting: number }[]
            >`SELECT count(*)::int AS waiting FROM pg_locks WHERE locktype = 'advisory' AND objid::bigint = ${BigInt(key)} AND NOT granted`;
            expect(waiting[0]?.waiting).toBeGreaterThan(0);
          },
          { timeout: 15_000, interval: 20 },
        );
        expect(await external.ledger()).toHaveLength(0);
        first.child.kill('SIGKILL');
        expect(await first.exited()).toEqual({ code: null, signal: 'SIGKILL' });
      },
      { timeout: 20_000 },
    );
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER inference_process_before_attempt ON "InferenceAttempt"',
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION inference_process_before_attempt()');
    const reserved = await prisma.inferenceRun.findFirstOrThrow({
      where: { organizationId: data.organizationId, callId: data.callId, generation: 1 },
    });
    expect(reserved.state).toBe('RESERVED');
    expect(
      await prisma.inferenceAttempt.count({ where: { organizationId: data.organizationId } }),
    ).toBe(0);
    await prisma.inferenceRun.updateMany({
      where: { id: reserved.id, organizationId: data.organizationId },
      data: { leaseExpiresAt: new Date(0) },
    });
    const restarted = fixture();
    restarted.send(command);
    expect(await restarted.reply('worker.result')).toMatchObject({
      submissions: 1,
      result: { outcome: 'MANUAL_REVIEW' },
    });
    await restarted.exited();
    expect(await external.ledger()).toHaveLength(1);
    expect(
      await prisma.inferenceRun.count({ where: { organizationId: data.organizationId } }),
    ).toBe(1);
    expect(
      await prisma.inferenceAttempt.count({ where: { organizationId: data.organizationId } }),
    ).toBe(1);
    expect(await prisma.callSummary.count({ where: { organizationId: data.organizationId } })).toBe(
      1,
    );
  }, 25_000);
});
