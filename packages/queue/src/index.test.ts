import { describe, expect, it } from 'vitest';

import {
  CALL_JOB_NAME,
  CallJobDataSchema,
  CallJobResultSchema,
  CALLS_DEFAULT_JOB_OPTIONS,
  loadQueueEnv,
  QUEUE_NAMES,
  SummaryJobResultSchema,
  SummaryJobDataSchema,
} from './index.js';

describe('@dentabill/queue — wire surface', () => {
  it('exposes the canonical queue + job names', () => {
    expect(QUEUE_NAMES.CALLS).toBe('calls');
    expect(QUEUE_NAMES.CALLS_DLQ).toBe('calls-dlq');
    expect(CALL_JOB_NAME).toBe('call.place');
  });
});

describe('SummaryJobResultSchema', () => {
  it('rejects caller-selected native provider, model, or generation controls in the command', () => {
    const data = {
      organizationId: 'synthetic-org',
      callId: 'synthetic-call',
      promptVersion: 'v1',
      idempotencyKey: 'call.synthetic',
    };
    for (const extra of [
      { provider: 'FIREWORKS' },
      { releaseId: 'caller' },
      { generation: 2 },
      { dataClass: 'SYNTHETIC' },
    ])
      expect(SummaryJobDataSchema.safeParse({ ...data, ...extra }).success).toBe(false);
  });
  it('carries a native observation without inventing a legacy summary or known usage', () => {
    expect(
      SummaryJobResultSchema.parse({
        summaryId: null,
        observationId: 'synthetic-observation',
        outcome: 'OBSERVATION_PUBLISHED',
        tokensUsed: null,
        promptVersion: 'claim-observation.v1',
      }),
    ).toMatchObject({ summaryId: null, observationId: 'synthetic-observation', tokensUsed: null });
  });
  it('preserves unknown inference usage and review disposition without coercing to zero', () => {
    expect(
      SummaryJobResultSchema.parse({
        summaryId: null,
        outcome: 'INFERENCE_REVIEW_REQUIRED',
        tokensUsed: null,
        promptVersion: 'v1',
      }).tokensUsed,
    ).toBeNull();
    expect(
      SummaryJobResultSchema.parse({
        summaryId: null,
        outcome: 'PROVIDER_DISABLED',
        tokensUsed: 0,
        promptVersion: 'v1',
      }).tokensUsed,
    ).toBe(0);
  });
});

describe('CallJobDataSchema', () => {
  const valid = {
    organizationId: 'org_abc',
    claimId: 'claim_xyz',
    payerCode: 'DELTA_DENTAL_PPO',
    attemptNumber: 1,
    claimPriority: 75,
    idempotencyKey: 'claim_xyz-1',
  };

  it('accepts a well-formed payload', () => {
    expect(CallJobDataSchema.parse(valid)).toEqual(valid);
  });

  it('rejects attemptNumber outside [1, 2] (ADR-039 cap)', () => {
    expect(() => CallJobDataSchema.parse({ ...valid, attemptNumber: 0 })).toThrow();
    expect(() => CallJobDataSchema.parse({ ...valid, attemptNumber: 3 })).toThrow();
  });

  it('rejects claimPriority outside [0, 100]', () => {
    expect(() => CallJobDataSchema.parse({ ...valid, claimPriority: -1 })).toThrow();
    expect(() => CallJobDataSchema.parse({ ...valid, claimPriority: 101 })).toThrow();
  });

  it.each(['organizationId', 'claimId', 'payerCode', 'idempotencyKey'] as const)(
    'rejects empty %s',
    (field) => {
      expect(() => CallJobDataSchema.parse({ ...valid, [field]: '' })).toThrow();
    },
  );

  it('rejects an idempotencyKey containing `:` (BullMQ jobId reserved char)', () => {
    expect(() => CallJobDataSchema.parse({ ...valid, idempotencyKey: 'claim_xyz:1' })).toThrow(
      /idempotencyKey/,
    );
  });
});

describe('CallJobResultSchema', () => {
  it('accepts each documented outcome', () => {
    for (const outcome of ['COMPLETED', 'ESCALATED', 'RESCHEDULED', 'CANCELLED'] as const) {
      expect(
        CallJobResultSchema.parse({
          callId: 'call_1',
          retellCallId: null,
          outcome,
          durationSeconds: 42,
        }).outcome,
      ).toBe(outcome);
    }
  });

  it('rejects unknown outcomes', () => {
    expect(() =>
      CallJobResultSchema.parse({
        callId: 'call_1',
        retellCallId: null,
        outcome: 'UNKNOWN',
        durationSeconds: 0,
      }),
    ).toThrow();
  });
});

describe('CALLS_DEFAULT_JOB_OPTIONS — ADR-035', () => {
  it('retries 3 times with exponential backoff seeded at 30 s', () => {
    expect(CALLS_DEFAULT_JOB_OPTIONS.attempts).toBe(3);
    expect(CALLS_DEFAULT_JOB_OPTIONS.backoff).toEqual({ type: 'exponential', delay: 30_000 });
  });

  it('prunes completed jobs after 24 h and preserves failed jobs forever', () => {
    expect(CALLS_DEFAULT_JOB_OPTIONS.removeOnComplete).toEqual({ age: 86_400 });
    expect(CALLS_DEFAULT_JOB_OPTIONS.removeOnFail).toBe(false);
  });
});

describe('loadQueueEnv', () => {
  it('parses a well-formed env', () => {
    const env = loadQueueEnv({ REDIS_URL: 'redis://localhost:6379' });
    expect(env.REDIS_URL).toBe('redis://localhost:6379');
    expect(env.QUEUE_CONCURRENCY).toBe(4);
  });

  it('coerces QUEUE_CONCURRENCY from string', () => {
    const env = loadQueueEnv({
      REDIS_URL: 'redis://localhost:6379',
      QUEUE_CONCURRENCY: '8',
    });
    expect(env.QUEUE_CONCURRENCY).toBe(8);
  });

  it('rejects a missing REDIS_URL with a usable error', () => {
    expect(() => loadQueueEnv({})).toThrow(/REDIS_URL/);
  });

  it('rejects a non-URL REDIS_URL', () => {
    expect(() => loadQueueEnv({ REDIS_URL: 'localhost:6379' })).toThrow(/REDIS_URL/);
  });
});
