import { open } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { prisma } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import type { RetellPort } from '@dentabill/payer-ivr';
import {
  CallJobDataSchema,
  SummaryJobDataSchema,
  type CallJobResult,
  type JobDispatcher,
} from '@dentabill/queue';
import { z } from 'zod';

import { loadWorkerEnv } from './env.js';
import { createCallJobHandler } from './handler.js';
import { enqueueJobOutbox, relayJobOutbox } from './job-outbox.js';

const optionsSchema = z.object({ priority: z.number().optional(), delayMs: z.number().optional() });
export const brokerDeliverySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('CALL_PLACE'),
    data: CallJobDataSchema,
    options: optionsSchema.nullable(),
  }),
  z.object({
    kind: z.literal('SUMMARY_GENERATE'),
    data: SummaryJobDataSchema,
    options: optionsSchema.nullable(),
  }),
]);
export type BrokerDelivery = z.infer<typeof brokerDeliverySchema>;

const commandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('producer.commit'), data: CallJobDataSchema }),
  z.object({ type: z.literal('producer.exit') }),
  z.object({
    type: z.literal('broker.start'),
    ledgerPath: z.string(),
    actionLedgerPath: z.string(),
    response: z.enum(['hold', 'accept']),
    retellCallId: z.string(),
  }),
  z.object({ type: z.literal('broker.accept-responses') }),
  z.object({ type: z.literal('broker.stop') }),
  z.object({
    type: z.literal('relay.run'),
    organizationId: z.string(),
    brokerUrl: z.string().url(),
    now: z.string().datetime().optional(),
  }),
  z.object({
    type: z.literal('consumer.run'),
    data: CallJobDataSchema,
    providerUrl: z.string().url(),
  }),
]);

export type OutboxFixtureCommand = z.infer<typeof commandSchema>;
export type OutboxFixtureReply =
  | { type: 'producer.committed'; pid: number; outboxId: string; intentId: string }
  | { type: 'broker.ready'; pid: number; url: string; providerUrl: string }
  | { type: 'broker.accepted'; pid: number; sequence: number; idempotencyKey: string }
  | { type: 'broker.responses-enabled'; pid: number }
  | { type: 'provider.accepted'; pid: number; intentId: string }
  | {
      type: 'relay.complete';
      pid: number;
      result: { selected: number; sent: number; failed: number; quarantined: number };
    }
  | { type: 'consumer.complete'; pid: number; result: CallJobResult; startCount: number }
  | { type: 'fixture.failed'; message: string };

async function send(reply: OutboxFixtureReply): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (!process.send) {
      reject(new Error('Fixture requires IPC.'));
      return;
    }
    process.send(reply, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function command(): Promise<OutboxFixtureCommand> {
  const value = await new Promise<unknown>((resolve) => {
    process.once('message', (message: unknown) => {
      resolve(message);
    });
  });
  return commandSchema.parse(value);
}

function loopback(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') {
    throw new Error('Synthetic endpoints must use loopback HTTP.');
  }
  return url;
}

