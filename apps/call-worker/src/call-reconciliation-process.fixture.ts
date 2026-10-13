import { open } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { prisma } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import { createRetellReconciliationClient, LiveRetell } from '@dentabill/payer-ivr';
import {
  CallJobDataSchema,
  SummaryJobDataSchema,
  type CallJobResult,
  type JobDispatcher,
} from '@dentabill/queue';
import Retell from 'retell-sdk';
import { z } from 'zod';

import { reconcileCallIntent } from './call-reconciliation.js';
import { loadWorkerEnv } from './env.js';
import { createCallJobHandler } from './handler.js';
import { relayJobOutbox } from './job-outbox.js';

export const recoveryDeliverySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('CALL_PLACE'), data: CallJobDataSchema }),
  z.object({ kind: z.literal('SUMMARY_GENERATE'), data: SummaryJobDataSchema }),
]);
export type RecoveryDelivery = z.infer<typeof recoveryDeliverySchema>;

const commandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('provider.start'),
    acceptanceLedgerPath: z.string(),
    brokerLedgerPath: z.string(),
    readLedgerPath: z.string(),
    retellCallId: z.string(),
  }),
  z.object({ type: z.literal('provider.stop') }),
  z.object({
    type: z.literal('consumer.run'),
    data: CallJobDataSchema,
    providerOrigin: z.string().url(),
  }),
  z.object({
    type: z.literal('reconciler.run'),
    organizationId: z.string(),
    intentId: z.string(),
    clerkUserId: z.string(),
    providerOrigin: z.string().url(),
    now: z.string().datetime(),
  }),
  z.object({ type: z.literal('reconciler.exit') }),
  z.object({
    type: z.literal('relay.run'),
    organizationId: z.string(),
    providerOrigin: z.string().url(),
    now: z.string().datetime(),
  }),
]);

export type ReconciliationFixtureCommand = z.infer<typeof commandSchema>;
export type ReconciliationFixtureReply =
  | { type: 'provider.ready'; pid: number; origin: string }
  | { type: 'provider.accepted'; pid: number; intentId: string }
  | { type: 'broker.accepted'; pid: number; idempotencyKey: string }
  | { type: 'consumer.complete'; pid: number; result: CallJobResult }
  | {
      type: 'reconciler.bound';
      pid: number;
      result: Awaited<ReturnType<typeof reconcileCallIntent>>;
    }
  | {
      type: 'relay.complete';
      pid: number;
      result: { selected: number; sent: number; failed: number; quarantined: number };
    }
  | { type: 'fixture.failed'; message: string };

async function send(reply: ReconciliationFixtureReply): Promise<void> {
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

async function command(): Promise<ReconciliationFixtureCommand> {
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
  // Paths are generated inside the parent's private synthetic-only directory.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const ledger = await open(path, 'a', 0o600);
  try {
    await ledger.writeFile(`${JSON.stringify(record)}\n`);
    await ledger.sync();
  } finally {
    await ledger.close();
  }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

const createBodySchema = z.object({
  idempotency_key: z.string(),
  from_number: z.string(),
  to_number: z.string(),
  override_agent_id: z.string(),
  metadata: z.object({
    dentabill_intent_id: z.string(),
    idempotencyKey: z.string(),
    payerCode: z.string(),
  }),
});

async function runProvider(
  initial: Extract<ReconciliationFixtureCommand, { type: 'provider.start' }>,
): Promise<void> {
  let accepted: z.infer<typeof createBodySchema> | undefined;
  let acceptedAt = 0;
  const evidence = (): object | null =>
    accepted
      ? {
          call_id: initial.retellCallId,
          call_type: 'phone_call',
          agent_id: accepted.override_agent_id,
          direction: 'outbound',
          from_number: accepted.from_number,
          to_number: accepted.to_number,
          metadata: accepted.metadata,
          call_status: 'ended',
          start_timestamp: acceptedAt,
          end_timestamp: acceptedAt + 60_000,
          duration_ms: 60_000,
          disconnection_reason: 'agent_hangup',
          transcript: 'Synthetic recovered final transcript.\n',
        }
      : null;

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === 'POST' && request.url === '/synthetic-dispatch') {
      const delivery = recoveryDeliverySchema.parse(await readBody(request));
      await appendDurable(initial.brokerLedgerPath, delivery);
      await send({
        type: 'broker.accepted',
        pid: process.pid,
        idempotencyKey: delivery.data.idempotencyKey,
      });
      response.writeHead(202, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ jobId: delivery.data.idempotencyKey }));
      return;
    }
    if (request.method === 'POST' && request.url === '/v2/create-phone-call') {
      const input = createBodySchema.parse(await readBody(request));
      if (
        input.idempotency_key !== input.metadata.dentabill_intent_id ||
        input.idempotency_key !== input.metadata.idempotencyKey
      )
        throw new Error('Inconsistent provider correlation.');
      // Every create request is recorded, including duplicates. This service never deduplicates.
      await appendDurable(initial.acceptanceLedgerPath, {
        intentId: input.metadata.dentabill_intent_id,
        retellCallId: initial.retellCallId,
      });
      accepted = input;
      acceptedAt = Date.now();
      await send({ type: 'provider.accepted', pid: process.pid, intentId: input.idempotency_key });
      // Acceptance is durable, but the initial consumer never receives its response.
      return;
    }
    if (request.method === 'POST' && request.url === '/v3/list-calls') {
      const body = z
        .object({
          filter_criteria: z.object({
            metadata: z
              .array(
                z.object({
                  key: z.literal('dentabill_intent_id'),
                  type: z.literal('string'),
                  op: z.literal('eq'),
                  value: z.string(),
                }),
              )
              .length(1),
          }),
        })
        .passthrough()
        .parse(await readBody(request));
      await appendDurable(initial.readLedgerPath, { method: 'POST', path: request.url, body });
      const matches =
        body.filter_criteria.metadata[0]?.value === accepted?.metadata.dentabill_intent_id;
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ items: matches && evidence() ? [evidence()] : [], has_more: false }),
      );
      return;
    }
    if (request.method === 'GET' && request.url === `/v2/get-call/${initial.retellCallId}`) {
      await appendDurable(initial.readLedgerPath, { method: 'GET', path: request.url });
      response.writeHead(evidence() ? 200 : 404, { 'content-type': 'application/json' });
      response.end(JSON.stringify(evidence()));
      return;
    }
    response.writeHead(404).end();
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      response.writeHead(500).end();
      void send({ type: 'fixture.failed', message: 'Synthetic service request failed.' });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing loopback port.');
  const stop = command();
  await send({
    type: 'provider.ready',
    pid: process.pid,
    origin: `http://127.0.0.1:${String(address.port)}`,
  });
  if ((await stop).type !== 'provider.stop') throw new Error('Unexpected provider command.');
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function runConsumer(
  initial: Extract<ReconciliationFixtureCommand, { type: 'consumer.run' }>,
): Promise<void> {
  const origin = loopback(initial.providerOrigin).origin;
  const retellPort = new LiveRetell({
    apiKey: 'synthetic-loopback-only-key',
    retellLoader: () =>
      Promise.resolve(
        class SyntheticRetell extends Retell {
          constructor(config: { apiKey: string }) {
            super({ ...config, baseURL: origin });
          }
        },
      ),
  });
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
  const result = await handler(job, 'synthetic-reconciliation-consumer');
  await send({ type: 'consumer.complete', pid: process.pid, result });
}

