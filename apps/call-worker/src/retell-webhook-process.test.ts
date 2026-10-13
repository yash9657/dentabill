import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { prisma } from '@dentabill/db';
import { selectCallTranscript } from '@dentabill/types';
import { symmetric } from 'retell-sdk/lib/webhook_auth.js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { FixtureCommand, FixtureReply } from './retell-webhook-process.fixture.js';

const children: ChildProcess[] = [];
const organizationIds: string[] = [];
const retellCallIds: string[] = [];

function startFixture() {
  const child = fork(
    fileURLToPath(new URL('./retell-webhook-process.fixture.ts', import.meta.url)),
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      execArgv: ['--import', 'tsx'],
      // Do not inherit real provider keys from the launching shell.
      env: { NODE_ENV: 'test', DATABASE_URL: process.env.DATABASE_URL, PATH: process.env.PATH },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  );
  children.push(child);
  const replies: FixtureReply[] = [];
  let stderr = '';
  let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-8_000);
  });
  child.on('message', (message: FixtureReply) => {
    replies.push(message);
  });
  child.on('exit', (code, signal) => {
    exit = { code, signal };
  });

  return {
    child,
    send(message: FixtureCommand): void {
      child.send(message);
    },
    async reply<T extends FixtureReply['type']>(
      type: T,
    ): Promise<Extract<FixtureReply, { type: T }>> {
      return vi.waitFor(
        () => {
          const failure = replies.find((reply) => reply.type === 'fixture.failed');
          if (failure) throw new Error(failure.message);
          const found = replies.find(
            (reply): reply is Extract<FixtureReply, { type: T }> => reply.type === type,
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
  await prisma.retellWebhookEvent.deleteMany({
    where: { retellCallId: { in: retellCallIds.splice(0) } },
  });
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds.splice(0) } } });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Retell webhook inbox across operating-system processes (synthetic provider)', () => {
  it('survives producer SIGKILL before Call registration, completes the worker through DB, and deduplicates replay', async () => {
    const runId = randomUUID();
    const retellCallId = `call_process_${runId}`;
    retellCallIds.push(retellCallId);
    const org = await prisma.organization.create({
      data: {
        clerkOrgId: `synthetic_process_${runId}`,
        name: 'Synthetic Process Test Practice',
        npi: '1234567890',
      },
    });
    organizationIds.push(org.id);
    const claim = await prisma.claim.create({
      data: {
        organizationId: org.id,
        claimNumber: 'SYNTHETIC-PROCESS-CLAIM',
        subscriberId: 'SYNTHETIC-PROCESS-MEMBER',
        patientDOBHash: 'synthetic-test-hash-no-patient',
        cdtCodes: ['D1110'],
        claimAmount: '100.00',
        payerCode: 'DELTA_DENTAL_PPO',
        serviceDate: new Date('2026-10-01T00:00:00.000Z'),
        status: 'IN_QUEUE',
        priority: 80,
      },
    });
    const worker = startFixture();
    worker.send({ type: 'worker.start', organizationId: org.id, claimId: claim.id, retellCallId });
    const barrier = await worker.reply('worker.barrier');
    expect(barrier.pid).not.toBe(process.pid);
    expect(await prisma.call.count({ where: { organizationId: org.id } })).toBe(0);

    const transcript = 'Agent: Synthetic status request.\nUser: Synthetic payer response.\n';
    const rawBody = JSON.stringify({
      event: 'call_ended',
      call: {
        call_id: retellCallId,
        direction: 'outbound',
        call_status: 'ended',
        start_timestamp: Date.UTC(2026, 9, 13, 12),
        end_timestamp: Date.UTC(2026, 9, 13, 12, 1),
        duration_ms: 60_000,
        disconnection_reason: 'agent_hangup',
        transcript,
        transcript_object: [
          { role: 'agent', content: 'Synthetic status request.', words: [{ start: 0 }] },
          { role: 'user', content: 'Synthetic payer response.', words: [{ start: 3 }] },
        ],
      },
    });
    const secret = 'synthetic-process-webhook-signing-key';
    const signedDelivery: FixtureCommand = {
      type: 'webhook.accept',
      rawBody,
      secret,
      signature: await symmetric.sign(rawBody, secret, Date.now()),
    };
    const producer = startFixture();
    producer.send(signedDelivery);
    const accepted = await producer.reply('producer.accepted');
    expect(accepted).toMatchObject({ pending: true, replayed: false, eventCount: 0 });
    expect(accepted.pid).not.toBe(barrier.pid);
    expect(accepted.pid).not.toBe(process.pid);
    producer.child.kill('SIGKILL');
    expect(await producer.exited()).toEqual({ code: null, signal: 'SIGKILL' });

    const pending = await prisma.retellWebhookEvent.findMany({ where: { retellCallId } });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ processedAt: null, organizationId: null });
    expect(pending[0]?.payload).toMatchObject({
      event: { type: 'call.ended', transcript: { text: transcript } },
    });
    expect(await prisma.call.count({ where: { organizationId: org.id } })).toBe(0);

    worker.send({ type: 'worker.release' });
    const completed = await worker.reply('worker.complete');
    expect(completed).toMatchObject({
      outcome: 'COMPLETED',
      durationSeconds: 60,
      startCount: 1,
      subscribeCount: 1,
      unsubscribeCount: 1,
    });
    expect(await worker.exited()).toEqual({ code: 0, signal: null });

    const calls = await prisma.call.findMany({ where: { organizationId: org.id } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      id: completed.callId,
      claimId: claim.id,
      retellCallId,
      status: 'COMPLETED',
      durationSeconds: 60,
      endedAt: new Date('2026-10-13T12:01:00.000Z'),
    });
    const claimAfter = await prisma.claim.findUniqueOrThrow({ where: { id: claim.id } });
    expect(claimAfter.status).toBe('COMPLETED');
    const events = await prisma.callEvent.findMany({ where: { callId: completed.callId } });
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('webhook.call.ended');
    const selected = selectCallTranscript(events);
    expect(selected).toMatchObject({ kind: 'final', rawText: transcript });
    expect(selected.turns.map(({ role, text }) => ({ role, text }))).toEqual([
      { role: 'agent', text: 'Synthetic status request.' },
      { role: 'remote', text: 'Synthetic payer response.' },
    ]);
    const processed = await prisma.retellWebhookEvent.findMany({ where: { retellCallId } });
    expect(processed).toHaveLength(1);
    expect(processed[0]).toMatchObject({ organizationId: org.id, payload: null });
    expect(processed[0]?.processedAt).toBeInstanceOf(Date);
    const audits = await prisma.auditLog.findMany({
      where: { organizationId: org.id },
      orderBy: { id: 'asc' },
    });
    expect(audits.filter(({ action }) => action === 'call.webhook.accepted')).toHaveLength(1);
    // Call has no updatedAt; xmin detects even a same-value duplicate UPDATE.
    const callVersion = await prisma.$queryRaw<{ version: string }[]>`
        SELECT xmin::text AS version FROM "Call"
        WHERE id = ${completed.callId} AND "organizationId" = ${org.id}
      `;

    // A restarted producer replays the same signed body after the worker has exited.
    const restartedProducer = startFixture();
    restartedProducer.send(signedDelivery);
    expect(await restartedProducer.reply('producer.accepted')).toMatchObject({
      pending: false,
      replayed: true,
      eventCount: 0,
    });
    restartedProducer.send({ type: 'producer.exit' });
    expect(await restartedProducer.exited()).toEqual({ code: 0, signal: null });
    expect(await prisma.call.findMany({ where: { organizationId: org.id } })).toEqual(calls);
    expect(
      await prisma.$queryRaw<{ version: string }[]>`
        SELECT xmin::text AS version FROM "Call"
        WHERE id = ${completed.callId} AND "organizationId" = ${org.id}
      `,
    ).toEqual(callVersion);
    expect(await prisma.claim.findUniqueOrThrow({ where: { id: claim.id } })).toEqual(claimAfter);
    expect(await prisma.callEvent.findMany({ where: { callId: completed.callId } })).toEqual(
      events,
    );
    expect(await prisma.retellWebhookEvent.findMany({ where: { retellCallId } })).toEqual(
      processed,
    );
    expect(
      await prisma.auditLog.findMany({ where: { organizationId: org.id }, orderBy: { id: 'asc' } }),
    ).toEqual(audits);
  }, 30_000);
});
