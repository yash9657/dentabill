import type { Logger } from '@dentabill/logger';
import { CallJobDataSchema, type CallsProcessor } from '@dentabill/queue';

/**
 * Stub call-job processor — P3-T9 only wires the BullMQ surface.
 * P3-T10 replaces this with the real Retell-driven handler.
 *
 * The stub re-validates the job data at the dequeue trust boundary
 * (ADR-035 invariant: the queue is a trust boundary) and returns a
 * `CANCELLED` outcome so the BullMQ Worker emits a `completed` event
 * without actually placing a call. This lets us run the worker locally
 * + in CI without provisioned Retell credentials and still smoke-test
 * the queue/worker plumbing.
 */
export interface CreateStubProcessorOptions {
  readonly logger: Logger;
}

export function createStubProcessor({ logger }: CreateStubProcessorOptions): CallsProcessor {
  return async (job) => {
    const validation = await CallJobDataSchema.safeParseAsync(job.data);
    if (!validation.success) throw validation.error;
    const data = validation.data;
    logger.warn(
      {
        jobId: job.id,
        organizationId: data.organizationId,
        claimId: data.claimId,
        attemptNumber: data.attemptNumber,
        payerCode: data.payerCode,
      },
      'call-worker stub processor invoked — P3-T10 will replace this with the real Retell-driven handler',
    );
    return {
      callId: 'stub_call_not_persisted',
      retellCallId: null,
      outcome: 'CANCELLED',
      durationSeconds: 0,
    };
  };
}
