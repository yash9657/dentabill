import { randomUUID } from 'node:crypto';

import type { SendMessageCommand } from '@aws-sdk/client-sqs';
import { Queue, Worker } from 'bullmq';
import { describe, expect, it, vi } from 'vitest';

import { createRedisConnection } from './connection.js';
import { createBullMqJobDispatcher, TransportJobIdSchema } from './dispatcher.js';
import { createInlineJobDispatcher, INTERNAL_JOB_TRANSPORT_HEADER } from './inline.js';
import { createSqsJobDispatcher, parseSqsJobMessage } from './sqs.js';
import {
  CALL_JOB_NAME,
  SUMMARY_JOB_NAME,
  type CallJobData,
  type CallJobName,
  type CallJobResult,
  type SummaryJobData,
} from './types.js';

const data: CallJobData = {
  organizationId: 'synthetic_org',
  claimId: 'synthetic_claim',
  payerCode: 'DELTA_DENTAL_PPO',
  attemptNumber: 1,
  claimPriority: 80,
  idempotencyKey: 'synthetic-domain-command',
};
const completed: CallJobResult = {
  outcome: 'COMPLETED',
  callId: 'synthetic_call',
  retellCallId: null,
  durationSeconds: 0,
};
const summaryData: SummaryJobData = {
  organizationId: data.organizationId,
  callId: 'synthetic_call',
  idempotencyKey: 'call.synthetic_call',
  promptVersion: 'v1',
};

