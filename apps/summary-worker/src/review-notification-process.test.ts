import { fork, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { prisma } from '@dentabill/db';
import {
  ReviewNotificationTransportError,
  SyntheticReviewNotificationTransport,
  type ReviewNotificationTransport,
} from '@dentabill/notifier';
import type { SummaryJobData } from '@dentabill/queue';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { dispatchReviewNotification } from './review-notification-dispatch.js';
import type {
  NotificationFixtureCommand,
  NotificationFixtureReply,
} from './review-notification-process.fixture.js';

const children: ChildProcess[] = [];
const directories: string[] = [];

function fixture() {
  const child = fork(
    fileURLToPath(new URL('./review-notification-process.fixture.ts', import.meta.url)),
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      execArgv: ['--import', 'tsx'],
      env: { NODE_ENV: 'test', DATABASE_URL: process.env.DATABASE_URL, PATH: process.env.PATH },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    },
  );
  children.push(child);
  const replies: NotificationFixtureReply[] = [];
  let exit: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  child.stderr?.resume();
  child.on('message', (reply: NotificationFixtureReply) => {
    replies.push(reply);
  });
  child.on('exit', (code, signal) => {
    exit = { code, signal };
  });
  return {
    child,
    send(command: NotificationFixtureCommand): void {
      child.send(command);
    },
    async reply<T extends NotificationFixtureReply['type']>(
      type: T,
    ): Promise<Extract<NotificationFixtureReply, { type: T }>> {
      return vi.waitFor(
        () => {
          const failure = replies.find((reply) => reply.type === 'fixture.failed');
          if (failure) throw new Error(failure.message);
          const found = replies.find(
            (reply): reply is Extract<NotificationFixtureReply, { type: T }> => reply.type === type,
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
    async kill(): Promise<void> {
      if (exit) return;
      child.kill('SIGKILL');
      expect(await this.exited()).toEqual({ code: null, signal: 'SIGKILL' });
    },
  };
}

async function ledger() {
  const directory = await mkdtemp(join(tmpdir(), 'dentabill-notification-process-'));
  directories.push(directory);
  const path = join(directory, 'synthetic-acceptances.jsonl');
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  await writeFile(path, '', { mode: 0o600 });
  return {
    path,
    async read(): Promise<
      {
        input: { idempotencyKey: string; payloadHash: string; payload: unknown };
        receipt: unknown;
      }[]
    > {
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const content = await readFile(path, 'utf8');
      return content
        .split('\n')
        .filter(Boolean)
        .map(
          (line) =>
            JSON.parse(line) as {
              input: { idempotencyKey: string; payloadHash: string; payload: unknown };
              receipt: unknown;
            },
        );
    },
  };
}

async function seed(): Promise<SummaryJobData> {
  const unique = randomUUID();
  const org = await prisma.organization.create({
    data: { name: 'Synthetic notification practice', clerkOrgId: `notification-${unique}` },
  });
  await prisma.user.create({
    data: {
      organizationId: org.id,
      clerkUserId: `notification-user-${unique}`,
      email: 'synthetic@example.test',
      role: 'OWNER',
    },
  });
  const claim = await prisma.claim.create({
    data: {
      organizationId: org.id,
      claimNumber: 'PRIVATE-SOURCE-MARKER',
      patientDOBHash: 'synthetic',
      payerCode: 'DELTA_DENTAL_PPO',
      serviceDate: new Date('2026-10-01'),
      claimAmount: '100.00',
      status: 'COMPLETED',
    },
  });
  const call = await prisma.call.create({
    data: {
      organizationId: org.id,
      claimId: claim.id,
      retellCallId: `notification-call-${unique}`,
      status: 'COMPLETED',
      endedAt: new Date(),
    },
  });
  await prisma.callEvent.create({
    data: {
      callId: call.id,
      eventType: 'call.transcript',
      data: { role: 'representative', text: 'PRIVATE-SOURCE-MARKER needs review.' },
    },
  });
  return {
    organizationId: org.id,
    callId: call.id,
    promptVersion: 'v1',
    idempotencyKey: `notification-job-${unique}`,
  };
}

async function produce() {
  const data = await seed();
  const process = fixture();
  process.send({ type: 'producer.run', data });
  const committed = await process.reply('producer.committed');
  await process.kill();
  const intent = await prisma.reviewNotificationIntent.findFirstOrThrow({
    where: { id: committed.notificationId, organizationId: data.organizationId },
    include: { delivery: true },
  });
  expect(intent.delivery?.state).toBe('PENDING');
  expect(await prisma.callSummary.count({ where: { organizationId: data.organizationId } })).toBe(
    1,
  );
  return { data, intent };
}

async function provider(ledgerPath: string, hold: boolean, now: Date) {
  const process = fixture();
  process.send({ type: 'provider.start', ledgerPath, hold, now: now.toISOString() });
  return { ...process, ...(await process.reply('provider.ready')) };
}

beforeAll(async () => {
  await prisma.$connect();
});
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const ended = new Promise<void>((resolve) => {
        child.once('exit', () => {
          resolve();
        });
      });
      child.kill('SIGKILL');
      await ended;
    }
  }
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS notification_dispatch_fail_audit ON "AuditLog"',
  );
  await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS notification_dispatch_fail_audit()');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "Organization" RESTART IDENTITY CASCADE');
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('review notification recovery across process death', () => {
  it('recovers committed intent and reuses the exact key after persistent acceptance and both process restarts', async () => {
    const { data, intent } = await produce();
    const saved = await ledger();
    const now = new Date();
    const firstProvider = await provider(saved.path, true, now);
    const command: NotificationFixtureCommand = {
      type: 'dispatcher.run',
      organizationId: data.organizationId,
      notificationId: intent.id,
      providerUrl: firstProvider.url,
      now: now.toISOString(),
    };
    const first = fixture();
    first.send(command);
    expect(await firstProvider.reply('provider.accepted')).toMatchObject({ replayed: false });
    expect(firstProvider.pid).not.toBe(first.child.pid);
    await first.kill();
    await firstProvider.kill();
    expect(
      await prisma.reviewNotificationReceipt.count({
        where: { organizationId: data.organizationId },
      }),
    ).toBe(0);
    const restartedProvider = await provider(saved.path, false, now);
    const restarted = fixture();
    restarted.send({
      ...command,
      providerUrl: restartedProvider.url,
      now: new Date(now.getTime() + 61_000).toISOString(),
    });
    expect(await restarted.reply('dispatcher.result')).toMatchObject({
      submissions: 1,
      result: { kind: 'RECORDED', state: 'SIMULATED' },
    });
    expect(await restartedProvider.reply('provider.accepted')).toMatchObject({ replayed: true });
    await restarted.exited();
    const rows = await saved.read();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.input).toMatchObject({
      idempotencyKey: intent.deliveryKey,
      payloadHash: intent.payloadHash,
    });
    expect(JSON.stringify(rows)).not.toContain('PRIVATE-SOURCE-MARKER');
    const attempts = await prisma.reviewNotificationAttempt.findMany({
      where: { organizationId: data.organizationId },
      orderBy: { attemptNumber: 'asc' },
    });
    expect(attempts).toHaveLength(2);
    expect(attempts.map((attempt) => attempt.deliveryKey)).toEqual([
      intent.deliveryKey,
      intent.deliveryKey,
    ]);
    expect(attempts.map((attempt) => attempt.payloadHash)).toEqual([
      intent.payloadHash,
      intent.payloadHash,
    ]);
    const replay = fixture();
    replay.send({
      ...command,
      providerUrl: restartedProvider.url,
      now: new Date(now.getTime() + 122_000).toISOString(),
    });
    expect(await replay.reply('dispatcher.result')).toMatchObject({
      submissions: 0,
      result: { kind: 'SKIPPED', state: 'SIMULATED' },
    });
    await replay.exited();
  }, 45_000);

  it('fences a second process and quarantines expired ambiguity without another submission', async () => {
    const { data, intent } = await produce();
    const saved = await ledger();
    const now = new Date();
    const external = await provider(saved.path, true, now);
    const command: NotificationFixtureCommand = {
      type: 'dispatcher.run',
      organizationId: data.organizationId,
      notificationId: intent.id,
      providerUrl: external.url,
      now: now.toISOString(),
    };
    const owner = fixture();
    owner.send(command);
    await external.reply('provider.accepted');
    const rival = fixture();
    rival.send(command);
    expect(await rival.reply('dispatcher.result')).toMatchObject({
      submissions: 0,
      result: { kind: 'SKIPPED', state: 'SENDING' },
    });
    await rival.exited();
    await owner.kill();
    const expired = fixture();
    expired.send({ ...command, now: new Date(now.getTime() + 24 * 60 * 60_000).toISOString() });
    expect(await expired.reply('dispatcher.result')).toMatchObject({
      submissions: 0,
      result: { kind: 'SKIPPED', state: 'QUARANTINED', reason: 'DEADLINE_EXPIRED' },
    });
    await expired.exited();
    expect(await saved.read()).toHaveLength(1);
    expect(
      await prisma.reviewNotificationAttempt.count({
        where: { organizationId: data.organizationId },
      }),
    ).toBe(1);
    const retained = await prisma.reviewNotificationIntent.findFirstOrThrow({
      where: { id: intent.id, organizationId: data.organizationId },
    });
    expect(retained.deliveryKey).toBe(intent.deliveryKey);
    expect(retained.payloadHash).toBe(intent.payloadHash);
  }, 45_000);
});

