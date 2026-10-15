import { describe, expect, it, vi } from 'vitest';

import { createBullMqJobDispatcher, parseJobDispatchMode } from './dispatcher.js';
import {
  computeBackoffMs,
  createInlineJobDispatcher,
  INTERNAL_JOB_ROUTES,
  INTERNAL_JOB_SECRET_HEADER,
  runInlineJob,
} from './inline.js';
import { CALLS_DEFAULT_JOB_OPTIONS, SUMMARIES_DEFAULT_JOB_OPTIONS } from './queues.js';
import type { CallJobData, SummaryJobData } from './types.js';

const callData: CallJobData = {
  organizationId: 'org_1',
  claimId: 'claim_1',
  payerCode: 'DELTA_DENTAL_PPO',
  attemptNumber: 1,
  claimPriority: 80,
  idempotencyKey: 'claim_1-a1-xyz',
};

const summaryData: SummaryJobData = {
  organizationId: 'org_1',
  callId: 'call_1',
  promptVersion: 'v1',
  idempotencyKey: 'call.call_1',
};

describe('parseJobDispatchMode', () => {
  it('defaults to bullmq when unset or empty', () => {
    expect(parseJobDispatchMode(undefined)).toBe('bullmq');
    expect(parseJobDispatchMode('')).toBe('bullmq');
  });

  it('accepts inline / bullmq / sqs case-insensitively', () => {
    expect(parseJobDispatchMode('INLINE')).toBe('inline');
    expect(parseJobDispatchMode(' SQS ')).toBe('sqs');
    expect(parseJobDispatchMode('bullmq')).toBe('bullmq');
  });

  it('rejects anything else', () => {
    expect(() => parseJobDispatchMode('kafka')).toThrow(/JOB_DISPATCH_MODE/);
  });
});

describe('createBullMqJobDispatcher', () => {
  it('adds call jobs with jobId = idempotencyKey and the given priority', async () => {
    const add = vi.fn(async () => ({ id: callData.idempotencyKey }));
    const dispatcher = createBullMqJobDispatcher({ callsQueue: { add } as never });
    const id = await dispatcher.dispatchCall(callData, { priority: 21 });
    expect(id).toBe(callData.idempotencyKey);
    expect(add).toHaveBeenCalledWith('call.place', callData, {
      jobId: callData.idempotencyKey,
      priority: 21,
    });
  });

  it('adds summary jobs with jobId = idempotencyKey', async () => {
    const add = vi.fn(async () => ({ id: undefined }));
    const dispatcher = createBullMqJobDispatcher({ summariesQueue: { add } as never });
    await expect(dispatcher.dispatchSummary(summaryData)).resolves.toBe('call.call_1');
    expect(add).toHaveBeenCalledWith('summary.generate', summaryData, { jobId: 'call.call_1' });
  });

  it('passes a positive delayMs through as the BullMQ delay', async () => {
    const add = vi.fn(async () => ({ id: 'x' }));
    const dispatcher = createBullMqJobDispatcher({
      callsQueue: { add } as never,
      summariesQueue: { add } as never,
    });
    await dispatcher.dispatchCall(callData, { delayMs: 5_000 });
    await dispatcher.dispatchSummary(summaryData, { delayMs: 0 });
    expect(add).toHaveBeenNthCalledWith(1, 'call.place', callData, {
      jobId: callData.idempotencyKey,
      delay: 5_000,
    });
    expect(add).toHaveBeenNthCalledWith(2, 'summary.generate', summaryData, {
      jobId: 'call.call_1',
    });
  });

  it('throws when the target queue is not configured', async () => {
    const dispatcher = createBullMqJobDispatcher({});
    await expect(dispatcher.dispatchCall(callData)).rejects.toThrow(/calls queue/);
  });
});

