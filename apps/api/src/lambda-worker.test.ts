/**
 * SQS worker retry / DLQ decision logic (ADR-053, sqs mode). The runtime is
 * faked — its DB behaviour is covered in lib/inline-jobs.test.ts.
 */
import { createLogger } from '@dentabill/logger';
import type { CallJobData, SummaryJobData } from '@dentabill/queue';
import { describe, expect, it, vi } from 'vitest';

import {
  createLambdaJobWorker,
  createSqsJobWorker,
  decide,
  processRecord,
  receiveAttempt,
  type LambdaJobWorkerDeps,
  type SqsJobWorkerDeps,
  type SqsRecord,
} from './lambda-worker.js';
import type { AttemptReport, InlineJobRuntime } from './lib/inline-jobs.js';

const logger = createLogger({ level: 'fatal', pretty: false, base: { service: 'test' } });

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

function record(body: unknown, receiveCount: string | null = '1', id = 'm-1'): SqsRecord {
  return {
    messageId: id,
    receiptHandle: `rh-${id}`,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    attributes: receiveCount === null ? {} : { ApproximateReceiveCount: receiveCount },
  };
}

function deps(
  callReport: AttemptReport | Error,
  summaryReport: AttemptReport | Error = { status: 'completed', attempt: 1 },
): SqsJobWorkerDeps & {
  runtime: {
    runCallAttempt: ReturnType<typeof vi.fn<InlineJobRuntime['runCallAttempt']>>;
    runSummaryAttempt: ReturnType<typeof vi.fn<InlineJobRuntime['runSummaryAttempt']>>;
  };
  scheduleRetry: ReturnType<typeof vi.fn<NonNullable<SqsJobWorkerDeps['scheduleRetry']>>>;
} {
  const settle = (r: AttemptReport | Error): Promise<AttemptReport> =>
    r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  return {
    logger,
    maxReceiveCount: 3,
    runtime: {
      runCallAttempt: vi.fn<InlineJobRuntime['runCallAttempt']>(() => settle(callReport)),
      runSummaryAttempt: vi.fn<InlineJobRuntime['runSummaryAttempt']>(() => settle(summaryReport)),
    },
    scheduleRetry: vi.fn<NonNullable<SqsJobWorkerDeps['scheduleRetry']>>(async () => undefined),
  };
}

describe('receiveAttempt', () => {
  it('uses ApproximateReceiveCount, defaulting to 1', () => {
    expect(receiveAttempt(record({}, '2'))).toBe(2);
    expect(receiveAttempt(record({}, null))).toBe(1);
    expect(receiveAttempt(record({}, 'garbage'))).toBe(1);
    expect(receiveAttempt(record({}, '0'))).toBe(1);
  });
});

