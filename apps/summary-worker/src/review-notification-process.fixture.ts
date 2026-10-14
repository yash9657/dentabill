import { randomUUID } from 'node:crypto';
import { open, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

import { prisma } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import {
  ReviewNotificationPayloadSchema,
  validateReviewNotificationSubmission,
  type ReviewNotificationTransport,
} from '@dentabill/notifier';
import { SummaryJobDataSchema } from '@dentabill/queue';
import { FakeClaude } from '@dentabill/summarizer';
import { z } from 'zod';

import { loadSummaryWorkerEnv } from './env.js';
import { createSummaryJobHandler } from './handler.js';
import {
  dispatchReviewNotification,
  type ReviewNotificationDispatchResult,
} from './review-notification-dispatch.js';

const CommandSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('provider.start'),
    ledgerPath: z.string(),
    hold: z.boolean(),
    now: z.string().datetime(),
  }),
  z.object({ type: z.literal('producer.run'), data: SummaryJobDataSchema }),
  z.object({
    type: z.literal('dispatcher.run'),
    organizationId: z.string(),
    notificationId: z.string().uuid(),
    providerUrl: z.string().url(),
    now: z.string().datetime(),
  }),
]);
export type NotificationFixtureCommand = z.infer<typeof CommandSchema>;
export type NotificationFixtureReply =
  | { type: 'provider.ready'; pid: number; url: string }
  | { type: 'provider.accepted'; pid: number; replayed: boolean }
  | { type: 'producer.committed'; pid: number; notificationId: string }
  | {
      type: 'dispatcher.result';
      pid: number;
      result: ReviewNotificationDispatchResult;
      submissions: number;
    }
  | { type: 'fixture.failed'; message: string };

const SubmissionSchema = z
  .object({
    idempotencyKey: z.string(),
    payloadHash: z.string(),
    payload: ReviewNotificationPayloadSchema,
  })
  .strict();
const ReceiptSchema = z
  .object({
    kind: z.literal('SIMULATED'),
    receiptId: z.string(),
    acceptedAt: z.string().datetime(),
  })
  .strict();
const LedgerSchema = z.object({ input: SubmissionSchema, receipt: ReceiptSchema }).strict();

async function send(reply: NotificationFixtureReply): Promise<void> {
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
  command: Extract<NotificationFixtureCommand, { type: 'provider.start' }>,
): Promise<void> {
  // The parent owns this private temporary synthetic-only ledger.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const saved = await readFile(command.ledgerPath, 'utf8');
  const ledger = saved
    .split('\n')
    .filter(Boolean)
    .map((line) => LedgerSchema.parse(JSON.parse(line)));
  let pending = Promise.resolve();
  const server = createServer((request, response) => {
    pending = pending
      .then(async () => {
        if (request.method !== 'POST' || request.url !== '/synthetic-notification') {
          response.writeHead(404).end();
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of request) {
          const buffer = Buffer.from(chunk as Uint8Array);
          bytes += buffer.length;
          if (bytes > 16_384) throw new Error('Fixture request too large.');
          chunks.push(buffer);
        }
        const input = validateReviewNotificationSubmission(
          SubmissionSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))),
        );
        const existing = ledger.find((row) => row.input.idempotencyKey === input.idempotencyKey);
        if (existing && existing.input.payloadHash !== input.payloadHash) {
          response.writeHead(409).end();
          return;
        }
        const accepted = existing ?? {
          input,
          receipt: {
            kind: 'SIMULATED' as const,
            receiptId: `simulated-${randomUUID()}`,
            acceptedAt: command.now,
          },
        };
        if (!existing) {
          // eslint-disable-next-line security/detect-non-literal-fs-filename
          const file = await open(command.ledgerPath, 'a', 0o600);
          try {
            await file.writeFile(`${JSON.stringify(accepted)}\n`);
            await file.sync();
          } finally {
            await file.close();
          }
          ledger.push(accepted);
        }
        await send({ type: 'provider.accepted', pid: process.pid, replayed: !!existing });
        if (!command.hold)
          response
            .writeHead(200, { 'content-type': 'application/json' })
            .end(JSON.stringify(accepted.receipt));
      })
      .catch(() => {
        response.writeHead(500).end();
        void send({ type: 'fixture.failed', message: 'Synthetic notification provider failed.' });
      });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port.');
  await send({
    type: 'provider.ready',
    pid: process.pid,
    url: `http://127.0.0.1:${String(address.port)}/synthetic-notification`,
  });
}

async function produce(
  command: Extract<NotificationFixtureCommand, { type: 'producer.run' }>,
): Promise<void> {
  const summarizer = new FakeClaude();
  summarizer.setDefault('DELTA_DENTAL_PPO', {
    claimStatus: 'unknown',
    denialReason: null,
    denialCode: null,
    nextAction: 'MANUAL_REVIEW',
    confidence: 0.5,
    repName: null,
    referenceNumber: null,
    callbackDate: null,
    amountApprovedCents: null,
    notes: 'PRIVATE-SOURCE-MARKER',
  });
  await createSummaryJobHandler({
    prisma,
    summarizer,
    logger: createLogger({ level: 'fatal', pretty: false }),
    env: loadSummaryWorkerEnv({
      NODE_ENV: 'test',
      DATABASE_URL: process.env.DATABASE_URL,
      REDIS_URL: 'redis://127.0.0.1:6379/15',
    }),
  })({ id: command.data.idempotencyKey, data: command.data });
  const intent = await prisma.reviewNotificationIntent.findFirstOrThrow({
    where: { organizationId: command.data.organizationId, callId: command.data.callId },
  });
  await send({ type: 'producer.committed', pid: process.pid, notificationId: intent.id });
  setInterval(() => undefined, 1000);
}

async function dispatch(
  command: Extract<NotificationFixtureCommand, { type: 'dispatcher.run' }>,
): Promise<void> {
  const url = new URL(command.providerUrl);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1')
    throw new Error('Fixture must use loopback HTTP.');
  let submissions = 0;
  const transport: ReviewNotificationTransport = {
    kind: 'SYNTHETIC',
    async submit(input, signal) {
      submissions++;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
        signal,
      });
      if (!response.ok) throw new Error('Synthetic transport failed.');
      return ReceiptSchema.parse(await response.json());
    },
  };
  const result = await dispatchReviewNotification({
    prisma,
    organizationId: command.organizationId,
    notificationId: command.notificationId,
    transport,
    clock: (): Date => new Date(command.now),
  });
  await send({ type: 'dispatcher.result', pid: process.pid, result, submissions });
  await prisma.$disconnect();
  process.exit(0);
}

try {
  const raw = await new Promise<unknown>((resolve) => process.once('message', resolve));
  const command = CommandSchema.parse(raw);
  if (command.type === 'provider.start') await provider(command);
  else if (command.type === 'producer.run') await produce(command);
  else await dispatch(command);
} catch {
  await send({ type: 'fixture.failed', message: 'Synthetic notification fixture failed.' });
  await prisma.$disconnect();
  process.exit(1);
}