describe('recovery transport identity', () => {
  it.each(['failed', 'completed'] as const)(
    'runs a recovery generation while retaining the %s original BullMQ job',
    async (originalState) => {
      const connection = createRedisConnection(
        process.env.QUEUE_TEST_REDIS_URL ?? 'redis://localhost:6379/13',
      );
      const name = `synthetic-recovery-${randomUUID()}`;
      const queue = new Queue<CallJobData, CallJobResult, CallJobName>(name, {
        connection,
        defaultJobOptions: { attempts: 1, removeOnFail: false, removeOnComplete: false },
      });
      const received: { id: string | undefined; data: CallJobData }[] = [];
      const worker = new Worker<CallJobData, CallJobResult, CallJobName>(
        name,
        async (job) => {
          received.push({ id: job.id, data: job.data });
          if (job.id === data.idempotencyKey && originalState === 'failed')
            throw new Error('Synthetic retained failure.');
          return completed;
        },
        { connection },
      );
      try {
        await connection.ping();
        await worker.waitUntilReady();
        const dispatcher = createBullMqJobDispatcher({ callsQueue: queue });
        expect(await dispatcher.dispatchCall(data)).toBe(data.idempotencyKey);
        await vi.waitFor(async () => {
          expect(await (await queue.getJob(data.idempotencyKey))?.getState()).toBe(originalState);
        });
        await dispatcher.dispatchCall(data);
        expect(await queue.getWaitingCount()).toBe(0);
        expect(received).toEqual([{ id: data.idempotencyKey, data }]);
        const transportJobId = 'outbox.synthetic.recovery.1';
        expect(await dispatcher.dispatchCall(data, { transportJobId })).toBe(transportJobId);
        await vi.waitFor(async () => {
          expect(await (await queue.getJob(transportJobId))?.getState()).toBe('completed');
        });
        await dispatcher.dispatchCall(data, { transportJobId });
        expect(received).toEqual([
          { id: data.idempotencyKey, data },
          { id: transportJobId, data },
        ]);
        expect(await (await queue.getJob(data.idempotencyKey))?.getState()).toBe(originalState);
        expect(await queue.getJobCounts('completed', 'failed', 'waiting', 'active')).toMatchObject({
          completed: originalState === 'completed' ? 2 : 1,
          failed: originalState === 'failed' ? 1 : 0,
          waiting: 0,
          active: 0,
        });
      } finally {
        await worker.close();
        await queue.obliterate({ force: true });
        await queue.close();
        connection.disconnect();
      }
    },
    10_000,
  );

  it.each(['call', 'summary'] as const)(
    'carries the %s generation separately through SQS and inline',
    async (kind) => {
      const commandData = kind === 'call' ? data : summaryData;
      const type = kind === 'call' ? CALL_JOB_NAME : SUMMARY_JOB_NAME;
      const sent = vi.fn(async (_command: SendMessageCommand) => ({
        MessageId: 'synthetic_receipt',
      }));
      const sqs = createSqsJobDispatcher({
        queueUrl: 'https://sqs.example.invalid/synthetic',
        client: { send: sent },
      });
      const fetchMock = vi.fn<typeof fetch>(async () =>
        Response.json({ accepted: true, jobId: commandData.idempotencyKey }),
      );
      const inline = createInlineJobDispatcher({
        baseUrl: 'http://127.0.0.1:1',
        secret: 'synthetic-secret-with-sufficient-length',
        waitUntil: () => undefined,
        fetch: fetchMock,
      });
      const options = { transportJobId: 'outbox.synthetic.recovery.2' };
      for (const dispatcher of [sqs, inline]) {
        expect(
          await (kind === 'call'
            ? dispatcher.dispatchCall(data, options)
            : dispatcher.dispatchSummary(summaryData, options)),
        ).toBe(commandData.idempotencyKey);
      }
      expect(parseSqsJobMessage(sent.mock.calls[0]?.[0].input.MessageBody ?? '')).toEqual({
        type,
        data: commandData,
        transportJobId: options.transportJobId,
      });
      const body = fetchMock.mock.calls[0]?.[1]?.body;
      expect(body).toBe(JSON.stringify(commandData));
      expect(
        new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get(INTERNAL_JOB_TRANSPORT_HEADER),
      ).toBe(options.transportJobId);
      expect(sent.mock.calls[0]?.[0].input.MessageAttributes?.idempotencyKey?.StringValue).toBe(
        commandData.idempotencyKey,
      );
    },
  );

  it.each([
    '',
    'outbox.synthetic.recovery.0',
    'outbox.synthetic.recovery.01',
    'outbox.synthetic.recovery.2147483648',
    'outbox.synthetic.recovery.1.extra',
    `outbox.${'a'.repeat(129)}.recovery.1`,
  ])(
    'rejects invalid transport identity %s before any dispatcher effect',
    async (transportJobId) => {
      const add = vi.fn();
      const send = vi.fn();
      const fetchMock = vi.fn<typeof fetch>();
      const waitUntil = vi.fn();
      const dispatchers = [
        createBullMqJobDispatcher({ callsQueue: { add }, summariesQueue: { add } }),
        createSqsJobDispatcher({
          queueUrl: 'https://sqs.example.invalid/synthetic',
          client: { send },
        }),
        createInlineJobDispatcher({
          baseUrl: 'http://127.0.0.1:1',
          secret: 'synthetic-secret-with-sufficient-length',
          fetch: fetchMock,
          waitUntil,
        }),
      ];
      for (const dispatcher of dispatchers) {
        await expect(dispatcher.dispatchCall(data, { transportJobId })).rejects.toThrow();
        await expect(dispatcher.dispatchSummary(summaryData, { transportJobId })).rejects.toThrow();
      }
      expect(add).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(waitUntil).not.toHaveBeenCalled();
      expect(() =>
        parseSqsJobMessage(JSON.stringify({ type: CALL_JOB_NAME, data, transportJobId })),
      ).toThrow();
    },
  );

  it('accepts the bounded generation and rejects unknown envelope fields', () => {
    const transportJobId = `outbox.${'a'.repeat(128)}.recovery.2147483647`;
    expect(TransportJobIdSchema.parse(transportJobId)).toBe(transportJobId);
    expect(() =>
      parseSqsJobMessage(
        JSON.stringify({ type: CALL_JOB_NAME, data, transportJobId, generation: 1 }),
      ),
    ).toThrow();
  });

  it('omits provenance for original dispatches and prevents extra headers from injecting a generation', async () => {
    const send = vi.fn(async (_command: SendMessageCommand) => ({}));
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ accepted: true, jobId: data.idempotencyKey }),
    );
    const sqs = createSqsJobDispatcher({
      queueUrl: 'https://sqs.example.invalid/synthetic',
      client: { send },
    });
    const inline = createInlineJobDispatcher({
      baseUrl: 'http://127.0.0.1:1',
      secret: 'synthetic-secret-with-sufficient-length',
      fetch: fetchMock,
      waitUntil: () => undefined,
      headers: { 'X-DentaBill-Transport-Job-Id': 'outbox.injected.recovery.1' },
    });
    await sqs.dispatchCall(data);
    await inline.dispatchCall(data);
    expect(parseSqsJobMessage(send.mock.calls[0]?.[0].input.MessageBody ?? '')).toEqual({
      type: CALL_JOB_NAME,
      data,
    });
    expect(
      new Headers(fetchMock.mock.calls[0]?.[1]?.headers).has(INTERNAL_JOB_TRANSPORT_HEADER),
    ).toBe(false);
    await inline.dispatchCall(data, { transportJobId: 'outbox.approved.recovery.2' });
    expect(
      new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get(INTERNAL_JOB_TRANSPORT_HEADER),
    ).toBe('outbox.approved.recovery.2');
  });
});