describe('createLambdaJobWorker', () => {
  function lambdaDeps() {
    return {
      logger: createLogger({ level: 'fatal', pretty: false }),
      sqsWorker: vi.fn<LambdaJobWorkerDeps['sqsWorker']>().mockResolvedValue({
        batchItemFailures: [{ itemIdentifier: 'retry-me' }],
      }),
      relayOutbox: vi.fn<LambdaJobWorkerDeps['relayOutbox']>().mockResolvedValue({
        selected: 3,
        sent: 1,
        failed: 1,
        quarantined: 1,
      }),
    };
  }

  it('runs one bounded relay sweep and logs only counters', async () => {
    const d = lambdaDeps();
    const warn = vi.spyOn(d.logger, 'warn');
    // Runtime extras must not leak through the response or logs.
    d.relayOutbox.mockResolvedValue({
      selected: 3,
      sent: 1,
      failed: 1,
      quarantined: 1,
      ...{ payload: { patientName: 'Synthetic private patient' } },
    });
    const worker = createLambdaJobWorker(d);
    await expect(worker({ type: 'outbox.relay', version: 1 })).resolves.toEqual({
      selected: 3,
      sent: 1,
      failed: 1,
      quarantined: 1,
    });
    expect(d.relayOutbox).toHaveBeenCalledTimes(1);
    expect(d.relayOutbox).toHaveBeenCalledWith({ limit: 25, budgetMs: 20_000 });
    expect(d.sqsWorker).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      { selected: 3, sent: 1, failed: 1, quarantined: 1 },
      'outbox relay sweep completed',
    );
  });

  it('reports an idle successful sweep without tenant or job identifiers', async () => {
    const d = lambdaDeps();
    const info = vi.spyOn(d.logger, 'info');
    const counts = { selected: 0, sent: 0, failed: 0, quarantined: 0 };
    d.relayOutbox.mockResolvedValue(counts);
    await expect(createLambdaJobWorker(d)({ type: 'outbox.relay', version: 1 })).resolves.toEqual(
      counts,
    );
    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(counts, 'outbox relay sweep completed');
  });

  it('fails the invocation on relay infrastructure failure without exposing its error', async () => {
    const d = lambdaDeps();
    const error = vi.spyOn(d.logger, 'error');
    d.relayOutbox.mockRejectedValue(new Error('DB query contains synthetic private patient'));
    await expect(createLambdaJobWorker(d)({ type: 'outbox.relay', version: 1 })).rejects.toThrow(
      'lambda-worker: outbox relay sweep failed',
    );
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      { code: 'OUTBOX_RELAY_FAILED' },
      'outbox relay sweep failed',
    );
    expect(d.sqsWorker).not.toHaveBeenCalled();
  });

  it.each([
    null,
    {},
    { type: 'outbox.relay' },
    { type: 'outbox.relay', version: 2 },
    { type: 'outbox.relay', version: '1' },
    { type: 'outbox.relay', version: 1, organizationId: 'org_injected' },
    { type: 'outbox.relay', version: 1, limit: 10_000 },
    { type: 'outbox.relay', version: 1, budgetMs: 900_000 },
    { type: 'outbox.relay', version: 1, Records: [] },
    { Records: 'invalid' },
    { Records: [{ ...record('body'), eventSource: 'aws:sns' }] },
    { Records: [{ ...record('body'), eventSource: 'aws:sqs', receiptHandle: null }] },
  ])('rejects unsupported or caller-configured envelopes (%j)', async (event) => {
    const d = lambdaDeps();
    await expect(createLambdaJobWorker(d)(event)).rejects.toThrow(
      'lambda-worker: unsupported invocation envelope',
    );
    expect(d.relayOutbox).not.toHaveBeenCalled();
    expect(d.sqsWorker).not.toHaveBeenCalled();
  });

  it('preserves the SQS envelope and partial failure response', async () => {
    const d = lambdaDeps();
    const event = {
      Records: [
        {
          ...record({ type: 'call.place', data: callData }),
          eventSource: 'aws:sqs',
          eventSourceARN: 'arn:aws:sqs:us-east-1:000000000000:synthetic-jobs',
          awsRegion: 'us-east-1',
          attributes: { ApproximateReceiveCount: '2', SentTimestamp: '1700000000000' },
          messageAttributes: {},
        },
      ],
    };
    await expect(createLambdaJobWorker(d)(event)).resolves.toEqual({
      batchItemFailures: [{ itemIdentifier: 'retry-me' }],
    });
    expect(d.sqsWorker).toHaveBeenCalledTimes(1);
    expect(d.sqsWorker).toHaveBeenCalledWith(event);
    expect(d.relayOutbox).not.toHaveBeenCalled();
  });

  it('does not allow an SQS message body to request a global relay', async () => {
    const d = lambdaDeps();
    const sqsDeps = deps({ status: 'completed', attempt: 1 });
    const worker = createLambdaJobWorker({ ...d, sqsWorker: createSqsJobWorker(sqsDeps) });
    await expect(
      worker({
        Records: [{ ...record({ type: 'outbox.relay', version: 1 }), eventSource: 'aws:sqs' }],
      }),
    ).resolves.toEqual({ batchItemFailures: [{ itemIdentifier: 'm-1' }] });
    expect(d.relayOutbox).not.toHaveBeenCalled();
    expect(sqsDeps.runtime.runCallAttempt).not.toHaveBeenCalled();
    expect(sqsDeps.runtime.runSummaryAttempt).not.toHaveBeenCalled();
  });
});

describe('decide', () => {
  it('keeps retry reports and calls whose terminal persistence failed', () => {
    expect(decide({ status: 'completed', attempt: 1 })).toBe('delete');
    expect(decide({ status: 'skipped', reason: 'summary_exists' })).toBe('delete');
    expect(
      decide({
        status: 'blocked',
        reason: 'MISSING_CALL_IDENTITY',
        missingFields: ['subscriberId'],
        attempt: 1,
      }),
    ).toBe('delete');
    expect(decide({ status: 'failed', attempt: 3, dlq: true })).toBe('delete');
    expect(decide({ status: 'failed', attempt: 3, dlq: false })).toBe('retry');
    expect(decide({ status: 'failed', attempt: 3, dlq: false }, 'summary.generate')).toBe('delete');
    expect(decide({ status: 'reconciliation_required', attempt: 3 })).toBe('delete');
    expect(decide({ status: 'retry', attempt: 1, retryDelayMs: 30_000, error: null })).toBe(
      'retry',
    );
  });
});

