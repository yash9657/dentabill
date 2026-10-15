import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from '@dentabill/db';
import { CallJobDataSchema } from '@dentabill/queue';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  ReconciliationFixtureCommand,
  ReconciliationFixtureReply,
  RecoveryDelivery,
} from './call-reconciliation-process.fixture.js';
import { enqueueJobOutbox } from './job-outbox.js';

const children: ChildProcess[] = [];
const organizations: string[] = [];
const directories: string[] = [];

function fixture() {
  const child = fork(
    fileURLToPath(new URL('./call-reconciliation-process.fixture.ts', import.meta.url)),
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      execArgv: ['--import', 'tsx'],
      // Real credentials and deployment settings cannot enter these synthetic processes.
      env: { NODE_ENV: 'test', DATABASE_URL: process.env.DATABASE_URL, PATH: process.env.PATH },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  );
  children.push(child);
  const replies: ReconciliationFixtureReply[] = [];
  let stderr = '';
  let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-8_000);
  });
  child.on('message', (reply: ReconciliationFixtureReply) => {
    replies.push(reply);
  });
  child.on('exit', (code, signal) => {
    exit = { code, signal };
  });
  return {
    child,
    send(message: ReconciliationFixtureCommand): void {
      child.send(message);
    },
    async reply<T extends ReconciliationFixtureReply['type']>(
      type: T,
    ): Promise<Extract<ReconciliationFixtureReply, { type: T }>> {
      return vi.waitFor(
        () => {
          const failure = replies.find((reply) => reply.type === 'fixture.failed');
          if (failure) throw new Error(failure.message);
          const found = replies.find(
            (reply): reply is Extract<ReconciliationFixtureReply, { type: T }> =>
              reply.type === type,
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

async function reserve() {
  const unique = randomUUID();
  const organization = await prisma.organization.create({
    data: {
      name: 'Synthetic Recovery Practice',
      clerkOrgId: `synthetic_recovery_${unique}`,
      npi: '1234567890',
    },
  });
  organizations.push(organization.id);
  const actor = await prisma.user.create({
    data: {
      organizationId: organization.id,
      clerkUserId: `synthetic_recovery_actor_${unique}`,
      email: 'synthetic@example.invalid',
      role: 'OWNER',
    },
  });
  return prisma.$transaction(async (tx) => {
    const claim = await tx.claim.create({
      data: {
        organizationId: organization.id,
        claimNumber: 'SYNTHETIC-RECOVERY-CLAIM',
        subscriberId: 'SYNTHETIC-RECOVERY-MEMBER',
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
      idempotencyKey: `recovery_${unique}`,
    };
    const intent = await tx.callIntent.create({
      data: { ...data, payerCode: claim.payerCode, claimVersion: claim.updatedAt },
    });
    const outbox = await enqueueJobOutbox(tx, {
      organizationId: organization.id,
      kind: 'CALL_PLACE',
      data,
    });
    return { organization, actor, claim, intent, outbox, data };
  });
}

async function readLedger(path: string): Promise<unknown[]> {
  // The parent creates these paths inside a private temporary test directory.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const text = await readFile(path, 'utf8');
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);
}

async function provider() {
  const directory = await mkdtemp(join(tmpdir(), 'dentabill-recovery-process-'));
  directories.push(directory);
  const acceptanceLedgerPath = join(directory, 'provider-acceptances.jsonl');
  const brokerLedgerPath = join(directory, 'broker-acceptances.jsonl');
  const readLedgerPath = join(directory, 'provider-reads.jsonl');
  for (const path of [acceptanceLedgerPath, brokerLedgerPath, readLedgerPath]) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await writeFile(path, '', { mode: 0o600 });
  }
  const retellCallId = `call_recovery_${randomUUID()}`;
  const child = fixture();
  child.send({
    type: 'provider.start',
    acceptanceLedgerPath,
    brokerLedgerPath,
    readLedgerPath,
    retellCallId,
  });
  const ready = await child.reply('provider.ready');
  return {
    ...child,
    ...ready,
    retellCallId,
    acceptances: (): Promise<unknown[]> => readLedger(acceptanceLedgerPath),
    deliveries: (): Promise<unknown[]> => readLedger(brokerLedgerPath),
    reads: (): Promise<unknown[]> => readLedger(readLedgerPath),
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

describe('Positive call reconciliation across operating-system process death', () => {
  it.each([false, true])(
    'recovers a lost provider response without another create (kill after binding: %s)',
    async (killAfterBinding) => {
      const { organization, actor, claim, intent, outbox, data } = await reserve();
      const external = await provider();
      const firstRelay = fixture();
      firstRelay.send({
        type: 'relay.run',
        organizationId: organization.id,
        providerOrigin: external.origin,
        now: new Date().toISOString(),
      });
      expect((await firstRelay.reply('relay.complete')).result).toEqual({
        selected: 1,
        sent: 1,
        failed: 0,
        quarantined: 0,
      });
      expect(await firstRelay.exited()).toEqual({ code: 0, signal: null });
      expect(await external.deliveries()).toEqual([{ kind: 'CALL_PLACE', data }]);
      expect(
        await prisma.jobOutbox.findFirstOrThrow({
          where: { organizationId: organization.id, id: outbox.id },
        }),
      ).toMatchObject({ state: 'DELIVERED' });

      const firstConsumer = fixture();
      firstConsumer.send({ type: 'consumer.run', data, providerOrigin: external.origin });
      expect(await external.reply('provider.accepted')).toMatchObject({ intentId: intent.id });
      const submitting = await prisma.callIntent.findFirstOrThrow({
        where: { organizationId: organization.id, id: intent.id },
      });
      expect(submitting).toMatchObject({ state: 'SUBMITTING', callId: null });
      expect(submitting.requestHash).toMatch(/^[a-f0-9]{64}$/);
      expect(await prisma.call.count({ where: { organizationId: organization.id } })).toBe(0);
      const acceptance = [{ intentId: intent.id, retellCallId: external.retellCallId }];
      expect(await external.acceptances()).toEqual(acceptance);
      firstConsumer.child.kill('SIGKILL');
      expect(await firstConsumer.exited()).toEqual({ code: null, signal: 'SIGKILL' });

      if (killAfterBinding) {
        await prisma.claim.updateMany({
          where: { organizationId: organization.id, id: claim.id },
          data: { status: 'MANUAL_REVIEW', subscriberId: null },
        });
        await prisma.organization.update({ where: { id: organization.id }, data: { npi: null } });
      }
      if (!submitting.submittedAt) throw new Error('Expected persisted submission timestamp.');
      // Advance the core's explicit eligibility clock; no durable intent state is reset.
      const now = new Date(submitting.submittedAt.getTime() + 10 * 60_000).toISOString();
      const restarted = fixture();
      restarted.send({
        type: 'reconciler.run',
        organizationId: organization.id,
        intentId: intent.id,
        clerkUserId: actor.clerkUserId,
        providerOrigin: external.origin,
        now,
      });
      const bound = await restarted.reply('reconciler.bound');
      expect(bound.result).toMatchObject({ outcome: 'RECOVERED', callId: expect.any(String) });
      const recovered = await prisma.callIntent.findFirstOrThrow({
        where: { organizationId: organization.id, id: intent.id },
      });
      expect(recovered).toMatchObject({
        state: 'ACCEPTED',
        callId: bound.result.callId,
        requestPayload: submitting.requestPayload,
        requestHash: submitting.requestHash,
        submittedAt: submitting.submittedAt,
      });
      const calls = await prisma.call.findMany({
        where: { organizationId: organization.id, claimId: claim.id },
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ id: recovered.callId, retellCallId: external.retellCallId });
      const resume = await prisma.jobOutbox.findFirstOrThrow({
        where: {
          organizationId: organization.id,
          kind: 'CALL_PLACE',
          idempotencyKey: `call.resume.${intent.id}`,
        },
      });
      const resumeData = CallJobDataSchema.parse(resume.payload);
      expect(resume).toMatchObject({ state: 'PENDING', deliveredAt: null, deliveryAttempts: 0 });
      expect(resumeData).toEqual({
        ...data,
        idempotencyKey: `call.resume.${intent.id}`,
        resume: { intentId: intent.id, callId: recovered.callId },
      });
      expect(resumeData.idempotencyKey).not.toBe(data.idempotencyKey);
      expect(await external.deliveries()).toEqual([{ kind: 'CALL_PLACE', data }]);
      const terminal = await prisma.callEvent.findFirstOrThrow({
        where: {
          callId: recovered.callId ?? '',
          call: { organizationId: organization.id },
          eventType: 'call.ended',
        },
      });
      expect(terminal.data).toMatchObject({
        type: 'call.ended',
        retellCallId: external.retellCallId,
        source: 'retell_get_call',
        transcript: { text: 'Synthetic recovered final transcript.\n' },
      });
      expect(
        await prisma.auditLog.count({
          where: {
            organizationId: organization.id,
            resourceId: intent.id,
            action: 'call.intent.reconciled',
          },
        }),
      ).toBe(1);
      expect(await external.reads()).toEqual([
        expect.objectContaining({
          method: 'POST',
          path: '/v3/list-calls',
          body: expect.objectContaining({
            filter_criteria: {
              metadata: [
                { key: 'dentabill_intent_id', type: 'string', op: 'eq', value: intent.id },
              ],
            },
          }),
        }),
        { method: 'GET', path: `/v2/get-call/${external.retellCallId}` },
      ]);
      if (killAfterBinding) {
        restarted.child.kill('SIGKILL');
        expect(await restarted.exited()).toEqual({ code: null, signal: 'SIGKILL' });
      } else {
        restarted.send({ type: 'reconciler.exit' });
        expect(await restarted.exited()).toEqual({ code: 0, signal: null });
      }

      const recoveryRelay = fixture();
      recoveryRelay.send({
        type: 'relay.run',
        organizationId: organization.id,
        providerOrigin: external.origin,
        now,
      });
      expect((await recoveryRelay.reply('relay.complete')).result).toEqual({
        selected: 1,
        sent: 1,
        failed: 0,
        quarantined: 0,
      });
      expect(await recoveryRelay.exited()).toEqual({ code: 0, signal: null });
      const deliveries = (await external.deliveries()) as RecoveryDelivery[];
      expect(deliveries).toEqual([
        { kind: 'CALL_PLACE', data },
        { kind: 'CALL_PLACE', data: resumeData },
      ]);
      expect(
        await prisma.jobOutbox.findFirstOrThrow({
          where: { organizationId: organization.id, id: resume.id },
        }),
      ).toMatchObject({ state: 'DELIVERED', deliveryAttempts: 1 });

      for (let delivery = 0; delivery < 2; delivery++) {
        const consumer = fixture();
        consumer.send({ type: 'consumer.run', data: resumeData, providerOrigin: external.origin });
        expect((await consumer.reply('consumer.complete')).result.outcome).toBe(
          delivery === 0 ? 'COMPLETED' : 'ALREADY_PROCESSED',
        );
        expect(await consumer.exited()).toEqual({ code: 0, signal: null });
      }
      expect(
        new Set([
          process.pid,
          external.pid,
          firstConsumer.child.pid,
          restarted.child.pid,
          recoveryRelay.child.pid,
        ]).size,
      ).toBe(5);
      expect(await external.acceptances()).toEqual(acceptance);
      expect(await prisma.call.count({ where: { organizationId: organization.id } })).toBe(1);
      expect(await prisma.callIntent.count({ where: { organizationId: organization.id } })).toBe(1);
      expect(
        await prisma.callIntent.findFirstOrThrow({
          where: { organizationId: organization.id, id: intent.id },
        }),
      ).toMatchObject({ state: 'TERMINAL', callId: recovered.callId });
      expect(
        await prisma.call.findFirstOrThrow({
          where: { organizationId: organization.id, retellCallId: external.retellCallId },
        }),
      ).toMatchObject({ status: 'COMPLETED', durationSeconds: 60 });
      expect(
        await prisma.jobOutbox.count({
          where: { organizationId: organization.id, kind: 'SUMMARY_GENERATE' },
        }),
      ).toBe(1);
      if (killAfterBinding) {
        expect(
          await prisma.claim.findFirstOrThrow({
            where: { organizationId: organization.id, id: claim.id },
          }),
        ).toMatchObject({ status: 'MANUAL_REVIEW', subscriberId: null });
      }
    },
    45_000,
  );
});
