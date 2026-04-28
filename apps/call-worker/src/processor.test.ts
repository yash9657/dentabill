import { createLogger } from '@dentabill/logger';
import type { CallJobData } from '@dentabill/queue';
import { describe, expect, it } from 'vitest';

import { createStubProcessor } from './processor.js';

const silentLogger = createLogger({
  level: 'fatal',
  pretty: false,
  base: { service: 'call-worker-test' },
});

const sampleJobData: CallJobData = {
  organizationId: 'org_test',
  claimId: 'claim_test_001',
  payerCode: 'DELTA_DENTAL_PPO',
  attemptNumber: 1,
  claimPriority: 75,
  idempotencyKey: 'claim_test_001-1',
};

describe('createStubProcessor', () => {
  it('returns CANCELLED for a valid job', async () => {
    const processor = createStubProcessor({ logger: silentLogger });
    // Minimal Job-like object: BullMQ passes more fields, but the stub
    // only reads `id` + `data`, so the cast is sufficient for the unit test.
    const job = { id: 'job_1', data: sampleJobData } as Parameters<typeof processor>[0];
    const result = await processor(job, 'token');
    expect(result.outcome).toBe('CANCELLED');
    expect(result.callId).toBe('stub_call_not_persisted');
    expect(result.retellCallId).toBeNull();
    expect(result.durationSeconds).toBe(0);
  });

  it('rejects a malformed job at the dequeue trust boundary', async () => {
    const processor = createStubProcessor({ logger: silentLogger });
    const malformed = { id: 'job_2', data: { ...sampleJobData, attemptNumber: 99 } } as Parameters<
      typeof processor
    >[0];
    await expect(processor(malformed, 'token')).rejects.toThrow();
  });
});
