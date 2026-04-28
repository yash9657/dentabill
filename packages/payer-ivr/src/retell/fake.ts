import {
  type EndCallInput,
  EndCallInputSchema,
  type RetellCallEndedEvent,
  type RetellEvent,
  RetellCallEndReason,
  type StartCallInput,
  StartCallInputSchema,
  type StartCallResult,
} from './events.js';
import type { RetellEventListener, RetellPort } from './port.js';

/**
 * `FakeRetell` (ADR-033) — deterministic in-process implementation of
 * `RetellPort` for tests.
 *
 * Behaviour intentionally mirrors `LiveRetell` (P3-T7) at the contract
 * level: `startCall` returns a `retellCallId` synchronously, listeners
 * registered before the next microtask receive `call.started`, and
 * `endCall` is idempotent.
 *
 * Tests drive specific scenarios with the **control surface** —
 * `emit()` for one-off events, the `simulateHappyPath` / `…HoldTimeout`
 * / `…Denial` helpers for pre-baked flows that match the three
 * branches P3-T15's e2e covers.
 *
 * The class is intentionally NOT a singleton: each test constructs a
 * fresh instance so that subscriptions, scripts, and observed
 * `startCall`/`endCall` invocations cannot leak across tests.
 */
export interface FakeRetellOptions {
  /**
   * When true (default), `startCall` emits `call.started` after a
   * `queueMicrotask` so that the caller has time to `subscribe`. Set
   * `false` for tests that want fully manual control over emission
   * timing.
   */
  readonly autoEmitStarted?: boolean;
  /** Override the retellCallId generator. Default: `fake_call_<n>` counter. */
  readonly retellCallIdFactory?: () => string;
  /** Override the clock. Default: `() => new Date()`. */
  readonly clock?: () => Date;
}

interface InternalCall {
  readonly retellCallId: string;
  readonly input: StartCallInput;
  readonly startedAt: Date;
  ended: boolean;
}

export class FakeRetell implements RetellPort {
  readonly #autoEmitStarted: boolean;
  readonly #retellCallIdFactory: () => string;
  readonly #clock: () => Date;
  readonly #calls = new Map<string, InternalCall>();
  readonly #idempotencyIndex = new Map<string, string>();
  readonly #listeners = new Map<string, Set<RetellEventListener>>();
  /**
   * Events emitted on a `retellCallId` that has no subscribers yet are
   * buffered here and replayed when the first listener subscribes.
   * Mirrors the production reality that Retell's network delivery may
   * race the worker's subscription on call startup.
   */
  readonly #buffered = new Map<string, RetellEvent[]>();
  readonly #startedCalls: StartCallInput[] = [];
  readonly #endedCalls: EndCallInput[] = [];
  #counter = 0;

  constructor(options: FakeRetellOptions = {}) {
    this.#autoEmitStarted = options.autoEmitStarted ?? true;
    this.#retellCallIdFactory =
      options.retellCallIdFactory ?? ((): string => `fake_call_${String(++this.#counter)}`);
    this.#clock = options.clock ?? ((): Date => new Date());
  }

  // ────────────────────────────────────────────────────────────────────
  // RetellPort surface
  // ────────────────────────────────────────────────────────────────────

  startCall(input: StartCallInput): Promise<StartCallResult> {
    // Async-by-contract: never throw synchronously even when input is
    // malformed; the caller awaits the returned promise.
    const validation = StartCallInputSchema.safeParse(input);
    if (!validation.success) {
      return Promise.reject(validation.error);
    }
    this.#startedCalls.push(input);
    // Idempotency: same idempotencyKey within the lifetime of this
    // FakeRetell returns the same retellCallId without firing a second
    // `call.started`. Mirrors LiveRetell's `client_call_id` semantics.
    const existingRetellCallId = this.#idempotencyIndex.get(input.idempotencyKey);
    if (existingRetellCallId !== undefined) {
      const existing = this.#calls.get(existingRetellCallId);
      if (existing !== undefined) {
        return Promise.resolve({
          retellCallId: existingRetellCallId,
          queuedAt: existing.startedAt.toISOString(),
        });
      }
    }
    const retellCallId = this.#retellCallIdFactory();
    const startedAt = this.#clock();
    this.#calls.set(retellCallId, { retellCallId, input, startedAt, ended: false });
    this.#idempotencyIndex.set(input.idempotencyKey, retellCallId);
    if (this.#autoEmitStarted) {
      queueMicrotask(() => {
        // Skip if the test ended the call before the microtask fired.
        const call = this.#calls.get(retellCallId);
        if (call === undefined || call.ended) return;
        this.emit(retellCallId, {
          type: 'call.started',
          retellCallId,
          agentId: input.agentId,
          toNumberE164: input.toNumberE164,
          startedAt: startedAt.toISOString(),
          metadata: {
            practiceName: input.agentMetadata.practiceName,
            providerNpi: input.agentMetadata.providerNpi,
          },
        });
      });
    }
    return Promise.resolve({ retellCallId, queuedAt: startedAt.toISOString() });
  }