describe('review notification transport boundaries', () => {
  it('keeps default and pre-cancelled delivery disabled before acquiring any lease', async () => {
    const { data, intent } = await produce();
    const input = { prisma, organizationId: data.organizationId, notificationId: intent.id };
    expect(await dispatchReviewNotification(input)).toEqual({ kind: 'DISABLED' });
    const controller = new AbortController();
    controller.abort();
    expect(
      await dispatchReviewNotification({
        ...input,
        signal: controller.signal,
        transport: new SyntheticReviewNotificationTransport(),
      }),
    ).toEqual({ kind: 'CANCELLED' });
    expect(
      await prisma.reviewNotificationAttempt.count({
        where: { organizationId: data.organizationId },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.reviewNotificationDelivery.findFirstOrThrow({
          where: { organizationId: data.organizationId, notificationId: intent.id },
        })
      ).state,
    ).toBe('PENDING');
  });

  it('retains unknown acceptance after timeout and retries exactly once under the original key', async () => {
    const { data, intent } = await produce();
    let now = new Date();
    const synthetic = new SyntheticReviewNotificationTransport({ clock: (): Date => now });
    let observedAbort = false;
    const hanging: ReviewNotificationTransport = {
      kind: 'SYNTHETIC',
      async submit(input, signal) {
        await synthetic.submit(input, signal);
        signal.addEventListener(
          'abort',
          () => {
            observedAbort = true;
          },
          { once: true },
        );
        return new Promise<never>(() => undefined);
      },
    };
    const input = {
      prisma,
      organizationId: data.organizationId,
      notificationId: intent.id,
      clock: (): Date => now,
    };
    expect(
      await dispatchReviewNotification({ ...input, transport: hanging, timeoutMs: 20 }),
    ).toMatchObject({ kind: 'RECORDED', state: 'PENDING' });
    expect(observedAbort).toBe(true);
    expect(synthetic.acceptanceCount).toBe(1);
    expect(
      await prisma.reviewNotificationReceipt.findFirst({
        where: { organizationId: data.organizationId },
      }),
    ).toMatchObject({ outcome: 'UNKNOWN', code: 'TRANSPORT_UNKNOWN' });
    now = new Date(now.getTime() + 61_000);
    expect(await dispatchReviewNotification({ ...input, transport: synthetic })).toMatchObject({
      kind: 'RECORDED',
      state: 'SIMULATED',
    });
    expect(synthetic.acceptanceCount).toBe(1);
    expect(
      (
        await prisma.reviewNotificationDelivery.findFirstOrThrow({
          where: { organizationId: data.organizationId, notificationId: intent.id },
        })
      ).ambiguous,
    ).toBe(false);
  });

  it.each(['RAW_ERROR', 'MALFORMED_RECEIPT'] as const)(
    'closes %s into safe unknown receipt data',
    async (kind) => {
      const { data, intent } = await produce();
      const transport: ReviewNotificationTransport = {
        kind: 'SYNTHETIC',
        async submit() {
          if (kind === 'RAW_ERROR') return Promise.reject(new Error('PRIVATE-PROVIDER-MARKER'));
          return Promise.resolve({
            kind: 'SIMULATED',
            receiptId: '',
            acceptedAt: 'PRIVATE-PROVIDER-MARKER',
          });
        },
      };
      expect(
        await dispatchReviewNotification({
          prisma,
          organizationId: data.organizationId,
          notificationId: intent.id,
          transport,
        }),
      ).toMatchObject({ kind: 'RECORDED', state: 'PENDING' });
      const receipts = await prisma.reviewNotificationReceipt.findMany({
        where: { organizationId: data.organizationId },
      });
      expect(receipts).toHaveLength(1);
      expect(receipts[0]).toMatchObject({
        outcome: 'UNKNOWN',
        code: 'TRANSPORT_UNKNOWN',
        providerReceiptId: null,
      });
      expect(JSON.stringify(receipts)).not.toContain('PRIVATE-PROVIDER-MARKER');
    },
  );

  it('honors retry-after without changing the immutable delivery identity', async () => {
    const { data, intent } = await produce();
    let now = new Date();
    let calls = 0;
    const transport: ReviewNotificationTransport = {
      kind: 'SYNTHETIC',
      async submit() {
        calls++;
        return Promise.reject(new ReviewNotificationTransportError('RETRYABLE', 120_000));
      },
    };
    const input = {
      prisma,
      organizationId: data.organizationId,
      notificationId: intent.id,
      clock: (): Date => now,
      transport,
    };
    expect(await dispatchReviewNotification(input)).toMatchObject({ state: 'PENDING' });
    now = new Date(now.getTime() + 61_000);
    expect(await dispatchReviewNotification(input)).toMatchObject({
      kind: 'SKIPPED',
      state: 'PENDING',
    });
    expect(calls).toBe(1);
    now = new Date(now.getTime() + 60_000);
    expect(
      await dispatchReviewNotification({
        ...input,
        transport: new SyntheticReviewNotificationTransport({ clock: (): Date => now }),
      }),
    ).toMatchObject({ state: 'SIMULATED' });
    expect(
      (
        await prisma.reviewNotificationIntent.findFirstOrThrow({
          where: { organizationId: data.organizationId, id: intent.id },
        })
      ).deliveryKey,
    ).toBe(intent.deliveryKey);
  });

  it('quarantines idempotency conflict without allowing another submission', async () => {
    const { data, intent } = await produce();
    const transport: ReviewNotificationTransport = {
      kind: 'SYNTHETIC',
      async submit() {
        return Promise.reject(new ReviewNotificationTransportError('CONFLICT'));
      },
    };
    const input = {
      prisma,
      organizationId: data.organizationId,
      notificationId: intent.id,
      transport,
    };
    expect(await dispatchReviewNotification(input)).toMatchObject({ state: 'QUARANTINED' });
    expect(await dispatchReviewNotification(input)).toMatchObject({
      kind: 'SKIPPED',
      state: 'QUARANTINED',
    });
    expect(
      await prisma.reviewNotificationAttempt.count({
        where: { organizationId: data.organizationId },
      }),
    ).toBe(1);
  });

  it('recovers provider acceptance after receipt-audit rollback without fabricating a failure receipt', async () => {
    const { data, intent } = await produce();
    let now = new Date();
    const transport = new SyntheticReviewNotificationTransport({ clock: (): Date => now });
    const input = {
      prisma,
      organizationId: data.organizationId,
      notificationId: intent.id,
      transport,
      clock: (): Date => now,
    };
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION notification_dispatch_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'notification.receipt_saved' THEN RAISE EXCEPTION 'PRIVATE-DATABASE-MARKER'; END IF; RETURN NEW; END $$`,
    );
    await prisma.$executeRawUnsafe(
      'CREATE TRIGGER notification_dispatch_fail_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION notification_dispatch_fail_audit()',
    );
    await expect(dispatchReviewNotification(input)).rejects.toThrow(
      'REVIEW_NOTIFICATION_RECEIPT_UNCONFIRMED',
    );
    expect(transport.acceptanceCount).toBe(1);
    expect(
      await prisma.reviewNotificationReceipt.count({
        where: { organizationId: data.organizationId },
      }),
    ).toBe(0);
    expect(
      (
        await prisma.reviewNotificationDelivery.findFirstOrThrow({
          where: { organizationId: data.organizationId, notificationId: intent.id },
        })
      ).state,
    ).toBe('SENDING');
    await prisma.$executeRawUnsafe('DROP TRIGGER notification_dispatch_fail_audit ON "AuditLog"');
    now = new Date(now.getTime() + 61_000);
    expect(await dispatchReviewNotification(input)).toMatchObject({
      kind: 'RECORDED',
      state: 'SIMULATED',
    });
    expect(transport.acceptanceCount).toBe(1);
    expect(
      (
        await prisma.reviewNotificationReceipt.findMany({
          where: { organizationId: data.organizationId },
        })
      ).map((row) => row.outcome),
    ).toEqual(['SIMULATED']);
  });
});
