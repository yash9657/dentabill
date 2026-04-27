import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createRedisConnection } from './connection.js';
import { createDlqQueue, DLQ_REASONS, type DlqQueue, enqueueDlqJob } from './dlq.js';
import { createCallsQueue, type CallsQueue } from './queues.js';
import {
  CALL_JOB_NAME,
  type CallJobData,
  CallJobDataSchema,
  type CallJobName,
  type CallJobResult,
} from './types.js';
import { createCallsWorker, type CallsWorker } from './worker.js';

/**
 * Real-Redis integration suite (P3-T2).
 *
 * Uses Redis DB **15** so it cannot collide with a developer's `bull:*`
 * keys on the default DB or with the api package's own integration suite
 * if both run concurrently. `flushdb` only touches the selected DB, so
 * leaking state across packages is structurally impossible.
 *
 * Skipped when no Redis is reachable on the configured URL — local devs
 * who haven't booted `docker compose up redis` still get the unit suite
 * to pass; CI's service container is always reachable.
 */

const REDIS_TEST_URL = process.env.QUEUE_TEST_REDIS_URL ?? 'redis://localhost:6379/15';

const sample: CallJobData = {
  organizationId: 'org_test',
  claimId: 'claim_test_001',
  payerCode: 'DELTA_DENTAL_PPO',
  attemptNumber: 1,
  claimPriority: 75,
  idempotencyKey: 'claim_test_001-1',
};

let redisAvailable = false;
let connection: ReturnType<typeof createRedisConnection>;
let calls: CallsQueue;
let dlq: DlqQueue;
let worker: CallsWorker | undefined;

beforeAll(async () => {
  connection = createRedisConnection(REDIS_TEST_URL, { lazyConnect: false });
  try {
    await connection.ping();
    redisAvailable = true;
  } catch {
    redisAvailable = false;
    return;
  }
  calls = createCallsQueue({ connection });
  dlq = createDlqQueue({ connection });
});

beforeEach(async () => {
  if (!redisAvailable) return;
  // Tests must start on a clean slate — flushdb is scoped to DB 15.
  await connection.flushdb();
});

afterAll(async () => {
  if (worker !== undefined) await worker.close();
  if (redisAvailable) {
    await calls.close();
    await dlq.close();
  }
  connection.disconnect();
});

describe.runIf(process.env.SKIP_REAL_REDIS_TESTS !== 'true')(
  '@dentabill/queue — integration (real Redis)',
  () => {
    it('skips gracefully when Redis is not reachable', () => {
      // Marker test — the entire suite below skips its bodies if redisAvailable is false.
      // This assertion runs unconditionally so the suite always reports a result.
      expect(typeof REDIS_TEST_URL).toBe('string');
    });

    it('round-trips a CallJobData payload through the calls queue', async () => {
      if (!redisAvailable) return;
      const processed: CallJobData[] = [];

      worker = createCallsWorker({
        connection,
        concurrency: 1,
        processor: async (job) => {
          // The worker is the second trust boundary — re-validate the
          // payload on dequeue (ADR-035). Emulates what the production
          // call-worker handler will do.
          processed.push(CallJobDataSchema.parse(job.data));
          return Promise.resolve<CallJobResult>({
            callId: 'call_001',
            retellCallId: null,
            outcome: 'COMPLETED',
            durationSeconds: 0,
          });
        },
      });

      await calls.add(CALL_JOB_NAME satisfies CallJobName, sample, {
        jobId: sample.idempotencyKey,
      });

      // Wait for the worker to process. BullMQ's processed event fires
      // synchronously after the processor resolves; poll briefly so the
      // test does not flake on a slow CI box.
      const start = Date.now();
      while (processed.length === 0 && Date.now() - start < 5_000) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      expect(processed).toEqual([sample]);
    });

    it('routes a terminally-failed job to the DLQ via enqueueDlqJob', async () => {
      if (!redisAvailable) return;

      await enqueueDlqJob({
        dlq,
        originalJobId: sample.idempotencyKey,
        originalJobName: CALL_JOB_NAME,
        originalData: sample,
        attemptsMade: 3,
        reason: DLQ_REASONS.EXCEEDED_MAX_ATTEMPTS,
        failedReason: 'Retell connection refused after 3 retries',
      });

      const dlqJob = await dlq.getJob(sample.idempotencyKey);
      expect(dlqJob).not.toBeNull();
      const { data } = dlqJob!;
      expect(data.reason).toBe(DLQ_REASONS.EXCEEDED_MAX_ATTEMPTS);
      expect(data.attemptsMade).toBe(3);
      expect(data.originalData).toEqual(sample);
      expect(data.failedReason).toBe('Retell connection refused after 3 retries');
    });

    it('is idempotent on originalJobId — re-enqueue is a no-op', async () => {
      if (!redisAvailable) return;

      const params = {
        dlq,
        originalJobId: sample.idempotencyKey,
        originalJobName: CALL_JOB_NAME,
        originalData: sample,
        attemptsMade: 3,
        reason: DLQ_REASONS.EXCEEDED_MAX_ATTEMPTS,
      };

      await enqueueDlqJob(params);
      await enqueueDlqJob(params);
      await enqueueDlqJob({ ...params, failedReason: 'second-call payload' });

      const all = await dlq.getJobs(['waiting', 'active', 'delayed', 'completed', 'failed']);
      const matching = all.filter((j) => j.id === sample.idempotencyKey);
      expect(matching).toHaveLength(1);
      // First write wins — the `failedReason` from the third call is dropped
      // because BullMQ's jobId constraint silently discards re-enqueues.
      expect(matching[0]!.data.failedReason).toBeUndefined();
    });
  },
);