  endCall(input: EndCallInput): Promise<void> {
    EndCallInputSchema.parse(input);
    this.#endedCalls.push(input);
    const call = this.#calls.get(input.retellCallId);
    // Idempotent: silently swallow "already ended" or "unknown call".
    if (call === undefined || call.ended) return Promise.resolve();
    call.ended = true;
    queueMicrotask(() => {
      this.emit(input.retellCallId, {
        type: 'call.ended',
        retellCallId: input.retellCallId,
        endedAt: this.#clock().toISOString(),
        durationSeconds: Math.max(
          0,
          Math.round((this.#clock().getTime() - call.startedAt.getTime()) / 1000),
        ),
        endReason: this.#endReasonForOperatorCause(input.reason),
      });
    });
    return Promise.resolve();
  }

  subscribe(retellCallId: string, listener: RetellEventListener): () => void {
    let set = this.#listeners.get(retellCallId);
    if (set === undefined) {
      set = new Set();
      this.#listeners.set(retellCallId, set);
    }
    set.add(listener);
    // Drain any buffered events for this call to the new listener.
    // Buffering exists because the auto-emit `call.started` microtask
    // may run before the worker has had a chance to subscribe.
    const buffer = this.#buffered.get(retellCallId);
    if (buffer !== undefined && buffer.length > 0) {
      // Copy & clear the buffer first so a listener that re-subscribes
      // synchronously cannot trigger an infinite replay.
      const drained = [...buffer];
      this.#buffered.delete(retellCallId);
      for (const event of drained) {
        void listener(event);
      }
    }
    return () => {
      const current = this.#listeners.get(retellCallId);
      current?.delete(listener);
    };
  }

  // ────────────────────────────────────────────────────────────────────
  // Control surface (test-only)
  // ────────────────────────────────────────────────────────────────────

  /**
   * Synchronously fan an event out to every subscriber for `retellCallId`.
   * If no subscribers are registered yet, the event is buffered and
   * replayed when the first listener subscribes.
   */
  emit(retellCallId: string, event: RetellEvent): void {
    const set = this.#listeners.get(retellCallId);
    if (set === undefined || set.size === 0) {
      const buffer = this.#buffered.get(retellCallId) ?? [];
      buffer.push(event);
      this.#buffered.set(retellCallId, buffer);
      return;
    }
    for (const listener of set) {
      // Listeners may be async; we fire-and-forget. A real test that needs
      // to await a listener should use `simulateXxx` (which awaits) or
      // call `await Promise.resolve()` after each emit.
      void listener(event);
    }
  }

  /**
   * Pre-baked happy-path flow — agent connects, exchanges a few transcript
   * lines with the rep, ends `completed` with the standard 7-item
   * collectedInfo shape from PRD §6.
   */
  async simulateHappyPath(
    retellCallId: string,
    overrides?: Partial<RetellCallEndedEvent>,
  ): Promise<void> {
    const call = this.#requireCall(retellCallId);
    const seq: RetellEvent[] = [
      {
        type: 'call.transcript',
        retellCallId,
        role: 'agent',
        text: `Hello, this is DentaBill calling on behalf of ${call.input.agentMetadata.practiceName}.`,
        timestamp: this.#clock().toISOString(),
      },
      {
        type: 'call.transcript',
        retellCallId,
        role: 'user',
        text: 'Sure, what claim are you calling about?',
        timestamp: this.#clock().toISOString(),
      },
      {
        type: 'call.transcript',
        retellCallId,
        role: 'agent',
        text: `Subscriber ${call.input.agentMetadata.subscriberId}, date of service ${call.input.agentMetadata.dateOfService}.`,
        timestamp: this.#clock().toISOString(),
      },
      {
        type: 'call.transcript',
        retellCallId,
        role: 'user',
        text: 'That claim is approved for $245. Reference number REF-9182.',
        timestamp: this.#clock().toISOString(),
      },
    ];
    for (const event of seq) {
      this.emit(retellCallId, event);
      await Promise.resolve();
    }
    const ended: RetellCallEndedEvent = {
      type: 'call.ended',
      retellCallId,
      endedAt: this.#clock().toISOString(),
      durationSeconds: Math.max(
        1,
        Math.round((this.#clock().getTime() - call.startedAt.getTime()) / 1000),
      ),
      endReason: RetellCallEndReason.COMPLETED,
      collectedInfo: {
        claimStatus: 'approved',
        amountApprovedCents: 24_500,
        referenceNumber: 'REF-9182',
        representativeName: 'Janet',
        nextSteps: 'No further action required',
      },
      ...overrides,
    };
    call.ended = true;
    this.emit(retellCallId, ended);
  }

  /**
   * Pre-baked hold-timeout flow — agent connects but no rep ever speaks;
   * the worker's hold detector (P3-T12) is expected to invoke `endCall`
   * with `hold_cap_exceeded` after the test advances time.
   */
  async simulateHoldTimeout(retellCallId: string): Promise<void> {
    const call = this.#requireCall(retellCallId);
    this.emit(retellCallId, {
      type: 'call.transcript',
      retellCallId,
      role: 'system',
      text: 'Hold music begins; no rep available.',
      timestamp: this.#clock().toISOString(),
    });
    await Promise.resolve();
    // The fake does NOT auto-end this — the test must invoke endCall
    // (or let the hold detector do it) so the assertion exercises the
    // production code path. We just leave the call dangling.
    if (call.ended) return;
  }

  /**
   * Pre-baked denial flow — rep cites a CO-50 (non-covered service)
   * denial; the call ends `completed` but `collectedInfo.claimStatus` is
   * `denied` so the worker writes `Claim.status = MANUAL_REVIEW`.
   */
  async simulateDenial(retellCallId: string, denialCode = 'CO-50'): Promise<void> {
    const call = this.#requireCall(retellCallId);
    this.emit(retellCallId, {
      type: 'call.transcript',
      retellCallId,
      role: 'user',
      text: `That claim was denied — code ${denialCode}, non-covered service.`,
      timestamp: this.#clock().toISOString(),
    });
    await Promise.resolve();
    call.ended = true;
    this.emit(retellCallId, {
      type: 'call.ended',
      retellCallId,
      endedAt: this.#clock().toISOString(),
      durationSeconds: Math.max(
        1,
        Math.round((this.#clock().getTime() - call.startedAt.getTime()) / 1000),
      ),
      endReason: RetellCallEndReason.COMPLETED,
      collectedInfo: {
        claimStatus: 'denied',
        denialCode,
        denialReason: 'non-covered service',
        referenceNumber: 'REF-DENY-1',
        representativeName: 'Marcus',
        nextSteps: 'Resubmit with prior records',
      },
    });
  }

  /** Read-only view of every `startCall` invocation observed so far. */
  get startedCalls(): readonly StartCallInput[] {
    return this.#startedCalls;
  }

  /** Read-only view of every `endCall` invocation observed so far. */
  get endedCalls(): readonly EndCallInput[] {
    return this.#endedCalls;
  }

  /** Reset all internal state. Convenient between test bodies. */
  reset(): void {
    this.#calls.clear();
    this.#idempotencyIndex.clear();
    this.#listeners.clear();
    this.#buffered.clear();
    this.#startedCalls.length = 0;
    this.#endedCalls.length = 0;
    this.#counter = 0;
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

  #requireCall(retellCallId: string): InternalCall {
    const call = this.#calls.get(retellCallId);
    if (call === undefined) {
      throw new Error(`FakeRetell: no in-flight call for retellCallId=${retellCallId}`);
    }
    return call;
  }

  #endReasonForOperatorCause(reason: EndCallInput['reason']): RetellCallEndedEvent['endReason'] {
    // ADR-038/039 reasons the worker passes to endCall map onto the
    // Retell-side end_reason as best fits the LLM-rep dialogue: the
    // operator hangs up the call, so `agent_hangup`.
    switch (reason) {
      case 'operator_cancel':
      case 'duration_cap_exceeded':
      case 'hold_cap_exceeded':
        return RetellCallEndReason.AGENT_HANGUP;
      default:
        return RetellCallEndReason.COMPLETED;
    }
  }
}
