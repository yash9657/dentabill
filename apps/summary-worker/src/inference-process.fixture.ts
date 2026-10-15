import { open } from 'node:fs/promises';
import { createServer } from 'node:http';

import { prisma } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import { SummaryJobDataSchema, type SummaryJobResult } from '@dentabill/queue';
import { SummaryOutputSchema, type SummarizerPort } from '@dentabill/summarizer';
import { z } from 'zod';

import { loadSummaryWorkerEnv } from './env.js';
import { createSummaryJobHandler } from './handler.js';

const CommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('provider.start'),
    ledgerPath: z.string(),
    response: z.enum(['hold', 'accept']),
  }),
  z.object({
    type: z.literal('worker.run'),
    data: SummaryJobDataSchema,
    providerUrl: z.string().url(),
  }),
]);
export type InferenceFixtureCommand = z.infer<typeof CommandSchema>;
export type InferenceFixtureReply =
  | { type: 'provider.ready'; pid: number; url: string }
  | { type: 'provider.accepted'; pid: number; callId: string }
  | { type: 'worker.result'; pid: number; result: SummaryJobResult; submissions: number }
  | { type: 'worker.error'; pid: number; submissions: number }
  | { type: 'fixture.failed'; message: string };

async function send(reply: InferenceFixtureReply): Promise<void> {
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

async function provider(
  command: Extract<InferenceFixtureCommand, { type: 'provider.start' }>,
): Promise<void> {
  const server = createServer((request, response) => {
    void (async () => {
      if (request.method !== 'POST' || request.url !== '/synthetic-inference') {
        response.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
      const accepted = z
        .object({ organizationId: z.string(), callId: z.string() })
        .strict()
        .parse(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      // The parent owns this private, synthetic-only temporary ledger.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      const ledger = await open(command.ledgerPath, 'a', 0o600);
      try {
        await ledger.writeFile(`${JSON.stringify(accepted)}\n`);
        await ledger.sync();
      } finally {
        await ledger.close();
      }
      await send({ type: 'provider.accepted', pid: process.pid, callId: accepted.callId });
      if (command.response === 'accept') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            summary: {
              claimStatus: 'unknown',
              denialReason: null,
              denialCode: null,
              nextAction: 'MANUAL_REVIEW',
              confidence: 0.5,
              repName: null,
              referenceNumber: null,
              callbackDate: null,
              amountApprovedCents: null,
              notes: 'Synthetic review evidence',
            },
            tokensUsed: 37,
            promptVersion: 'v1',
            model: 'synthetic-process-model',
          }),
        );
      }
    })().catch(() => {
      response.writeHead(500).end();
      void send({ type: 'fixture.failed', message: 'Synthetic provider failed.' });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local fixture port.');
  await send({
    type: 'provider.ready',
    pid: process.pid,
    url: `http://127.0.0.1:${String(address.port)}/synthetic-inference`,
  });
}

async function worker(
  command: Extract<InferenceFixtureCommand, { type: 'worker.run' }>,
): Promise<void> {
  const url = new URL(command.providerUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
    throw new Error('Fixture provider must be loopback HTTP.');
  let submissions = 0;
  const summarizer: SummarizerPort = {
    inference: { provider: 'SYNTHETIC', releaseId: 'synthetic-summary.v1' },
    summarize: async (input) => {
      submissions++;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ organizationId: input.organizationId, callId: input.callId }),
      });
      if (!response.ok) throw new Error('Synthetic inference unavailable.');
      return z
        .object({
          summary: SummaryOutputSchema,
          tokensUsed: z.number(),
          promptVersion: z.string(),
          model: z.string(),
        })
        .parse(await response.json());
    },
  };
  const handler = createSummaryJobHandler({
    prisma,
    logger: createLogger({ level: 'fatal', pretty: false }),
    summarizer,
    env: loadSummaryWorkerEnv({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL,
      REDIS_URL: 'redis://127.0.0.1:6379/15',
      SUMMARIZER_DAILY_TOKEN_BUDGET: '1000000',
      SUMMARIZER_AUTO_TRANSITION_ENABLED: 'false',
    }),
  });
  try {
    const result = await handler({ id: command.data.idempotencyKey, data: command.data });
    await send({ type: 'worker.result', pid: process.pid, result, submissions });
  } catch {
    await send({ type: 'worker.error', pid: process.pid, submissions });
  } finally {
    await prisma.$disconnect();
  }
  process.exit(0);
}

const value = await new Promise<unknown>((resolve) => {
  process.once('message', resolve);
});
try {
  const command = CommandSchema.parse(value);
  if (command.type === 'provider.start') await provider(command);
  else await worker(command);
} catch {
  await send({ type: 'fixture.failed', message: 'Synthetic inference fixture failed.' });
  process.exit(1);
}
