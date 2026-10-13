import { open } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { prisma } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import { createRetellReconciliationClient, LiveRetell } from '@dentabill/payer-ivr';
import { CallJobDataSchema, type CallJobResult } from '@dentabill/queue';
import Retell from 'retell-sdk';
import { z } from 'zod';

import { observeAcceptedCall, sweepDueAcceptedCalls } from './call-observer.js';
import { loadWorkerEnv } from './env.js';
import { createCallJobHandler } from './handler.js';

const commandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('provider.start'),
    ledgerPath: z.string(),
    retellCallId: z.string(),
  }),
  z.object({
    type: z.literal('provider.configure'),
    terminal: z.boolean().optional(),
    holdNextGet: z.boolean().optional(),
    holdNextStop: z.boolean().optional(),
    commandId: z.string(),
  }),
  z.object({ type: z.literal('provider.release'), requestId: z.number().int() }),
  z.object({ type: z.literal('provider.stop') }),
  z.object({
    type: z.literal('consumer.run'),
    data: CallJobDataSchema,
    providerOrigin: z.string().url(),
  }),
  z.object({
    type: z.literal('observer.run'),
    organizationId: z.string(),
    intentId: z.string(),
    providerOrigin: z.string().url(),
    now: z.string().datetime(),
  }),
  z.object({
    type: z.literal('sweep.run'),
    providerOrigin: z.string().url(),
    now: z.string().datetime(),
  }),
]);

export type ObserverFixtureCommand = z.infer<typeof commandSchema>;
export type ObserverFixtureReply =
  | { type: 'provider.ready'; pid: number; origin: string }
  | { type: 'provider.configured'; commandId: string }
  | {
      type: 'provider.request';
      requestId: number;
      action: 'create' | 'get' | 'stop';
      held: boolean;
    }
  | { type: 'consumer.complete'; result: CallJobResult }
  | { type: 'observer.complete'; result: CallJobResult }
  | { type: 'sweep.complete'; result: Awaited<ReturnType<typeof sweepDueAcceptedCalls>> }
  | { type: 'fixture.failed'; message: string };

