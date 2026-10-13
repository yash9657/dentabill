import { prisma } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import {
  acceptRetellWebhook,
  parseRetellWebhookEnvelope,
  type RetellPort,
  verifyRetellWebhookSignature,
} from '@dentabill/payer-ivr';
import { z } from 'zod';

import { loadWorkerEnv } from './env.js';
import { createCallJobHandler } from './handler.js';

const commandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('worker.start'),
    organizationId: z.string(),
    claimId: z.string(),
    retellCallId: z.string(),
  }),
  z.object({ type: z.literal('worker.release') }),
  z.object({
    type: z.literal('webhook.accept'),
    rawBody: z.string(),
    signature: z.string(),
    secret: z.string(),
  }),
  z.object({ type: z.literal('producer.exit') }),
]);

export type FixtureCommand = z.infer<typeof commandSchema>;
export type FixtureReply =
  | { type: 'worker.barrier'; pid: number }
  | {
      type: 'worker.complete';
      pid: number;
      callId: string;
      outcome: string;
      durationSeconds: number | null;
      startCount: number;
      subscribeCount: number;
      unsubscribeCount: number;
    }
  | {
      type: 'producer.accepted';
      pid: number;
      pending: boolean;
      replayed: boolean;
      eventCount: number;
    }
  | { type: 'fixture.failed'; message: string };

async function send(reply: FixtureReply): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (!process.send) {
      reject(new Error('Fixture requires an IPC channel.'));
      return;
    }
    process.send(reply, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function command(): Promise<FixtureCommand> {
  const message = await new Promise<unknown>((resolve) => {
    process.once('message', (received: unknown) => {
      resolve(received);
    });
  });
  return commandSchema.parse(message);
}

async function run(): Promise<void> {
  const initial = await command();
  if (initial.type === 'webhook.accept') {
    if (!verifyRetellWebhookSignature(initial)) throw new Error('Synthetic signature rejected.');
    const result = await acceptRetellWebhook(prisma, parseRetellWebhookEnvelope(initial.rawBody));
    const exit = command();
    await send({
      type: 'producer.accepted',
      pid: process.pid,
      pending: result.pending,
      replayed: result.replayed,
      eventCount: result.events.length,
    });
    // First producer is SIGKILLed here, after commit and before graceful teardown.
    if ((await exit).type !== 'producer.exit') throw new Error('Unexpected producer command.');
    return;
  }
  if (initial.type !== 'worker.start') throw new Error('Unexpected initial fixture command.');

  let startCount = 0;
  let subscribeCount = 0;
  let unsubscribeCount = 0;
  const retellPort: RetellPort = {
    startCall: async () => {
      startCount++;
      const release = command();
      await send({ type: 'worker.barrier', pid: process.pid });
      if ((await release).type !== 'worker.release') throw new Error('Unexpected worker command.');
      return { retellCallId: initial.retellCallId, queuedAt: '2026-10-13T12:00:00.000Z' };
    },
    endCall: () =>
      Promise.reject(new Error('This synthetic scenario must not request a provider hangup.')),
    // No callback is saved or invoked: only the database can finish this worker.
    subscribe: () => {
      subscribeCount++;
      return () => {
        unsubscribeCount++;
      };
    },
  };
  const env = loadWorkerEnv({
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: 'redis://localhost:6379/14',
    NODE_ENV: 'test',
    RETELL_API_KEY: '',
    DEMO_AUTOPILOT: 'false',
    WORKER_OUTBOUND_NUMBER: '+15555550100',
  });
  const handler = createCallJobHandler({
    prisma,
    retellPort,
    env,
    logger: createLogger({ level: 'fatal', pretty: false }),
    outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
  });
  const job = {
    id: 'synthetic-process-job',
    data: {
      organizationId: initial.organizationId,
      claimId: initial.claimId,
      payerCode: 'DELTA_DENTAL_PPO',
      attemptNumber: 1,
      claimPriority: 80,
      idempotencyKey: `process-${initial.retellCallId}`,
    },
  } as Parameters<typeof handler>[0];
  const result = await handler(job, 'synthetic-worker-token');
  if (result.callId === null) throw new Error('Synthetic worker did not accept call.');
  await send({
    type: 'worker.complete',
    pid: process.pid,
    callId: result.callId,
    outcome: result.outcome,
    durationSeconds: result.durationSeconds,
    startCount,
    subscribeCount,
    unsubscribeCount,
  });
}

try {
  await run();
} catch (error) {
  await send({
    type: 'fixture.failed',
    message: error instanceof Error ? error.message : 'Unknown synthetic fixture failure.',
  });
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  if (process.connected) process.disconnect();
}