describe('createInlineJobDispatcher', () => {
  const receipt = (jobId: string): Response =>
    Response.json({ accepted: true, jobId }, { status: 200 });

  it('POSTs the payload to the internal route with the secret header, via waitUntil', async () => {
    const fetchMock = vi.fn(async () => receipt(callData.idempotencyKey));
    const pending: Promise<unknown>[] = [];
    const dispatcher = createInlineJobDispatcher({
      baseUrl: 'https://api.example.com/',
      secret: 's3cret-value-of-sufficient-length',
      waitUntil: (p) => pending.push(p),
      fetch: fetchMock,
    });

    const id = await dispatcher.dispatchCall(callData);
    expect(id).toBe(callData.idempotencyKey);
    expect(pending).toHaveLength(1);
    await Promise.all(pending);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.example.com${INTERNAL_JOB_ROUTES.calls}`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)[INTERNAL_JOB_SECRET_HEADER]).toBe(
      's3cret-value-of-sufficient-length',
    );
    expect(JSON.parse(init.body as string)).toEqual(callData);
  });

  it('routes summaries to the summaries route', async () => {
    const fetchMock = vi.fn(async () => receipt(summaryData.idempotencyKey));
    const pending: Promise<unknown>[] = [];
    const dispatcher = createInlineJobDispatcher({
      baseUrl: 'http://localhost:3001',
      secret: 'x'.repeat(32),
      waitUntil: (p) => pending.push(p),
      fetch: fetchMock,
    });
    await dispatcher.dispatchSummary(summaryData);
    await Promise.all(pending);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe(`http://localhost:3001${INTERNAL_JOB_ROUTES.summaries}`);
  });

  it('retries the trigger on 5xx / network errors, then reports via onTriggerError', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('ECONNRESET'))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 502 }));
    const onTriggerError = vi.fn();
    const pending: Promise<unknown>[] = [];
    const dispatcher = createInlineJobDispatcher({
      baseUrl: 'http://localhost:3001',
      secret: 'x'.repeat(32),
      waitUntil: (p) => pending.push(p),
      fetch: fetchMock,
      triggerRetryDelayMs: 0,
      onTriggerError,
    });
    await expect(dispatcher.dispatchCall(callData)).rejects.toThrow(/HTTP 502/);
    await Promise.all(pending);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onTriggerError).toHaveBeenCalledTimes(1);
    expect(onTriggerError.mock.calls[0]?.[1]).toEqual({
      kind: 'calls',
      jobId: callData.idempotencyKey,
    });
  });

  it('does not retry a 4xx (bad secret) and never rejects the waitUntil promise', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 401 }));
    const onTriggerError = vi.fn();
    const pending: Promise<unknown>[] = [];
    const dispatcher = createInlineJobDispatcher({
      baseUrl: 'http://localhost:3001',
      secret: 'x'.repeat(32),
      waitUntil: (p) => pending.push(p),
      fetch: fetchMock,
      triggerRetryDelayMs: 0,
      onTriggerError,
    });
    await expect(dispatcher.dispatchCall(callData)).rejects.toThrow(/HTTP 401/);
    await expect(Promise.all(pending)).resolves.toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(onTriggerError).toHaveBeenCalledTimes(1);
  });

  it('keeps dispatch pending until the matching completed receipt arrives', async () => {
    let resolveResponse: ((value: Response) => void) | undefined;
    const response = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const waitUntil = vi.fn();
    const dispatcher = createInlineJobDispatcher({
      baseUrl: 'http://localhost:3001',
      secret: 'x'.repeat(32),
      waitUntil,
      fetch: vi.fn(() => response),
    });
    let settled = false;
    const dispatch = dispatcher.dispatchCall(callData).finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(waitUntil).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    if (!resolveResponse) throw new Error('Expected response barrier.');
    resolveResponse(receipt(callData.idempotencyKey));
    await expect(dispatch).resolves.toBe(callData.idempotencyKey);
  });

  it.each([
    ['early acknowledgement', 202, { accepted: true, jobId: callData.idempotencyKey }],
    ['missing receipt', 200, {}],
    ['different job', 200, { accepted: true, jobId: 'other-job' }],
    ['unaccepted job', 200, { accepted: false, jobId: callData.idempotencyKey }],
  ])('rejects %s without reporting delivery', async (_name, status, body) => {
    const fetchMock = vi.fn(async () => Response.json(body, { status }));
    const dispatcher = createInlineJobDispatcher({
      baseUrl: 'http://localhost:3001',
      secret: 'x'.repeat(32),
      waitUntil: () => undefined,
      fetch: fetchMock,
    });
    await expect(dispatcher.dispatchCall(callData)).rejects.toThrow(/unconfirmed/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a lost response with the identical payload and key', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error('response lost after acceptance'))
      .mockResolvedValueOnce(receipt(callData.idempotencyKey));
    const dispatcher = createInlineJobDispatcher({
      baseUrl: 'http://localhost:3001',
      secret: 'x'.repeat(32),
      waitUntil: () => undefined,
      fetch: fetchMock,
      triggerRetryDelayMs: 0,
    });
    await expect(dispatcher.dispatchCall(callData)).resolves.toBe(callData.idempotencyKey);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([, init]) => init?.body)).toEqual([
      JSON.stringify(callData),
      JSON.stringify(callData),
    ]);
  });

  it('sanitizes transport and parser errors before returning or logging them', async () => {
    const privateText = 'synthetic-sensitive-response-do-not-log';
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error(privateText))
      .mockResolvedValueOnce(new Response(privateText, { status: 200 }));
    const onTriggerError = vi.fn();
    const dispatcher = createInlineJobDispatcher({
      baseUrl: 'http://localhost:3001',
      secret: 'x'.repeat(32),
      waitUntil: () => undefined,
      fetch: fetchMock,
      triggerAttempts: 2,
      triggerRetryDelayMs: 0,
      onTriggerError,
    });
    await expect(dispatcher.dispatchCall(callData)).rejects.toThrow(
      'Inline job completion is unconfirmed.',
    );
    expect(onTriggerError).toHaveBeenCalledTimes(1);
    expect(String(onTriggerError.mock.calls[0]?.[0])).not.toContain(privateText);
  });

  it.each(['response', 'receipt body'] as const)(
    'bounds a stalled %s and aborts without a delivery receipt',
    async (stage) => {
      const fetchMock = vi.fn<typeof fetch>(async () =>
        stage === 'response'
          ? new Promise<Response>(() => undefined)
          : new Response(new ReadableStream<Uint8Array>(), { status: 200 }),
      );
      const pending: Promise<unknown>[] = [];
      const dispatcher = createInlineJobDispatcher({
        baseUrl: 'http://localhost:3001',
        secret: 'x'.repeat(32),
        waitUntil: (promise) => pending.push(promise),
        fetch: fetchMock,
        triggerAttempts: 1,
        triggerTimeoutMs: 20,
      });
      await expect(dispatcher.dispatchSummary(summaryData)).rejects.toThrow(/unconfirmed/);
      expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
      await expect(Promise.all(pending)).resolves.toBeDefined();
    },
  );
});