async function appendDurable(path: string, record: unknown): Promise<void> {
  // The parent creates these files inside a private synthetic-only test directory.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const ledger = await open(path, 'a', 0o600);
  try {
    await ledger.writeFile(`${JSON.stringify(record)}\n`);
    await ledger.sync();
  } finally {
    await ledger.close();
  }
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

async function runBroker(
  initial: Extract<OutboxFixtureCommand, { type: 'broker.start' }>,
): Promise<void> {
  let respond = initial.response === 'accept';
  let sequence = 0;
  async function accept(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method !== 'POST') {
      response.writeHead(404).end();
      return;
    }
    if (request.url === '/synthetic-dispatch') {
      const delivery = brokerDeliverySchema.parse(await body(request));
      const current = ++sequence;
      // Every accepted delivery is recorded. This broker does not deduplicate.
      await appendDurable(initial.ledgerPath, delivery);
      await send({
        type: 'broker.accepted',
        pid: process.pid,
        sequence: current,
        idempotencyKey: delivery.data.idempotencyKey,
      });
      if (respond) {
        response.writeHead(202, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ jobId: delivery.data.idempotencyKey }));
      }
      return;
    }
    if (request.url === '/synthetic-create') {
      const input = z.object({ intentId: z.string().min(1) }).parse(await body(request));
      await appendDurable(initial.actionLedgerPath, {
        intentId: input.intentId,
        retellCallId: initial.retellCallId,
      });
      await send({ type: 'provider.accepted', pid: process.pid, intentId: input.intentId });
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ call_id: initial.retellCallId, queued_at: '2026-10-13T12:00:00.000Z' }),
      );
      return;
    }
    response.writeHead(404).end();
  }
  const server = createServer((request, response) => {
    void accept(request, response).catch(() => {
      response.writeHead(500).end();
      void send({ type: 'fixture.failed', message: 'Synthetic broker acceptance failed.' });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing loopback port.');
  let next = command();
  await send({
    type: 'broker.ready',
    pid: process.pid,
    url: `http://127.0.0.1:${String(address.port)}/synthetic-dispatch`,
    providerUrl: `http://127.0.0.1:${String(address.port)}/synthetic-create`,
  });
  for (;;) {
    const received = await next;
    if (received.type === 'broker.stop') break;
    if (received.type !== 'broker.accept-responses') throw new Error('Unexpected broker command.');
    respond = true;
    next = command();
    await send({ type: 'broker.responses-enabled', pid: process.pid });
  }
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function runProducer(data: z.infer<typeof CallJobDataSchema>): Promise<void> {
  const committed = await prisma.$transaction(async (tx) => {
    await tx.claim.updateMany({
      where: { id: data.claimId, organizationId: data.organizationId },
      data: { status: 'IN_QUEUE' },
    });
    const claim = await tx.claim.findFirstOrThrow({
      where: { id: data.claimId, organizationId: data.organizationId },
    });
    const intent = await tx.callIntent.create({
      data: { ...data, payerCode: claim.payerCode, claimVersion: claim.updatedAt },
    });
    const outbox = await enqueueJobOutbox(tx, {
      organizationId: data.organizationId,
      kind: 'CALL_PLACE',
      data,
    });
    return { intentId: intent.id, outboxId: outbox.id };
  });
  const exit = command();
  await send({ type: 'producer.committed', pid: process.pid, ...committed });
  // The test SIGKILLs this process after commit, before any dispatch can run.
  if ((await exit).type !== 'producer.exit') throw new Error('Unexpected producer command.');
}

async function runRelay(
  initial: Extract<OutboxFixtureCommand, { type: 'relay.run' }>,
): Promise<void> {
  const endpoint = loopback(initial.brokerUrl);
  const dispatch = async (delivery: BrokerDelivery): Promise<string> => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(delivery),
    });
    if (!response.ok) throw new Error('Synthetic broker rejected dispatch.');
    return z.object({ jobId: z.string() }).parse(await response.json()).jobId;
  };
  const jobDispatcher: JobDispatcher = {
    mode: 'sqs',
    dispatchCall: (data, options) =>
      dispatch({ kind: 'CALL_PLACE', data, options: options ?? null }),
    dispatchSummary: (data, options) =>
      dispatch({ kind: 'SUMMARY_GENERATE', data, options: options ?? null }),
  };
  const now = initial.now;
  const result = await relayJobOutbox({
    prisma,
    jobDispatcher,
    organizationId: initial.organizationId,
    limit: 1,
    leaseMs: 120_000,
    sendTimeoutMs: 60_000,
    budgetMs: 60_000,
    ...(now === undefined ? {} : { clock: () => new Date(now) }),
  });
  await send({ type: 'relay.complete', pid: process.pid, result });
}

async function runConsumer(
  initial: Extract<OutboxFixtureCommand, { type: 'consumer.run' }>,
): Promise<void> {
  const endpoint = loopback(initial.providerUrl);
  let startCount = 0;
  const retellPort: RetellPort = {
    startCall: async (input) => {
      startCount++;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ intentId: input.idempotencyKey }),
      });
      if (!response.ok) throw new Error('Synthetic provider rejected create.');
      const result = z
        .object({ call_id: z.string(), queued_at: z.string() })
        .parse(await response.json());
      return { retellCallId: result.call_id, queuedAt: result.queued_at };
    },
    endCall: () => Promise.reject(new Error('Unexpected synthetic provider hangup.')),
    subscribe: (retellCallId, listener) => {
      queueMicrotask(() => {
        void listener({
          type: 'call.ended',
          retellCallId,
          endedAt: '2026-10-13T12:01:00.000Z',
          durationSeconds: 60,
          endReason: 'agent_hangup',
          transcript: { text: 'Synthetic final transcript.', turns: null },
        });
      });
      return () => {
        /* The synthetic terminal event is emitted once. */
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
  const job = { id: initial.data.idempotencyKey, data: initial.data } as Parameters<
    typeof handler
  >[0];
  const result = await handler(job, 'synthetic-outbox-consumer-token');
  await send({ type: 'consumer.complete', pid: process.pid, result, startCount });
}

try {
  const initial = await command();
  if (initial.type === 'producer.commit') await runProducer(initial.data);
  else if (initial.type === 'broker.start') await runBroker(initial);
  else if (initial.type === 'relay.run') await runRelay(initial);
  else if (initial.type === 'consumer.run') await runConsumer(initial);
  else throw new Error('Unexpected initial fixture command.');
} catch (error) {
  await send({
    type: 'fixture.failed',
    message: error instanceof Error ? error.message : 'Unknown synthetic fixture error.',
  });
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  if (process.connected) process.disconnect();
}
