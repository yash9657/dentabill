import type { EndCallInput, RetellEvent, StartCallInput, StartCallResult } from './events.js';

/**
 * Port interface (ADR-033) — the call worker depends on `RetellPort`,
 * never on `retell-sdk` directly. Two adapters implement it:
 *
 *   - `FakeRetell` (P3-T6): in-process state machine for tests.
 *   - `LiveRetell` (P3-T7): wraps `retell-sdk`; only adapter that
 *     touches the network.
 *
 * The port is intentionally minimal — three methods.
 *
 *   1. `startCall` — initiates an outbound call. Returns the Retell-
 *      assigned `retellCallId` immediately; lifecycle events arrive
 *      asynchronously via `subscribe`.
 *   2. `endCall` — requests termination of an in-flight call.
 *      A successful response acknowledges the stop request. Completion
 *      requires terminal provider evidence; ambiguous errors propagate
 *      for reconciliation rather than deleting call data or retrying blindly.
 *   3. `subscribe` — the worker listens for events on a specific
 *      `retellCallId`. The HTTP webhook route fans out to subscribers
 *      after HMAC-verifying + parsing inbound deliveries; FakeRetell
 *      synthesises events directly. Returns an unsubscribe function
 *      so subscribers cannot leak across calls.
 */
export type RetellEventListener = (event: RetellEvent) => void | Promise<void>;

export interface RetellPort {
  startCall(input: StartCallInput): Promise<StartCallResult>;
  endCall(input: EndCallInput): Promise<void>;
  subscribe(retellCallId: string, listener: RetellEventListener): () => void;
}
