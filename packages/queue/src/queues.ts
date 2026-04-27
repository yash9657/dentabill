import { Queue, QueueEvents, type DefaultJobOptions } from 'bullmq';
import type { Redis } from 'ioredis';

import { type CallJobData, type CallJobName, type CallJobResult, QUEUE_NAMES } from './types.js';

/**
 * Default job options for the `calls` queue (ADR-035).
 *
 *   - 3 attempts with exponential backoff: 30 s / 2 m / 8 m.
 *   - Completed jobs auto-pruned after 24 h to keep the BullMQ admin UI
 *     responsive.
 *   - Failed jobs preserved indefinitely for HIPAA audit and DLQ
 *     inspection — the DLQ consumer (P3-T14) is the canonical drain.
 */
export const CALLS_DEFAULT_JOB_OPTIONS: DefaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
  removeOnComplete: { age: 86_400 },
  removeOnFail: false,
};

export type CallsQueue = Queue<CallJobData, CallJobResult, CallJobName>;
export type CallsQueueEvents = QueueEvents;

export interface CreateCallsQueueOptions {
  connection: Redis;
}

export function createCallsQueue({ connection }: CreateCallsQueueOptions): CallsQueue {
  return new Queue<CallJobData, CallJobResult, CallJobName>(QUEUE_NAMES.CALLS, {
    connection,
    defaultJobOptions: CALLS_DEFAULT_JOB_OPTIONS,
  });
}

export function createCallsQueueEvents({ connection }: CreateCallsQueueOptions): CallsQueueEvents {
  return new QueueEvents(QUEUE_NAMES.CALLS, { connection });
}
