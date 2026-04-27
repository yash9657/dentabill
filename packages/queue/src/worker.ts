import { Worker, type Processor, type WorkerOptions } from 'bullmq';
import type { Redis } from 'ioredis';

import { type CallJobData, type CallJobName, type CallJobResult, QUEUE_NAMES } from './types.js';

export type CallsWorker = Worker<CallJobData, CallJobResult, CallJobName>;

export type CallsProcessor = Processor<CallJobData, CallJobResult, CallJobName>;

export interface CreateCallsWorkerOptions {
  connection: Redis;
  /** ADR-035 default = 4. Override via `QUEUE_CONCURRENCY` in worker bootstrap. */
  concurrency?: number;
  processor: CallsProcessor;
  /** Extra Worker config (lockDuration, drainDelay, etc.). */
  options?: Partial<Omit<WorkerOptions, 'connection' | 'concurrency'>>;
}

export function createCallsWorker({
  connection,
  concurrency,
  processor,
  options,
}: CreateCallsWorkerOptions): CallsWorker {
  return new Worker<CallJobData, CallJobResult, CallJobName>(QUEUE_NAMES.CALLS, processor, {
    connection,
    concurrency: concurrency ?? 4,
    ...options,
  });
}
