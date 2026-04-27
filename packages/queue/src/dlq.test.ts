import { describe, expect, it } from 'vitest';

import { DLQ_DEFAULT_JOB_OPTIONS, DLQ_REASONS, DlqJobDataSchema } from './dlq.js';

describe('DLQ_DEFAULT_JOB_OPTIONS', () => {
  it('disables retries on the DLQ itself (it is the terminal queue)', () => {
    expect(DLQ_DEFAULT_JOB_OPTIONS.attempts).toBe(1);
  });

  it('preserves DLQ rows for HIPAA audit; never auto-prunes', () => {
    expect(DLQ_DEFAULT_JOB_OPTIONS.removeOnComplete).toBe(false);
    expect(DLQ_DEFAULT_JOB_OPTIONS.removeOnFail).toBe(false);
  });
});

describe('DLQ_REASONS', () => {
  it('exposes every escalation cause Phase 3 can produce', () => {
    expect(DLQ_REASONS).toEqual({
      EXCEEDED_MAX_ATTEMPTS: 'exceeded_max_attempts',
      EXCEEDED_MAX_DURATION: 'exceeded_max_duration',
      EXCEEDED_MAX_HOLD: 'exceeded_max_hold',
      CANCELLED_BY_OPERATOR: 'cancelled_by_operator',
    });
  });
});

describe('DlqJobDataSchema', () => {
  const valid = {
    originalJobId: 'claim_xyz-1',
    originalQueueName: 'calls',
    originalJobName: 'call.place',
    originalData: {
      organizationId: 'org_abc',
      claimId: 'claim_xyz',
      payerCode: 'DELTA_DENTAL_PPO',
      attemptNumber: 1,
      claimPriority: 75,
      idempotencyKey: 'claim_xyz-1',
    },
    reason: DLQ_REASONS.EXCEEDED_MAX_ATTEMPTS,
    failedReason: 'Retell rate-limited the agent',
    attemptsMade: 3,
    enqueuedAt: '2026-04-26T22:00:00.000Z',
  };

  it('accepts a fully-populated payload', () => {
    expect(DlqJobDataSchema.parse(valid)).toEqual(valid);
  });

  it('treats failedReason as optional', () => {
    const { failedReason: _omit, ...withoutFailed } = valid;
    expect(DlqJobDataSchema.parse(withoutFailed).failedReason).toBeUndefined();
  });

  it('rejects an unknown DLQ reason', () => {
    expect(() => DlqJobDataSchema.parse({ ...valid, reason: 'made_up' })).toThrow();
  });

  it('rejects an invalid enqueuedAt', () => {
    expect(() => DlqJobDataSchema.parse({ ...valid, enqueuedAt: 'not-a-date' })).toThrow();
  });

  it('rejects negative attemptsMade', () => {
    expect(() => DlqJobDataSchema.parse({ ...valid, attemptsMade: -1 })).toThrow();
  });
});