async function runReconciler(
  initial: Extract<ReconciliationFixtureCommand, { type: 'reconciler.run' }>,
): Promise<void> {
  const origin = loopback(initial.providerOrigin).origin;
  const loopbackFetch: typeof fetch = async (input, init) => {
    if (typeof input !== 'string') throw new Error('Expected fixed provider URL.');
    const requested = new URL(input);
    if (requested.origin !== 'https://api.retellai.com') {
      throw new Error('Unexpected provider origin.');
    }
    return fetch(new URL(`${requested.pathname}${requested.search}`, origin), init);
  };
  const provider = createRetellReconciliationClient({
    apiKey: 'synthetic-loopback-only-key',
    fetch: loopbackFetch,
  });
  const result = await reconcileCallIntent({
    prisma,
    provider,
    organizationId: initial.organizationId,
    intentId: initial.intentId,
    clerkUserId: initial.clerkUserId,
    clock: () => new Date(initial.now),
  });
  const exit = command();
  // The core's transaction is committed. No broker call occurs before this crash barrier.
  await send({ type: 'reconciler.bound', pid: process.pid, result });
  if ((await exit).type !== 'reconciler.exit') throw new Error('Unexpected reconciler command.');
}

async function runRelay(
  initial: Extract<ReconciliationFixtureCommand, { type: 'relay.run' }>,
): Promise<void> {
  const endpoint = new URL('/synthetic-dispatch', loopback(initial.providerOrigin));
  const dispatch = async (delivery: RecoveryDelivery): Promise<string> => {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(delivery),
    });
    if (!response.ok) throw new Error('Synthetic broker rejected delivery.');
    return z.object({ jobId: z.string() }).parse(await response.json()).jobId;
  };
  const jobDispatcher: JobDispatcher = {
    mode: 'sqs',
    dispatchCall: (data) => dispatch({ kind: 'CALL_PLACE', data }),
    dispatchSummary: (data) => dispatch({ kind: 'SUMMARY_GENERATE', data }),
  };
  const result = await relayJobOutbox({
    prisma,
    jobDispatcher,
    organizationId: initial.organizationId,
    limit: 1,
    clock: () => new Date(initial.now),
  });
  await send({ type: 'relay.complete', pid: process.pid, result });
}

try {
  const initial = await command();
  if (initial.type === 'provider.start') await runProvider(initial);
  else if (initial.type === 'consumer.run') await runConsumer(initial);
  else if (initial.type === 'reconciler.run') await runReconciler(initial);
  else if (initial.type === 'relay.run') await runRelay(initial);
  else throw new Error('Unexpected initial fixture command.');
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
