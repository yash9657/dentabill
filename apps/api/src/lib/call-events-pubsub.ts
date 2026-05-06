/**
 * Redis pub/sub fan-out for live `Call` events (P4-T5 / ADR-046).
 *
 * The SSE handler subscribes to `call:<retellCallId>:events`; the
 * Retell webhook (and, in a follow-up, the summary-worker) publishes
 * to the same channel after persisting the durable `CallEvent` row.
 *
 * Per the ADR: Postgres is the durable store; Redis pub/sub is the
 * broadcast bus. A subscriber that misses a publish (because it
 * connected late) replays from Postgres at connect time. The handler
 * never trusts pub/sub for completeness — it trusts it for latency.
 */
import type { Redis } from 'ioredis';

export interface CallEventPayload {
  readonly type: string;
  readonly callEventId?: string | null;
  readonly retellCallId: string;
  readonly timestamp: string;
  readonly data?: Record<string, unknown>;
}

export function callEventsChannel(retellCallId: string): string {
  return `call:${retellCallId}:events`;
}

export async function publishCallEvent(
  redis: Redis | null,
  payload: CallEventPayload,
): Promise<void> {
  if (redis === null) return;
  await redis.publish(callEventsChannel(payload.retellCallId), JSON.stringify(payload));
}
