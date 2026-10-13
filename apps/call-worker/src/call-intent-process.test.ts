import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from '@dentabill/db';
import {
  acceptRetellWebhook,
  parseRetellWebhookEnvelope,
  verifyRetellWebhookSignature,
} from '@dentabill/payer-ivr';
import { symmetric } from 'retell-sdk/lib/webhook_auth.js';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { IntentFixtureCommand, IntentFixtureReply } from './call-intent-process.fixture.js';

const children: ChildProcess[] = [];
const organizations: string[] = [];
const retellIds: string[] = [];
const directories: string[] = [];

function fixture() {
  const child = fork(fileURLToPath(new URL('./call-intent-process.fixture.ts', import.meta.url)), {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    execArgv: ['--import', 'tsx'],
    env: { NODE_ENV: 'test', DATABASE_URL: process.env.DATABASE_URL, PATH: process.env.PATH },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  children.push(child);
  const replies: IntentFixtureReply[] = [];
  let stderr = '';
  let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-8_000);
  });
  child.on('message', (reply: IntentFixtureReply) => {
    replies.push(reply);
  });
  child.on('exit', (code, signal) => {
    exit = { code, signal };
  });
  return {
    child,
    send(message: IntentFixtureCommand): void {
      child.send(message);
    },
    async reply<T extends IntentFixtureReply['type']>(
      type: T,
    ): Promise<Extract<IntentFixtureReply, { type: T }>> {
      return vi.waitFor(
        () => {
          const failure = replies.find((reply) => reply.type === 'fixture.failed');
          if (failure) throw new Error(failure.message);
          const found = replies.find(
            (reply): reply is Extract<IntentFixtureReply, { type: T }> => reply.type === type,
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

async function reserveIntent() {
  const unique = randomUUID();
  const organization = await prisma.organization.create({
    data: {
      clerkOrgId: `synthetic_intent_${unique}`,
      name: 'Synthetic Intent Test Practice',
      npi: '1234567890',
    },
  });
  organizations.push(organization.id);
  const claim = await prisma.claim.create({
    data: {
      organizationId: organization.id,
      claimNumber: 'SYNTHETIC-INTENT-CLAIM',
      subscriberId: 'SYNTHETIC-INTENT-MEMBER',
      patientDOBHash: 'synthetic-no-patient',
      cdtCodes: ['D1110'],
      claimAmount: '100.00',
      payerCode: 'DELTA_DENTAL_PPO',
      serviceDate: new Date('2026-10-01T00:00:00.000Z'),
      status: 'IN_QUEUE',
      priority: 80,
    },
  });
  const intent = await prisma.callIntent.create({
    data: {
      organizationId: organization.id,
      claimId: claim.id,
      idempotencyKey: `queue_${unique}`,
      payerCode: claim.payerCode,
      attemptNumber: 1,
      claimPriority: 80,
      claimVersion: claim.updatedAt,
      state: 'READY',
    },
  });
  return { organization, claim, intent };
}

async function provider(response: 'hold' | 'accept') {
  const directory = await mkdtemp(join(tmpdir(), 'dentabill-intent-process-'));
  directories.push(directory);
  const ledgerPath = join(directory, 'provider-acceptances.jsonl');
  // Paths are generated inside this test's private temporary directory.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(ledgerPath, '', { mode: 0o600 });
  const retellCallId = `call_external_${randomUUID()}`;
  retellIds.push(retellCallId);
  const processFixture = fixture();
  processFixture.send({ type: 'provider.start', response, ledgerPath, retellCallId });
  const ready = await processFixture.reply('provider.ready');
  return {
    ...processFixture,
    url: ready.url,
    pid: ready.pid,
    retellCallId,
    async ledger(): Promise<unknown[]> {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const text = await readFile(ledgerPath, 'utf8');
      return text
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as unknown);
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
    where: { retellCallId: { in: retellIds.splice(0) } },
  });
  for (const organizationId of organizations.splice(0)) {
    await prisma.callIntent.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('Durable call intents across process death (synthetic external provider)', () => {
  it('never reissues create after provider acceptance and worker SIGKILL before the response', async () => {
    const { organization, claim, intent } = await reserveIntent();
    const external = await provider('hold');
    const command: IntentFixtureCommand = {
      type: 'worker.run',
      organizationId: organization.id,
      claimId: claim.id,
      queueKey: intent.idempotencyKey,
      providerUrl: external.url,
    };
    const first = fixture();
    first.send(command);
    expect(await external.reply('provider.accepted')).toMatchObject({ intentId: intent.id });
    expect(external.pid).not.toBe(first.child.pid);
    expect(external.pid).not.toBe(process.pid);
    const submitting = await prisma.callIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(submitting).toMatchObject({ state: 'SUBMITTING', callId: null, completedAt: null });
    expect(submitting.submittedAt).toBeInstanceOf(Date);
    expect(submitting.requestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(submitting.requestPayload).toMatchObject({ idempotencyKey: intent.id });
    expect(await prisma.call.count({ where: { organizationId: organization.id } })).toBe(0);
    const accepted = [{ intentId: intent.id, retellCallId: external.retellCallId }];
    expect(await external.ledger()).toEqual(accepted);
    first.child.kill('SIGKILL');
    expect(await first.exited()).toEqual({ code: null, signal: 'SIGKILL' });

    // Repeated fresh processes must not reset the unresolved submission marker.
    for (let attempt = 0; attempt < 2; attempt++) {
      const restarted = fixture();
      restarted.send(command);
      const recovered = await restarted.reply('worker.result');
      expect(recovered).toMatchObject({
        startCount: 0,
        result: {
          outcome: 'RECONCILIATION_REQUIRED',
          callId: null,
          retellCallId: null,
          durationSeconds: null,
        },
      });
      expect(await restarted.exited()).toEqual({ code: 0, signal: null });
      const unresolved = await prisma.callIntent.findUniqueOrThrow({ where: { id: intent.id } });
      expect(['SUBMITTING', 'UNKNOWN']).toContain(unresolved.state);
      expect(unresolved).toMatchObject({
        callId: null,
        completedAt: null,
        submittedAt: submitting.submittedAt,
        requestHash: submitting.requestHash,
        requestPayload: submitting.requestPayload,
      });
      expect(await external.ledger()).toEqual(accepted);
      expect(await prisma.call.count({ where: { organizationId: organization.id } })).toBe(0);
    }
    expect(
      await prisma.callIntent.count({
        where: { organizationId: organization.id, claimId: claim.id },
      }),
    ).toBe(1);
  }, 30_000);

  it('resumes an accepted call after worker SIGKILL and a durable ended event without another create', async () => {
    const { organization, claim, intent } = await reserveIntent();
    const external = await provider('accept');
    const command: IntentFixtureCommand = {
      type: 'worker.run',
      organizationId: organization.id,
      claimId: claim.id,
      queueKey: intent.idempotencyKey,
      providerUrl: external.url,
    };
    const first = fixture();
    first.send(command);
    await first.reply('worker.waiting');
    const acceptedIntent = await prisma.callIntent.findUniqueOrThrow({ where: { id: intent.id } });
    expect(acceptedIntent.state).toBe('ACCEPTED');
    expect(acceptedIntent.callId).not.toBeNull();
    const calls = await prisma.call.findMany({ where: { organizationId: organization.id } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      id: acceptedIntent.callId,
      retellCallId: external.retellCallId,
    });
    const ledger = [{ intentId: intent.id, retellCallId: external.retellCallId }];
    expect(await external.ledger()).toEqual(ledger);
    first.child.kill('SIGKILL');
    expect(await first.exited()).toEqual({ code: null, signal: 'SIGKILL' });

    // A newer operator edit invalidates dial identity, but the accepted call still
    // needs finalization. Recovery must resume it and preserve the operator's state.
    await prisma.claim.updateMany({
      where: { id: claim.id, organizationId: organization.id },
      data: { subscriberId: null, status: 'MANUAL_REVIEW' },
    });
    await prisma.organization.update({ where: { id: organization.id }, data: { npi: null } });

    const rawBody = JSON.stringify({
      event: 'call_ended',
      call: {
        call_id: external.retellCallId,
        direction: 'outbound',
        call_status: 'ended',
        start_timestamp: Date.UTC(2026, 9, 13, 12),
        end_timestamp: Date.UTC(2026, 9, 13, 12, 1),
        duration_ms: 60_000,
        disconnection_reason: 'agent_hangup',
        transcript: 'Synthetic completed call.\n',
      },
    });
    const secret = 'synthetic-intent-process-signing-key';
    const signature = await symmetric.sign(rawBody, secret, Date.now());
    expect(verifyRetellWebhookSignature({ rawBody, secret, signature })).toBe(true);
    expect(await acceptRetellWebhook(prisma, parseRetellWebhookEnvelope(rawBody))).toMatchObject({
      pending: false,
      replayed: false,
    });

    const restarted = fixture();
    restarted.send(command);
    expect(await restarted.reply('worker.result')).toMatchObject({
      startCount: 0,
      result: {
        callId: acceptedIntent.callId,
        retellCallId: external.retellCallId,
        outcome: 'COMPLETED',
        durationSeconds: 60,
      },
    });
    expect(await restarted.exited()).toEqual({ code: 0, signal: null });
    expect(await external.ledger()).toEqual(ledger);
    expect(await prisma.call.count({ where: { organizationId: organization.id } })).toBe(1);
    expect(await prisma.callIntent.findUniqueOrThrow({ where: { id: intent.id } })).toMatchObject({
      state: 'TERMINAL',
      callId: acceptedIntent.callId,
    });
    expect(
      await prisma.call.findUniqueOrThrow({ where: { retellCallId: external.retellCallId } }),
    ).toMatchObject({
      status: 'COMPLETED',
      endedAt: new Date('2026-10-13T12:01:00.000Z'),
      durationSeconds: 60,
    });
    expect(await prisma.claim.findUniqueOrThrow({ where: { id: claim.id } })).toMatchObject({
      status: 'MANUAL_REVIEW',
      subscriberId: null,
    });
    expect(
      await prisma.auditLog.count({
        where: {
          organizationId: organization.id,
          resourceId: acceptedIntent.callId!,
          action: 'call.start',
        },
      }),
    ).toBe(1);
    expect(
      await prisma.auditLog.count({
        where: {
          organizationId: organization.id,
          resourceId: acceptedIntent.callId!,
          action: 'call.end',
        },
      }),
    ).toBe(1);
    expect(
      await prisma.callEvent.count({
        where: { callId: acceptedIntent.callId!, eventType: 'webhook.call.ended' },
      }),
    ).toBe(1);
  }, 30_000);
});