describe('processRecord', () => {
  it('routes call messages with the receive count as the attempt number', async () => {
    const d = deps({ status: 'completed', attempt: 2 });
    await expect(
      processRecord(record({ type: 'call.place', data: callData }, '2'), d),
    ).resolves.toBe('delete');
    expect(d.runtime.runCallAttempt).toHaveBeenCalledWith(callData, {
      attempt: 2,
      maxAttempts: 3,
    });
    expect(d.runtime.runSummaryAttempt).not.toHaveBeenCalled();
  });

  it('routes summary messages to the summary runtime', async () => {
    const d = deps({ status: 'completed', attempt: 1 });
    await processRecord(record({ type: 'summary.generate', data: summaryData }), d);
    expect(d.runtime.runSummaryAttempt).toHaveBeenCalledWith(summaryData, {
      attempt: 1,
      maxAttempts: 3,
    });
  });

  it('a failure with attempts left is retried after the job backoff', async () => {
    const d = deps({ status: 'retry', attempt: 1, retryDelayMs: 30_000, error: new Error('x') });
    await expect(processRecord(record({ type: 'call.place', data: callData }), d)).resolves.toBe(
      'retry',
    );
    expect(d.scheduleRetry).toHaveBeenCalledWith('rh-m-1', 30);
  });

  it('a retry still happens when the visibility change fails', async () => {
    const d = deps({ status: 'retry', attempt: 2, retryDelayMs: 60_000, error: null });
    d.scheduleRetry.mockRejectedValueOnce(new Error('AccessDenied'));
    await expect(
      processRecord(record({ type: 'call.place', data: callData }, '2'), d),
    ).resolves.toBe('retry');
  });

  it('the final attempt (terminal hand-off done by the runtime) deletes the message', async () => {
    const d = deps({ status: 'failed', attempt: 3, dlq: true });
    await expect(
      processRecord(record({ type: 'call.place', data: callData }, '3'), d),
    ).resolves.toBe('delete');
    expect(d.runtime.runCallAttempt).toHaveBeenCalledWith(callData, {
      attempt: 3,
      maxAttempts: 3,
    });
    expect(d.scheduleRetry).not.toHaveBeenCalled();
  });

  it('duplicates skipped by the DB checks are deleted', async () => {
    const d = deps({ status: 'skipped', reason: 'call_intent_already_processed' });
    await expect(processRecord(record({ type: 'call.place', data: callData }), d)).resolves.toBe(
      'delete',
    );
  });

  it('acknowledges persisted uncertainty without scheduling a fresh submission', async () => {
    const d = deps({ status: 'reconciliation_required', attempt: 3 });
    await expect(
      processRecord(record({ type: 'call.place', data: callData }, '3'), d),
    ).resolves.toBe('delete');
    expect(d.scheduleRetry).not.toHaveBeenCalled();
  });

  it('does not acknowledge a call when its final failure could not be persisted', async () => {
    const d = deps({ status: 'failed', attempt: 3, dlq: false });
    await expect(
      processRecord(record({ type: 'call.place', data: callData }, '3'), d),
    ).resolves.toBe('retry');
  });

  it('preserves summary exhaustion behavior without a call DLQ', async () => {
    const d = deps(
      { status: 'completed', attempt: 1 },
      { status: 'failed', attempt: 3, dlq: false },
    );
    await expect(
      processRecord(record({ type: 'summary.generate', data: summaryData }, '3'), d),
    ).resolves.toBe('delete');
  });

  it('invalid bodies are left for the SQS DLQ without running anything', async () => {
    const d = deps({ status: 'completed', attempt: 1 });
    await expect(processRecord(record('{nope'), d)).resolves.toBe('retry');
    await expect(processRecord(record({ type: 'call.place', data: {} }), d)).resolves.toBe('retry');
    expect(d.runtime.runCallAttempt).not.toHaveBeenCalled();
    expect(d.scheduleRetry).not.toHaveBeenCalled();
  });

  it('a crash outside the processor is never deleted, even on the final attempt', async () => {
    const d = deps(new Error('db down'));
    await expect(
      processRecord(record({ type: 'call.place', data: callData }, '3'), d),
    ).resolves.toBe('retry');
  });
});

describe('createSqsJobWorker', () => {
  it('reports only the records that must be retried', async () => {
    const d = deps(
      { status: 'retry', attempt: 1, retryDelayMs: 30_000, error: null },
      { status: 'completed', attempt: 1 },
    );
    const worker = createSqsJobWorker(d);
    const response = await worker({
      Records: [
        record({ type: 'call.place', data: callData }, '1', 'call-msg'),
        record({ type: 'summary.generate', data: summaryData }, '1', 'summary-msg'),
      ],
    });
    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: 'call-msg' }] });
  });
});
