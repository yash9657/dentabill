import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from '@dentabill/db';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import type {
  ObserverFixtureCommand,
  ObserverFixtureReply,
} from './call-observer-process.fixture.js';

const children: ChildProcess[] = [];
const organizations: string[] = [];
const directories: string[] = [];

function fixture() {
  const child = fork(
    fileURLToPath(new URL('./call-observer-process.fixture.ts', import.meta.url)),
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      execArgv: ['--import', 'tsx'],
      // Deployment credentials/settings cannot enter these synthetic processes.
      env: { NODE_ENV: 'test', DATABASE_URL: process.env.DATABASE_URL, PATH: process.env.PATH },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  );
  children.push(child);
  const replies: ObserverFixtureReply[] = [];
  let stderr = '';
  let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-8_000);
  });
  child.on('message', (reply: ObserverFixtureReply) => {
    replies.push(reply);
  });
  child.on('exit', (code, signal) => {
    exit = { code, signal };
  });
  return {
    child,
    send(message: ObserverFixtureCommand): void {
      child.send(message);
    },
    async reply<T extends ObserverFixtureReply['type']>(
      type: T,
      predicate: (reply: Extract<ObserverFixtureReply, { type: T }>) => boolean = () => true,
    ): Promise<Extract<ObserverFixtureReply, { type: T }>> {
      return vi.waitFor(
        () => {
          const failure = replies.find((reply) => reply.type === 'fixture.failed');
          if (failure) throw new Error(failure.message);
          const found = replies.find(
            (reply): reply is Extract<ObserverFixtureReply, { type: T }> =>
              reply.type === type && predicate(reply as Extract<ObserverFixtureReply, { type: T }>),
          );
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

const ledgerSchema = z.array(
  z.object({
    requestId: z.number().int(),
    action: z.enum(['create', 'get', 'stop']),
    retellCallId: z.string(),
    intentId: z.string(),
  }),
);

async function provider() {
  const directory = await mkdtemp(join(tmpdir(), 'dentabill-observer-process-'));
  directories.push(directory);
  const ledgerPath = join(directory, 'provider-actions.jsonl');
  // The path is generated inside this test's private temporary directory.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(ledgerPath, '', { mode: 0o600 });
  const retellCallId = `call_observer_${randomUUID()}`;
  const child = fixture();
  child.send({ type: 'provider.start', ledgerPath, retellCallId });
  const ready = await child.reply('provider.ready');
  return {
    ...child,
    ...ready,
    retellCallId,
    async actions() {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const ledger = await readFile(ledgerPath, 'utf8');
      return ledgerSchema.parse(
        ledger
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line) as unknown),
      );
    },
    async configure(options: {
      terminal?: boolean;
      holdNextGet?: boolean;
      holdNextStop?: boolean;
    }): Promise<void> {
      const commandId = randomUUID();
      child.send({ type: 'provider.configure', commandId, ...options });
      await child.reply('provider.configured', (reply) => reply.commandId === commandId);
    },
  };
}

async function acceptedCall() {
  const organization = await prisma.organization.create({
    data: {
      name: 'Synthetic Observer Practice',
      clerkOrgId: `synthetic_observer_${randomUUID()}`,
      npi: '1234567890',
    },
  });
  organizations.push(organization.id);
  const claim = await prisma.claim.create({
    data: {
      organizationId: organization.id,
      claimNumber: 'SYNTHETIC-OBSERVER-CLAIM',
      subscriberId: 'SYNTHETIC-OBSERVER-MEMBER',
      patientDOBHash: 'synthetic-no-patient',
      cdtCodes: ['D1110'],
      claimAmount: '100.00',
      payerCode: 'DELTA_DENTAL_PPO',
      serviceDate: new Date('2026-10-01T00:00:00.000Z'),
      status: 'IN_QUEUE',
      priority: 80,
    },
  });
  const data = {
    organizationId: organization.id,
    claimId: claim.id,
    payerCode: claim.payerCode,
    attemptNumber: 1,
    claimPriority: 80,
    idempotencyKey: `observer_${randomUUID()}`,
  };
  const intent = await prisma.callIntent.create({
    data: { ...data, payerCode: claim.payerCode, claimVersion: claim.updatedAt },
  });
  const external = await provider();
  const consumer = fixture();
  consumer.send({ type: 'consumer.run', data, providerOrigin: external.origin });
  expect((await consumer.reply('consumer.complete')).result.outcome).toBe('RESCHEDULED');
  expect(await consumer.exited()).toEqual({ code: 0, signal: null });
  const where = { organizationId: organization.id, id: intent.id };
  const accepted = await prisma.callIntent.findFirstOrThrow({ where });
  expect(accepted).toMatchObject({
    state: 'ACCEPTED',
    callId: expect.any(String),
    stopAttempts: 0,
  });
  expect(accepted.nextObservationAt).toBeInstanceOf(Date);
  expect(accepted.callDeadlineAt).toBeInstanceOf(Date);
  if (
    !accepted.callId ||
    !accepted.submittedAt ||
    !accepted.callDeadlineAt ||
    !accepted.nextObservationAt
  )
    throw new Error('Accepted call lacks durable observation fields.');
  expect(accepted.callDeadlineAt.getTime() - accepted.submittedAt.getTime()).toBe(900_000);
  expect((await external.actions()).filter((action) => action.action === 'create')).toHaveLength(1);
  return { organization, claim, data, accepted, external, where, callId: accepted.callId };
}

type Accepted = Awaited<ReturnType<typeof acceptedCall>>;

function observer(setup: Accepted, now: Date) {
  const child = fixture();
  child.send({
    type: 'observer.run',
    organizationId: setup.organization.id,
    intentId: setup.accepted.id,
    providerOrigin: setup.external.origin,
    now: now.toISOString(),
  });
  return child;
}

async function observe(setup: Accepted, now: Date) {
  const child = observer(setup, now);
  const reply = await child.reply('observer.complete');
  expect(await child.exited()).toEqual({ code: 0, signal: null });
  return reply.result;
}

function after(value: Date | null, offset = 1): Date {
  if (!value) throw new Error('Missing persisted observation timestamp.');
  return new Date(value.getTime() + offset);
}

async function assertNotTerminal(setup: Accepted): Promise<void> {
  expect(await prisma.callIntent.findFirstOrThrow({ where: setup.where })).toMatchObject({
    state: 'ACCEPTED',
    completedAt: null,
    callDeadlineAt: setup.accepted.callDeadlineAt,
  });
  expect(
    await prisma.call.findFirstOrThrow({
      where: { organizationId: setup.organization.id, id: setup.callId },
    }),
  ).toMatchObject({ endedAt: null });
  expect(
    await prisma.callEvent.count({
      where: {
        callId: setup.callId,
        call: { organizationId: setup.organization.id },
        eventType: { in: ['call.ended', 'webhook.call.ended'] },
      },
    }),
  ).toBe(0);
  expect(
    await prisma.jobOutbox.count({
      where: { organizationId: setup.organization.id, kind: 'SUMMARY_GENERATE' },
    }),
  ).toBe(0);
}

async function assertTerminalOnce(setup: Accepted): Promise<void> {
  expect(await prisma.callIntent.findFirstOrThrow({ where: setup.where })).toMatchObject({
    state: 'TERMINAL',
    callDeadlineAt: setup.accepted.callDeadlineAt,
    observationLeaseToken: null,
    observationLeaseExpiresAt: null,
  });
  expect(await prisma.call.count({ where: { organizationId: setup.organization.id } })).toBe(1);
  expect(
    await prisma.call.findFirstOrThrow({
      where: { organizationId: setup.organization.id, id: setup.callId },
    }),
  ).toMatchObject({ status: 'COMPLETED', durationSeconds: 60 });
  expect(
    await prisma.jobOutbox.count({
      where: { organizationId: setup.organization.id, kind: 'SUMMARY_GENERATE' },
    }),
  ).toBe(1);
  expect(
    await prisma.auditLog.count({
      where: {
        organizationId: setup.organization.id,
        action: 'call.end',
        resourceId: setup.callId,
      },
    }),
  ).toBe(1);
  const source = await prisma.callEvent.findMany({
    where: {
      callId: setup.callId,
      call: { organizationId: setup.organization.id },
      eventType: 'call.ended',
    },
  });
  expect(source).toHaveLength(1);
  expect(source[0]?.data).toMatchObject({
    type: 'call.ended',
    retellCallId: setup.external.retellCallId,
    source: 'retell_get_call',
    transcript: { text: 'Synthetic observer final transcript.\n' },
  });
  expect(
    (await setup.external.actions()).filter((action) => action.action === 'create'),
  ).toHaveLength(1);
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

describe('accepted-call observation across operating-system process death', () => {
  it('recovers an expired observation lease through the due sweep without another create', async () => {
    const setup = await acceptedCall();
    await setup.external.configure({ holdNextGet: true });
    const now = after(setup.accepted.nextObservationAt);
    const doomed = observer(setup, now);
    await setup.external.reply('provider.request', (reply) => reply.action === 'get' && reply.held);
    const leased = await prisma.callIntent.findFirstOrThrow({ where: setup.where });
    expect(leased.observationLeaseToken).not.toBeNull();
    expect(leased.observationLeaseExpiresAt).toBeInstanceOf(Date);
    doomed.child.kill('SIGKILL');
    expect(await doomed.exited()).toEqual({ code: null, signal: 'SIGKILL' });
    await assertNotTerminal(setup);

    const before = await setup.external.actions();
    expect((await observe(setup, new Date(now.getTime() + 1))).outcome).toBe('RESCHEDULED');
    expect(await setup.external.actions()).toEqual(before);
    await prisma.claim.updateMany({
      where: { organizationId: setup.organization.id, id: setup.claim.id },
      data: { status: 'MANUAL_REVIEW', subscriberId: null },
    });
    await setup.external.configure({ terminal: true });
    const fresh = fixture();
    fresh.send({
      type: 'sweep.run',
      providerOrigin: setup.external.origin,
      now: after(leased.observationLeaseExpiresAt).toISOString(),
    });
    expect((await fresh.reply('sweep.complete')).result).toMatchObject({
      selected: 1,
      terminal: 1,
      failed: 0,
    });
    expect(await fresh.exited()).toEqual({ code: 0, signal: null });
    await assertTerminalOnce(setup);
    expect(
      await prisma.claim.findFirstOrThrow({
        where: { organizationId: setup.organization.id, id: setup.claim.id },
      }),
    ).toMatchObject({ status: 'MANUAL_REVIEW', subscriberId: null });
    expect(new Set([process.pid, setup.external.pid, doomed.child.pid, fresh.child.pid]).size).toBe(
      4,
    );
  }, 30_000);

  it('persists a Stop attempt before a lost ACK and waits for actual terminal evidence after restart', async () => {
    const setup = await acceptedCall();
    await setup.external.configure({ holdNextStop: true });
    const doomed = observer(setup, after(setup.accepted.callDeadlineAt));
    await setup.external.reply(
      'provider.request',
      (reply) => reply.action === 'stop' && reply.held,
    );
    const pending = await prisma.callIntent.findFirstOrThrow({ where: setup.where });
    expect(pending).toMatchObject({ state: 'ACCEPTED', stopAttempts: 1, stopAcknowledgedAt: null });
    expect(pending.stopRequestedAt).toBeInstanceOf(Date);
    expect(pending.stopConfirmationDeadlineAt).toBeInstanceOf(Date);
    doomed.child.kill('SIGKILL');
    expect(await doomed.exited()).toEqual({ code: null, signal: 'SIGKILL' });
    await assertNotTerminal(setup);

    const retryAt = after(pending.observationLeaseExpiresAt);
    expect((await observe(setup, retryAt)).outcome).toBe('RESCHEDULED');
    const acknowledged = await prisma.callIntent.findFirstOrThrow({ where: setup.where });
    expect(acknowledged).toMatchObject({
      state: 'ACCEPTED',
      stopAttempts: 2,
      stopRequestedAt: pending.stopRequestedAt,
      stopConfirmationDeadlineAt: pending.stopConfirmationDeadlineAt,
    });
    expect(acknowledged.stopAcknowledgedAt).toBeInstanceOf(Date);
    expect(
      (await setup.external.actions()).filter((action) => action.action === 'stop'),
    ).toHaveLength(2);
    await assertNotTerminal(setup);

    expect((await observe(setup, after(acknowledged.stopLastAttemptAt))).outcome).toBe(
      'RESCHEDULED',
    );
    expect(
      (await setup.external.actions()).filter((action) => action.action === 'stop'),
    ).toHaveLength(2);
    await assertNotTerminal(setup);
    await setup.external.configure({ terminal: true });
    const finalAt = after(acknowledged.nextObservationAt);
    expect((await observe(setup, finalAt)).outcome).toBe('COMPLETED');
    await assertTerminalOnce(setup);
    expect(
      (await setup.external.actions()).filter((action) => action.action === 'stop'),
    ).toHaveLength(2);
  }, 30_000);

  it('rejects an old observation response after another process acquires the expired lease and finalizes', async () => {
    const setup = await acceptedCall();
    await setup.external.configure({ holdNextGet: true });
    const old = observer(setup, after(setup.accepted.nextObservationAt));
    const held = await setup.external.reply(
      'provider.request',
      (reply) => reply.action === 'get' && reply.held,
    );
    const leased = await prisma.callIntent.findFirstOrThrow({ where: setup.where });
    await setup.external.configure({ terminal: true });
    const now = after(leased.observationLeaseExpiresAt);
    expect((await observe(setup, now)).outcome).toBe('COMPLETED');
    const finalized = await prisma.callIntent.findFirstOrThrow({ where: setup.where });
    setup.external.send({ type: 'provider.release', requestId: held.requestId });
    await old.reply('observer.complete');
    expect(await old.exited()).toEqual({ code: 0, signal: null });
    expect(await prisma.callIntent.findFirstOrThrow({ where: setup.where })).toEqual(finalized);
    await assertTerminalOnce(setup);
    expect(
      (await setup.external.actions()).filter((action) => action.action === 'stop'),
    ).toHaveLength(0);
  }, 30_000);
});