async function send(reply: ObserverFixtureReply): Promise<void> {
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

async function command(): Promise<ObserverFixtureCommand> {
  return commandSchema.parse(
    await new Promise<unknown>((resolve) => {
      process.once('message', (value: unknown) => {
        resolve(value);
      });
    }),
  );
}

function loopback(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
    throw new Error('Synthetic endpoints must use loopback HTTP.');
  return url;
}

async function appendDurable(path: string, record: unknown): Promise<void> {
  // Only the parent's private synthetic ledger path enters this process.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const ledger = await open(path, 'a', 0o600);
  try {
    await ledger.writeFile(`${JSON.stringify(record)}\n`);
    await ledger.sync();
  } finally {
    await ledger.close();
  }
}

const createBodySchema = z.object({
  idempotency_key: z.string(),
  from_number: z.string(),
  to_number: z.string(),
  override_agent_id: z.string(),
  metadata: z.object({ dentabill_intent_id: z.string() }).passthrough(),
});

async function runProvider(
  initial: Extract<ObserverFixtureCommand, { type: 'provider.start' }>,
): Promise<void> {
  let accepted: z.infer<typeof createBodySchema> | undefined;
  let acceptedAt = 0;
  let terminal = false;
  let holdNextGet = false;
  let holdNextStop = false;
  let requestId = 0;
  const held = new Map<number, () => void>();
  const evidence = (): object => {
    if (!accepted) throw new Error('No synthetic acceptance.');
    return {
      call_id: initial.retellCallId,
      call_type: 'phone_call',
      agent_id: accepted.override_agent_id,
      direction: 'outbound',
      from_number: accepted.from_number,
      to_number: accepted.to_number,
      metadata: accepted.metadata,
      call_status: terminal ? 'ended' : 'ongoing',
      start_timestamp: acceptedAt,
      ...(terminal
        ? {
            end_timestamp: acceptedAt + 60_000,
            duration_ms: 60_000,
            disconnection_reason: 'agent_hangup',
            transcript: 'Synthetic observer final transcript.\n',
          }
        : {}),
    };
  };
  async function record(action: 'create' | 'get' | 'stop', isHeld: boolean): Promise<number> {
    const id = ++requestId;
    await appendDurable(initial.ledgerPath, {
      requestId: id,
      action,
      retellCallId: initial.retellCallId,
      intentId: accepted?.metadata.dentabill_intent_id,
    });
    await send({ type: 'provider.request', requestId: id, action, held: isHeld });
    return id;
  }
  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.method === 'POST' && request.url === '/v2/create-phone-call') {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
      const body = createBodySchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (body.idempotency_key !== body.metadata.dentabill_intent_id)
        throw new Error('Inconsistent synthetic provider correlation.');
      accepted = body;
      acceptedAt = Date.now();
      // Every create is counted, including duplicates; the provider never deduplicates.
      await record('create', false);
      response.writeHead(201, { 'content-type': 'application/json' });
      response.end(JSON.stringify(evidence()));
      return;
    }
    if (request.method === 'GET' && request.url === `/v2/get-call/${initial.retellCallId}`) {
      const freeze = JSON.stringify(evidence());
      const isHeld = holdNextGet;
      holdNextGet = false;
      const id = await record('get', isHeld);
      const finish = (): void => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(freeze);
      };
      if (isHeld) held.set(id, finish);
      else finish();
      return;
    }
    if (request.method === 'POST' && request.url === `/v2/stop-call/${initial.retellCallId}`) {
      const isHeld = holdNextStop;
      holdNextStop = false;
      const id = await record('stop', isHeld);
      const finish = (): void => {
        response.writeHead(204).end();
      };
      // Stop acceptance changes no terminal evidence, even after its ACK is delivered.
      if (isHeld) held.set(id, finish);
      else finish();
      return;
    }
    response.writeHead(404).end();
  }
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      response.writeHead(500).end();
      void send({ type: 'fixture.failed', message: 'Synthetic provider request failed.' });
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
    type: 'provider.ready',
    pid: process.pid,
    origin: `http://127.0.0.1:${String(address.port)}`,
  });
  for (;;) {
    const instruction = await next;
    next = command();
    if (instruction.type === 'provider.stop') break;
    if (instruction.type === 'provider.configure') {
      terminal = instruction.terminal ?? terminal;
      holdNextGet = instruction.holdNextGet ?? holdNextGet;
      holdNextStop = instruction.holdNextStop ?? holdNextStop;
      await send({ type: 'provider.configured', commandId: instruction.commandId });
    } else if (instruction.type === 'provider.release') {
      const finish = held.get(instruction.requestId);
      if (!finish) throw new Error('Unknown held synthetic response.');
      held.delete(instruction.requestId);
      finish();
    } else throw new Error('Unexpected provider command.');
  }
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function transports(providerOrigin: string) {
  const origin = loopback(providerOrigin).origin;
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
  const loopbackFetch: typeof fetch = async (input, init) => {
    if (typeof input !== 'string') throw new Error('Expected fixed provider URL.');
    const requested = new URL(input);
    if (requested.origin !== 'https://api.retellai.com')
      throw new Error('Unexpected provider origin.');
    return fetch(new URL(`${requested.pathname}${requested.search}`, origin), init);
  };
  const provider = createRetellReconciliationClient({
    apiKey: 'synthetic-loopback-only-key',
    fetch: loopbackFetch,
  });
  return { retellPort, provider };
}

async function runConsumer(
  initial: Extract<ObserverFixtureCommand, { type: 'consumer.run' }>,
): Promise<void> {
  const env = loadWorkerEnv({
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: 'redis://localhost:6379/14',
    NODE_ENV: 'test',
    RETELL_API_KEY: '',
    DEMO_AUTOPILOT: 'false',
    WORKER_OUTBOUND_NUMBER: '+15555550100',
  });
  const { retellPort, provider } = transports(initial.providerOrigin);
  const handler = createCallJobHandler({
    prisma,
    retellPort,
    reconciliationProvider: provider,
    observationWindowMs: 0,
    env,
    logger: createLogger({ level: 'fatal', pretty: false }),
    outboundNumberE164: env.WORKER_OUTBOUND_NUMBER,
  });
  const job = { id: initial.data.idempotencyKey, data: initial.data } as Parameters<
    typeof handler
  >[0];
  const result = await handler(job, 'synthetic-observer-consumer');
  await send({ type: 'consumer.complete', result });
}

try {
  const initial = await command();
  if (initial.type === 'provider.start') await runProvider(initial);
  else if (initial.type === 'consumer.run') await runConsumer(initial);
  else if (initial.type === 'observer.run') {
    const result = await observeAcceptedCall({
      prisma,
      ...transports(initial.providerOrigin),
      organizationId: initial.organizationId,
      intentId: initial.intentId,
      clock: () => new Date(initial.now),
      waitMs: 0,
      forceRead: true,
    });
    await send({ type: 'observer.complete', result });
  } else if (initial.type === 'sweep.run') {
    const result = await sweepDueAcceptedCalls({
      prisma,
      ...transports(initial.providerOrigin),
      clock: () => new Date(initial.now),
      limit: 5,
      budgetMs: 25_000,
    });
    await send({ type: 'sweep.complete', result });
  } else throw new Error('Unexpected initial fixture command.');
} catch {
  await send({ type: 'fixture.failed', message: 'Synthetic observer fixture failed.' });
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
  if (process.connected) process.disconnect();
}
