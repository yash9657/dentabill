/** The deployed entry point must use the durable relay with its actual SQS dispatcher. */
import type * as queueModule from '@dentabill/queue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const seams = vi.hoisted(() => ({
  prisma: { syntheticDatabase: true },
  jobDispatcher: { dispatchCall: vi.fn(), dispatchSummary: vi.fn() },
  relayJobOutbox: vi.fn(),
  createSqsJobDispatcher: vi.fn(),
  createRedisConnection: vi.fn(),
  createSqsRetryScheduler: vi.fn(),
  createInlineJobRuntime: vi.fn(),
  runCallAttempt: vi.fn(),
  runSummaryAttempt: vi.fn(),
}));

vi.mock('@dentabill/call-worker', () => ({ relayJobOutbox: seams.relayJobOutbox }));
vi.mock('@dentabill/db', () => ({ prisma: seams.prisma }));
vi.mock('@dentabill/queue', async (importOriginal) => ({
  ...(await importOriginal<typeof queueModule>()),
  createSqsJobDispatcher: seams.createSqsJobDispatcher,
  createRedisConnection: seams.createRedisConnection,
  createSqsRetryScheduler: seams.createSqsRetryScheduler,
}));
vi.mock('./lib/inline-jobs.js', () => ({
  createInlineJobRuntime: seams.createInlineJobRuntime,
}));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv('JOBS_QUEUE_URL', 'https://sqs.us-east-1.amazonaws.com/000000000000/synthetic-jobs');
  vi.stubEnv('JOBS_MAX_RECEIVE_COUNT', '3');
  vi.stubEnv('REDIS_URL', 'redis://unreachable.invalid:6379');
  vi.stubEnv('LOG_LEVEL', 'fatal');
  seams.createSqsJobDispatcher.mockReturnValue(seams.jobDispatcher);
  seams.createSqsRetryScheduler.mockReturnValue(vi.fn());
  seams.relayJobOutbox.mockResolvedValue({ selected: 2, sent: 2, failed: 0, quarantined: 0 });
  seams.createInlineJobRuntime.mockReturnValue({
    runCallAttempt: seams.runCallAttempt,
    runSummaryAttempt: seams.runSummaryAttempt,
  });
  seams.runSummaryAttempt.mockResolvedValue({ status: 'completed', attempt: 1 });
});

afterEach(() => vi.unstubAllEnvs());

describe('Lambda scheduled relay wiring', () => {
  it('reuses the configured dispatcher and Prisma without loading the voice/summary runtime', async () => {
    const { handler } = await import('./lambda-worker.js');
    const expected = { selected: 2, sent: 2, failed: 0, quarantined: 0 };
    await expect(handler({ type: 'outbox.relay', version: 1 })).resolves.toEqual(expected);
    await expect(handler({ type: 'outbox.relay', version: 1 })).resolves.toEqual(expected);

    expect(seams.createSqsJobDispatcher).toHaveBeenCalledTimes(1);
    expect(seams.createSqsJobDispatcher).toHaveBeenCalledWith({
      queueUrl: 'https://sqs.us-east-1.amazonaws.com/000000000000/synthetic-jobs',
      onDelayClamped: expect.any(Function),
    });
    expect(seams.relayJobOutbox).toHaveBeenCalledTimes(2);
    expect(seams.relayJobOutbox).toHaveBeenLastCalledWith({
      prisma: seams.prisma,
      jobDispatcher: seams.jobDispatcher,
      limit: 25,
      budgetMs: 20_000,
    });
    expect(seams.createInlineJobRuntime).not.toHaveBeenCalled();
    expect(seams.createRedisConnection).not.toHaveBeenCalled();
    expect(seams.createSqsRetryScheduler).not.toHaveBeenCalled();
    expect(seams.jobDispatcher.dispatchCall).not.toHaveBeenCalled();
    expect(seams.jobDispatcher.dispatchSummary).not.toHaveBeenCalled();
  });

  it('lazily builds the SQS runtime once after a relay tick, keeping batch acknowledgement behavior', async () => {
    const { handler } = await import('./lambda-worker.js');
    await handler({ type: 'outbox.relay', version: 1 });
    const data = {
      organizationId: 'org_synthetic',
      callId: 'call_synthetic',
      promptVersion: 'v1',
      idempotencyKey: 'call.call_synthetic',
    };
    const event = {
      Records: [
        {
          eventSource: 'aws:sqs',
          messageId: 'm-synthetic',
          receiptHandle: 'rh-synthetic',
          body: JSON.stringify({ type: 'summary.generate', data }),
          attributes: { ApproximateReceiveCount: '1' },
        },
      ],
    };
    await expect(handler(event)).resolves.toEqual({ batchItemFailures: [] });
    await expect(handler(event)).resolves.toEqual({ batchItemFailures: [] });
    expect(seams.relayJobOutbox).toHaveBeenCalledTimes(1);
    expect(seams.createSqsJobDispatcher).toHaveBeenCalledTimes(1);
    expect(seams.createInlineJobRuntime).toHaveBeenCalledTimes(1);
    expect(seams.createInlineJobRuntime).toHaveBeenCalledWith(
      expect.objectContaining({
        jobDispatcher: seams.jobDispatcher,
      }),
    );
    expect(seams.runSummaryAttempt).toHaveBeenCalledTimes(2);
    expect(seams.runSummaryAttempt).toHaveBeenLastCalledWith(data, { attempt: 1, maxAttempts: 3 });
    expect(seams.runCallAttempt).not.toHaveBeenCalled();
  });
});
