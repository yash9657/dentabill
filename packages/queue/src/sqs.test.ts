import type { ChangeMessageVisibilityCommand, SendMessageCommand } from '@aws-sdk/client-sqs';
import { describe, expect, it, vi } from 'vitest';

import {
  createSqsJobDispatcher,
  createSqsRetryScheduler,
  parseSqsJobMessage,
  SQS_MAX_DELAY_SECONDS,
  toSqsDelaySeconds,
} from './sqs.js';
import type { CallJobData, SummaryJobData } from './types.js';

const QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789012/dentabill-jobs';

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

function fakeClient(): {
  client: { send: ReturnType<typeof vi.fn> };
  inputs: () => SendMessageCommand['input'][];
} {
  const send = vi.fn(async (_command: SendMessageCommand) => ({ MessageId: 'm-1' }));
  return {
    client: { send },
    inputs: () => send.mock.calls.map(([command]) => command.input),
  };
}

describe('toSqsDelaySeconds', () => {
  it('returns 0 for no / non-positive / non-finite delays', () => {
    expect(toSqsDelaySeconds(undefined)).toBe(0);
    expect(toSqsDelaySeconds(0)).toBe(0);
    expect(toSqsDelaySeconds(-5)).toBe(0);
    expect(toSqsDelaySeconds(Number.NaN)).toBe(0);
  });

  it('rounds up to whole seconds and clamps at 900', () => {
    expect(toSqsDelaySeconds(1)).toBe(1);
    expect(toSqsDelaySeconds(30_000)).toBe(30);
    expect(toSqsDelaySeconds(30_001)).toBe(31);
    expect(toSqsDelaySeconds(60 * 60 * 1000)).toBe(SQS_MAX_DELAY_SECONDS);
  });
});

describe('createSqsJobDispatcher', () => {
  it('rejects an empty queue URL', () => {
    expect(() => createSqsJobDispatcher({ queueUrl: ' ' })).toThrow(/queueUrl/);
  });

  it('sends call jobs as a typed envelope with routing attributes', async () => {
    const { client, inputs } = fakeClient();
    const dispatcher = createSqsJobDispatcher({ queueUrl: QUEUE_URL, client });
    expect(dispatcher.mode).toBe('sqs');

    const id = await dispatcher.dispatchCall(callData, { priority: 21 });

    expect(id).toBe(callData.idempotencyKey);
    const [input] = inputs();
    expect(input?.QueueUrl).toBe(QUEUE_URL);
    expect(JSON.parse(input?.MessageBody ?? '')).toEqual({ type: 'call.place', data: callData });
    expect(input?.MessageAttributes).toEqual({
      jobType: { DataType: 'String', StringValue: 'call.place' },
      idempotencyKey: { DataType: 'String', StringValue: callData.idempotencyKey },
    });
    // No delay requested → DelaySeconds omitted (queue default applies).
    expect(input).not.toHaveProperty('DelaySeconds');
  });

  it('sends summary jobs with the summary envelope type', async () => {
    const { client, inputs } = fakeClient();
    const dispatcher = createSqsJobDispatcher({ queueUrl: QUEUE_URL, client });

    const id = await dispatcher.dispatchSummary(summaryData);

    expect(id).toBe('call.call_1');
    expect(JSON.parse(inputs()[0]?.MessageBody ?? '')).toEqual({
      type: 'summary.generate',
      data: summaryData,
    });
  });

  it('maps delayMs to DelaySeconds and reports clamping above 900 s', async () => {
    const { client, inputs } = fakeClient();
    const onDelayClamped = vi.fn();
    const dispatcher = createSqsJobDispatcher({ queueUrl: QUEUE_URL, client, onDelayClamped });

    await dispatcher.dispatchCall(callData, { delayMs: 120_000 });
    await dispatcher.dispatchSummary(summaryData, { delayMs: 3_600_000 });

    expect(inputs()[0]?.DelaySeconds).toBe(120);
    expect(inputs()[1]?.DelaySeconds).toBe(900);
    expect(onDelayClamped).toHaveBeenCalledTimes(1);
    expect(onDelayClamped).toHaveBeenCalledWith({
      jobId: 'call.call_1',
      requestedMs: 3_600_000,
      appliedSeconds: 900,
    });
  });

  it('propagates SQS errors so the caller can roll back', async () => {
    const send = vi.fn(async () => {
      throw new Error('AccessDenied');
    });
    const dispatcher = createSqsJobDispatcher({ queueUrl: QUEUE_URL, client: { send } });
    await expect(dispatcher.dispatchCall(callData)).rejects.toThrow('AccessDenied');
  });
});

describe('parseSqsJobMessage', () => {
  it('round-trips both envelope types', () => {
    expect(parseSqsJobMessage(JSON.stringify({ type: 'call.place', data: callData }))).toEqual({
      type: 'call.place',
      data: callData,
    });
    expect(
      parseSqsJobMessage(JSON.stringify({ type: 'summary.generate', data: summaryData })),
    ).toEqual({ type: 'summary.generate', data: summaryData });
  });

  it('rejects malformed JSON, unknown types and invalid payloads', () => {
    expect(() => parseSqsJobMessage('{not json')).toThrow();
    expect(() => parseSqsJobMessage(JSON.stringify({ type: 'nope', data: callData }))).toThrow();
    expect(() =>
      parseSqsJobMessage(
        JSON.stringify({ type: 'call.place', data: { ...callData, idempotencyKey: 'a:b' } }),
      ),
    ).toThrow();
  });
});

describe('createSqsRetryScheduler', () => {
  it('sets the visibility timeout of the received message, clamped to [0, 12 h]', async () => {
    const send = vi.fn(async (_command: ChangeMessageVisibilityCommand) => ({}));
    const schedule = createSqsRetryScheduler({ queueUrl: QUEUE_URL, client: { send } });

    await schedule('rh-1', 30);
    await schedule('rh-2', 1_000_000);
    await schedule('rh-3', -1);

    expect(send.mock.calls.map(([c]) => c.input)).toEqual([
      { QueueUrl: QUEUE_URL, ReceiptHandle: 'rh-1', VisibilityTimeout: 30 },
      { QueueUrl: QUEUE_URL, ReceiptHandle: 'rh-2', VisibilityTimeout: 43_200 },
      { QueueUrl: QUEUE_URL, ReceiptHandle: 'rh-3', VisibilityTimeout: 0 },
    ]);
  });
});