describe('computeBackoffMs', () => {
  it('matches BullMQ exponential: delay · 2^(attemptsMade-1)', () => {
    expect(computeBackoffMs(CALLS_DEFAULT_JOB_OPTIONS.backoff, 1)).toBe(30_000);
    expect(computeBackoffMs(CALLS_DEFAULT_JOB_OPTIONS.backoff, 2)).toBe(60_000);
    expect(computeBackoffMs(SUMMARIES_DEFAULT_JOB_OPTIONS.backoff, 1)).toBe(15_000);
  });

  it('handles fixed, numeric and absent backoff', () => {
    expect(computeBackoffMs({ type: 'fixed', delay: 500 }, 3)).toBe(500);
    expect(computeBackoffMs(250, 2)).toBe(250);
    expect(computeBackoffMs(undefined, 2)).toBe(0);
  });
});

describe('runInlineJob', () => {
  it('passes a Job-like object (id, name, data, attemptsMade) to the processor', async () => {
    const process = vi.fn(async () => 'ok');
    const outcome = await runInlineJob({
      id: 'job-1',
      name: 'call.place',
      data: callData,
      jobOptions: CALLS_DEFAULT_JOB_OPTIONS,
      process,
      budgetMs: 1_000,
    });
    expect(outcome).toEqual({ status: 'completed', result: 'ok', attemptsMade: 1 });
    expect(process).toHaveBeenCalledWith({
      id: 'job-1',
      name: 'call.place',
      data: callData,
      attemptsMade: 0,
    });
  });

  it('retries up to `attempts` with BullMQ backoff, then fails', async () => {
    const sleeps: number[] = [];
    const process = vi.fn(async () => {
      throw new Error('boom');
    });
    const onAttemptFailed = vi.fn();
    const outcome = await runInlineJob({
      id: 'job-2',
      name: 'call.place',
      data: callData,
      jobOptions: CALLS_DEFAULT_JOB_OPTIONS,
      process,
      budgetMs: 10 * 60_000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      now: () => 0,
      onAttemptFailed,
    });
    expect(process).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([30_000, 60_000]);
    expect(onAttemptFailed).toHaveBeenCalledTimes(3);
    expect(outcome.status).toBe('failed');
    expect(outcome).toMatchObject({ attemptsMade: 3, budgetExhausted: false });
  });

  it('succeeds on a later attempt', async () => {
    const process = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('done');
    const outcome = await runInlineJob({
      id: 'job-3',
      name: 'summary.generate',
      data: summaryData,
      jobOptions: SUMMARIES_DEFAULT_JOB_OPTIONS,
      process,
      budgetMs: 60_000,
      sleep: async () => undefined,
      now: () => 0,
    });
    expect(outcome).toEqual({ status: 'completed', result: 'done', attemptsMade: 2 });
  });

  it('stops retrying when the next backoff would overrun the budget', async () => {
    const process = vi.fn(async () => {
      throw new Error('boom');
    });
    const outcome = await runInlineJob({
      id: 'job-4',
      name: 'call.place',
      data: callData,
      jobOptions: CALLS_DEFAULT_JOB_OPTIONS,
      process,
      budgetMs: 10_000,
      sleep: async () => undefined,
      now: () => 0,
    });
    expect(process).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ status: 'failed', attemptsMade: 1, budgetExhausted: true });
  });
});
