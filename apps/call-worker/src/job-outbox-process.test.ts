import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from '@dentabill/db';
import type { CallJobData } from '@dentabill/queue';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  BrokerDelivery,
  OutboxFixtureCommand,
  OutboxFixtureReply,
} from './job-outbox-process.fixture.js';

const children: ChildProcess[] = [];
const organizations: string[] = [];
const directories: string[] = [];

function fixture() {
  const child = fork(fileURLToPath(new URL('./job-outbox-process.fixture.ts', import.meta.url)), {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    execArgv: ['--import', 'tsx'],
    // No provider, broker, or cloud credentials enter child processes.
    env: { NODE_ENV: 'test', DATABASE_URL: process.env.DATABASE_URL, PATH: process.env.PATH },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  children.push(child);
  const replies: OutboxFixtureReply[] = [];
  let stderr = '';
  let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-8_000);
  });
  child.on('message', (reply: OutboxFixtureReply) => {
    replies.push(reply);
  });
  child.on('exit', (code, signal) => {
    exit = { code, signal };
  });
  return {
    child,
    send(message: OutboxFixtureCommand): void {
      child.send(message);
    },
    async reply<T extends OutboxFixtureReply['type']>(
      type: T,
      occurrence = 0,
    ): Promise<Extract<OutboxFixtureReply, { type: T }>> {
      return vi.waitFor(
        () => {
          const failure = replies.find((reply) => reply.type === 'fixture.failed');
          if (failure) throw new Error(failure.message);
          const found = replies.filter(
            (reply): reply is Extract<OutboxFixtureReply, { type: T }> => reply.type === type,
          )[occurrence];
          if (!found)
            throw new Error(`Waiting for ${type}; exit=${JSON.stringify(exit)} ${stderr}`);
          return found;
        },
        { timeout: 15_000, interval: 20 },
      );
    },
    async exited(): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
      return vi.waitFor(
        () => {
          if (!exit) throw new Error(`Fixture did not exit: ${stderr}`);
          return exit;
        },
        { timeout: 5_000, interval: 20 },
      );
    },
  };
}

async function prepare(): Promise<CallJobData> {
  const unique = randomUUID();
  const org = await prisma.organization.create({
    data: {
      clerkOrgId: `synthetic_outbox_${unique}`,
      name: 'Synthetic Outbox Test Practice',
      npi: '1234567890',
    },
  });
  organizations.push(org.id);
  const claim = await prisma.claim.create({
    data: {
      organizationId: org.id,
      claimNumber: 'SYNTHETIC-OUTBOX-CLAIM',
      subscriberId: 'SYNTHETIC-OUTBOX-MEMBER',
      patientDOBHash: 'synthetic-no-patient',
      cdtCodes: ['D1110'],
      claimAmount: '100.00',
      payerCode: 'DELTA_DENTAL_PPO',
      serviceDate: new Date('2026-10-01T00:00:00.000Z'),
      status: 'PENDING',
      priority: 80,
    },
  });
  return {
    organizationId: org.id,
    claimId: claim.id,
    payerCode: claim.payerCode,
    attemptNumber: 1,
    claimPriority: 80,
    idempotencyKey: `outbox_${unique}`,
  };
}

async function ledgerRows(path: string): Promise<unknown[]> {
  // The fixture paths belong to this test's private synthetic-only directory.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const text = await readFile(path, 'utf8');
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

async function broker(response: 'hold' | 'accept') {
  const directory = await mkdtemp(join(tmpdir(), 'dentabill-outbox-process-'));
  directories.push(directory);
  const ledgerPath = join(directory, 'broker-acceptances.jsonl');
  const actionLedgerPath = join(directory, 'provider-actions.jsonl');
  for (const path of [ledgerPath, actionLedgerPath]) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await writeFile(path, '', { mode: 0o600 });
  }
  const retellCallId = `call_outbox_${randomUUID()}`;
  const processFixture = fixture();
  processFixture.send({
    type: 'broker.start',
    response,
    ledgerPath,
    actionLedgerPath,
    retellCallId,
  });
  const ready = await processFixture.reply('broker.ready');
  return {
    ...processFixture,
    ...ready,
    retellCallId,
    ledger: (): Promise<unknown[]> => ledgerRows(ledgerPath),
    actions: (): Promise<unknown[]> => ledgerRows(actionLedgerPath),
  };
}

async function committedProducer(data: CallJobData) {
  const producer = fixture();
  producer.send({ type: 'producer.commit', data });
  const result = await producer.reply('producer.committed');
  expect(result.pid).not.toBe(process.pid);
  producer.child.kill('SIGKILL');
  expect(await producer.exited()).toEqual({ code: null, signal: 'SIGKILL' });
  return result;
}

beforeAll(async () => {
  await prisma.$connect();
});
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise<void>((resolve) => {
        child.once('exit', () => {
          resolve();
        });
      });
      child.kill('SIGKILL');
      await exited;
    }
  }
  for (const organizationId of organizations.splice(0)) {
    await prisma.callIntent.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('Job outbox recovery across operating-system process death (synthetic broker)', () => {
  it('delivers a committed call intent after its producer dies before any dispatch', async () => {
    const data = await prepare();
    const external = await broker('accept');
    const committed = await committedProducer(data);
    expect(committed.pid).not.toBe(external.pid);
    expect(await external.ledger()).toEqual([]);
    const pending = await prisma.jobOutbox.findUniqueOrThrow({ where: { id: committed.outboxId } });
    expect(pending).toMatchObject({
      organizationId: data.organizationId,
      kind: 'CALL_PLACE',
      idempotencyKey: data.idempotencyKey,
      payload: data,
      state: 'PENDING',
      deliveryAttempts: 0,
      leaseToken: null,
      leaseExpiresAt: null,
      deliveredAt: null,
    });
    expect(pending.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await prisma.callIntent.findUniqueOrThrow({ where: { id: committed.intentId } }),
    ).toMatchObject({
      state: 'READY',
      idempotencyKey: data.idempotencyKey,
      claimId: data.claimId,
    });

    const relay = fixture();
    relay.send({ type: 'relay.run', organizationId: data.organizationId, brokerUrl: external.url });
    const result = await relay.reply('relay.complete');
    expect(new Set([process.pid, external.pid, committed.pid, result.pid]).size).toBe(4);
    expect(result.result).toMatchObject({ selected: 1, sent: 1, failed: 0, quarantined: 0 });
    expect(await relay.exited()).toEqual({ code: 0, signal: null });
    expect(await external.ledger()).toEqual([
      expect.objectContaining({ kind: 'CALL_PLACE', data }),
    ]);
    expect(
      await prisma.jobOutbox.findUniqueOrThrow({ where: { id: committed.outboxId } }),
    ).toMatchObject({
      state: 'DELIVERED',
      deliveryAttempts: 1,
      payload: data,
      payloadHash: pending.payloadHash,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    expect(await external.actions()).toEqual([]);
  }, 30_000);

  it('replays a broker-accepted job after relay SIGKILL; duplicate consumers create one physical call', async () => {
    const data = await prepare();
    const external = await broker('hold');
    const committed = await committedProducer(data);
    const firstRelay = fixture();
    firstRelay.send({
      type: 'relay.run',
      organizationId: data.organizationId,
      brokerUrl: external.url,
    });
    const accepted = await external.reply('broker.accepted');
    expect(accepted).toMatchObject({ idempotencyKey: data.idempotencyKey, sequence: 1 });
    expect(external.pid).not.toBe(firstRelay.child.pid);
    const leased = await prisma.jobOutbox.findUniqueOrThrow({ where: { id: committed.outboxId } });
    expect(leased).toMatchObject({
      state: 'PENDING',
      deliveredAt: null,
      deliveryAttempts: 1,
      payload: data,
    });
    expect(leased.leaseToken).toEqual(expect.any(String));
    expect(leased.leaseExpiresAt).toBeInstanceOf(Date);
    expect(await external.ledger()).toEqual([
      expect.objectContaining({ kind: 'CALL_PLACE', data }),
    ]);
    firstRelay.child.kill('SIGKILL');
    expect(await firstRelay.exited()).toEqual({ code: null, signal: 'SIGKILL' });

    // Broker acceptance already happened: consume that first durable delivery
    // before recovering the relay, so duplicate delivery faces committed effects.
    const firstConsumer = fixture();
    firstConsumer.send({ type: 'consumer.run', data, providerUrl: external.providerUrl });
    const consumed = await firstConsumer.reply('consumer.complete');
    expect(consumed).toMatchObject({ startCount: 1, result: { outcome: 'COMPLETED' } });
    expect(await firstConsumer.exited()).toEqual({ code: 0, signal: null });
    const actions = [{ intentId: committed.intentId, retellCallId: external.retellCallId }];
    expect(await external.actions()).toEqual(actions);
    expect(
      await prisma.callIntent.findUniqueOrThrow({ where: { id: committed.intentId } }),
    ).toMatchObject({ state: 'TERMINAL' });

    external.send({ type: 'broker.accept-responses' });
    await external.reply('broker.responses-enabled');
    if (leased.leaseExpiresAt === null) throw new Error('Expected durable delivery lease.');
    // Explicitly move the relay's database-comparison clock past the durable lease.
    // No sleep, process-local lease mutation, or row reset grants delivery ownership.
    const recoveredAt = new Date(leased.leaseExpiresAt.getTime() + 1);
    const restartedRelay = fixture();
    restartedRelay.send({
      type: 'relay.run',
      organizationId: data.organizationId,
      brokerUrl: external.url,
      now: recoveredAt.toISOString(),
    });
    const replayed = await restartedRelay.reply('relay.complete');
    expect(replayed.result).toMatchObject({ selected: 1, sent: 1, failed: 0, quarantined: 0 });
    expect(replayed.pid).not.toBe(firstRelay.child.pid);
    expect(await restartedRelay.exited()).toEqual({ code: 0, signal: null });
    await external.reply('broker.accepted', 1);
    const deliveries = (await external.ledger()) as BrokerDelivery[];
    expect(deliveries).toHaveLength(2);
    expect(deliveries[1]).toEqual(deliveries[0]);
    expect(deliveries[1]).toMatchObject({ kind: 'CALL_PLACE', data });
    const delivered = await prisma.jobOutbox.findUniqueOrThrow({
      where: { id: committed.outboxId },
    });
    expect(delivered).toMatchObject({
      state: 'DELIVERED',
      deliveryAttempts: 2,
      payload: data,
      payloadHash: leased.payloadHash,
      leaseToken: null,
      leaseExpiresAt: null,
    });
    expect(delivered.deliveredAt).toBeInstanceOf(Date);

    const duplicate = deliveries[1];
    if (duplicate?.kind !== 'CALL_PLACE') throw new Error('Expected replayed call delivery.');
    const secondConsumer = fixture();
    secondConsumer.send({
      type: 'consumer.run',
      data: duplicate.data,
      providerUrl: external.providerUrl,
    });
    expect(await secondConsumer.reply('consumer.complete')).toMatchObject({
      startCount: 0,
      result: { outcome: 'ALREADY_PROCESSED' },
    });
    expect(await secondConsumer.exited()).toEqual({ code: 0, signal: null });
    expect(await external.actions()).toEqual(actions);
    expect(
      await prisma.call.count({
        where: { organizationId: data.organizationId, claimId: data.claimId },
      }),
    ).toBe(1);
    expect(
      await prisma.callIntent.count({
        where: { organizationId: data.organizationId, claimId: data.claimId },
      }),
    ).toBe(1);
  }, 30_000);
});
