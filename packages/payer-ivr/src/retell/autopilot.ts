import type {
  EndCallInput,
  RetellCallEndedEvent,
  RetellEvent,
  StartCallInput,
  StartCallResult,
} from './events.js';
import { RetellCallEndReason } from './events.js';
import type { RetellEventListener, RetellPort } from './port.js';

/**
 * Demo autopilot (G-B5) — time-driven scenario driver for FakeRetell.
 *
 * Wraps a `RetellPort` instance and, when enabled, hijacks `startCall`
 * to drive a complete payer-appropriate call scenario (~75 seconds) with
 * scripted IVR navigation, hold, and rep conversation.
 *
 * Activation guard: `RETELL_API_KEY` empty/absent AND `DEMO_AUTOPILOT === 'true'`.
 * When inactive, the wrapped port's behaviour is completely untouched.
 *
 * Outcomes (happy path vs denial) are deterministic per `idempotencyKey`,
 * not random, so repeated demo clicks yield reproducible results.
 *
 * Timers are injectable (testing seam) so unit tests can drive the scenario
 * with fake timers instead of waiting 75 real seconds.
 */

export interface DemoAutopilotOptions {
  /** The underlying port to wrap (usually FakeRetell). */
  readonly port: RetellPort;
  /** Whether autopilot is enabled. Gated by env: `RETELL_API_KEY` empty AND `DEMO_AUTOPILOT === 'true'`. */
  readonly enabled: boolean;
  /** Override clock. Default: `() => new Date()`. */
  readonly clock?: () => Date;
  /** Override setTimeout. Default: `globalThis.setTimeout`. */
  readonly setTimeout?: typeof globalThis.setTimeout;
  /** Override clearTimeout. Default: `globalThis.clearTimeout`. */
  readonly clearTimeout?: typeof globalThis.clearTimeout;
}

interface PendingScenario {
  readonly retellCallId: string;
  readonly input: StartCallInput;
  readonly timers: Set<ReturnType<typeof globalThis.setTimeout>>;
  ended: boolean;
}

/**
 * Simple hash function to derive a deterministic outcome from a string.
 * Used to make demo outcomes reproducible per idempotencyKey without randomness.
 */
function deterministicHash(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    hash = (hash << 5) - hash + c;
    hash |= 0; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

export class DemoAutopilot implements RetellPort {
  readonly #port: RetellPort;
  readonly #enabled: boolean;
  readonly #clock: () => Date;
  readonly #setTimeout: typeof globalThis.setTimeout;
  readonly #clearTimeout: typeof globalThis.clearTimeout;
  readonly #scenarios = new Map<string, PendingScenario>();

  constructor(options: DemoAutopilotOptions) {
    this.#port = options.port;
    this.#enabled = options.enabled;
    this.#clock = options.clock ?? ((): Date => new Date());
    this.#setTimeout = options.setTimeout ?? globalThis.setTimeout;
    this.#clearTimeout = options.clearTimeout ?? globalThis.clearTimeout;
  }

  async startCall(input: StartCallInput): Promise<StartCallResult> {
    const result = await this.#port.startCall(input);

    if (this.#enabled) {
      const scenario: PendingScenario = {
        retellCallId: result.retellCallId,
        input,
        timers: new Set(),
        ended: false,
      };
      this.#scenarios.set(result.retellCallId, scenario);
      // Fire the scenario after the current event loop cycle so the caller
      // has time to subscribe.
      this.#scheduleScenario(scenario);
    }

    return result;
  }

  async endCall(input: EndCallInput): Promise<void> {
    const scenario = this.#scenarios.get(input.retellCallId);
    if (scenario !== undefined) {
      // Cancel all pending timers for this scenario.
      for (const timer of scenario.timers) {
        this.#clearTimeout(timer);
      }
      scenario.timers.clear();
      scenario.ended = true;
    }
    return this.#port.endCall(input);
  }

  subscribe(retellCallId: string, listener: RetellEventListener): () => void {
    return this.#port.subscribe(retellCallId, listener);
  }

  // ────────────────────────────────────────────────────────────────────
  // Scenario driver
  // ────────────────────────────────────────────────────────────────────

  #scheduleScenario(scenario: PendingScenario): void {
    // Determine outcome deterministically from idempotencyKey.
    // Hash modulo 10: 0-2 = denial, 3-9 = happy path.
    const hash = deterministicHash(scenario.input.idempotencyKey);
    const isDenial = hash % 10 < 3;

    // Helper to schedule a timer relative to now and track it.
    const schedule = (delayMs: number, fn: () => void): void => {
      if (scenario.ended) return;
      const timer = this.#setTimeout(fn, delayMs);
      scenario.timers.add(timer);
    };

    const scheduleEvent = (delayMs: number, event: RetellEvent): void => {
      schedule(delayMs, () => {
        if (scenario.ended) return;
        // We know at this point that the underlying port is FakeRetell,
        // because autopilot only activates when RETELL_API_KEY is empty.
        // Cast to access emit().
        const fake = this.#port as unknown as {
          emit(retellCallId: string, event: RetellEvent): void;
        };
        fake.emit(scenario.retellCallId, event);
      });
    };

    const timeMs = (): string => this.#clock().toISOString();

    // ── IVR navigation phase (~5-10s) ────────────────────────────────
    scheduleEvent(200, {
      type: 'call.transcript',
      retellCallId: scenario.retellCallId,
      role: 'system',
      text: 'Thank you for calling. Please enter your account number or say your name.',
      timestamp: timeMs(),
    });

    scheduleEvent(3_000, {
      type: 'call.transcript',
      retellCallId: scenario.retellCallId,
      role: 'agent',
      text: `I have account information for ${scenario.input.agentMetadata.subscriberId}.`,
      timestamp: timeMs(),
    });

    scheduleEvent(5_000, {
      type: 'call.transcript',
      retellCallId: scenario.retellCallId,
      role: 'system',
      text: 'Connecting to a representative. Your estimated wait time is 2 minutes.',
      timestamp: timeMs(),
    });

    // ── Hold phase (~10s) ────────────────────────────────────────────
    scheduleEvent(7_000, {
      type: 'call.transcript',
      retellCallId: scenario.retellCallId,
      role: 'system',
      text: 'Hold music plays. Please wait while we connect you with a representative.',
      timestamp: timeMs(),
    });

    // ── Rep conversation phase (~40-50s) ─────────────────────────────
    const repConversationStart = isDenial ? 15_000 : 17_000;

    scheduleEvent(repConversationStart, {
      type: 'call.transcript',
      retellCallId: scenario.retellCallId,
      role: 'user',
      text: "Hi, I'm following up on a claim for Dr. Smith's office.",
      timestamp: timeMs(),
    });

    scheduleEvent(repConversationStart + 2_500, {
      type: 'call.transcript',
      retellCallId: scenario.retellCallId,
      role: 'agent',
      text: `Great, let me pull up the claim for subscriber ${scenario.input.agentMetadata.subscriberId}.`,
      timestamp: timeMs(),
    });

    scheduleEvent(repConversationStart + 5_000, {
      type: 'call.transcript',
      retellCallId: scenario.retellCallId,
      role: 'agent',
      text: `I found the claim from ${scenario.input.agentMetadata.dateOfService}. Let me check the status.`,
      timestamp: timeMs(),
    });

    scheduleEvent(repConversationStart + 7_500, {
      type: 'call.transcript',
      retellCallId: scenario.retellCallId,
      role: 'user',
      text: 'Yes, thank you. Can you let me know the status?',
      timestamp: timeMs(),
    });

    if (isDenial) {
      // Denial outcome
      scheduleEvent(repConversationStart + 10_000, {
        type: 'call.transcript',
        retellCallId: scenario.retellCallId,
        role: 'agent',
        text: 'I see the claim was denied under code CO-50, non-covered service.',
        timestamp: timeMs(),
      });

      scheduleEvent(repConversationStart + 12_500, {
        type: 'call.transcript',
        retellCallId: scenario.retellCallId,
        role: 'agent',
        text: 'The denial code is CO-50. We can help you resubmit with additional documentation.',
        timestamp: timeMs(),
      });

      scheduleEvent(repConversationStart + 15_000, {
        type: 'call.transcript',
        retellCallId: scenario.retellCallId,
        role: 'user',
        text: 'What documentation would you recommend?',
        timestamp: timeMs(),
      });

      scheduleEvent(repConversationStart + 17_500, {
        type: 'call.transcript',
        retellCallId: scenario.retellCallId,
        role: 'agent',
        text: 'Please submit the prior records showing medical necessity along with the clinical notes.',
        timestamp: timeMs(),
      });

      scheduleEvent(repConversationStart + 20_000, {
        type: 'call.transcript',
        retellCallId: scenario.retellCallId,
        role: 'user',
        text: 'Thank you, I appreciate the help.',
        timestamp: timeMs(),
      });

      scheduleEvent(repConversationStart + 22_000, {
        type: 'call.transcript',
        retellCallId: scenario.retellCallId,
        role: 'agent',
        text: "You're welcome. Please call back once you have the documentation.",
        timestamp: timeMs(),
      });

      // End the call with denial
      schedule(repConversationStart + 24_000, () => {
        if (scenario.ended) return;
        scenario.ended = true;
        const fake = this.#port as unknown as {
          emit(retellCallId: string, event: RetellEvent): void;
        };
        const endEvent: RetellCallEndedEvent = {
          type: 'call.ended',
          retellCallId: scenario.retellCallId,
          endedAt: this.#clock().toISOString(),
          durationSeconds: 42,
          endReason: RetellCallEndReason.COMPLETED,
          collectedInfo: {
            claimStatus: 'denied',
            denialCode: 'CO-50',
            denialReason: 'non-covered service',
            referenceNumber: `REF-${String(hash % 10000)}`,
            representativeName: 'Marcus',
            nextSteps: 'Resubmit with prior records and clinical notes',
          },
        };
        fake.emit(scenario.retellCallId, endEvent);
        this.#scenarios.delete(scenario.retellCallId);
      });
    } else {
      // Happy path outcome
      scheduleEvent(repConversationStart + 10_000, {
        type: 'call.transcript',
        retellCallId: scenario.retellCallId,
        role: 'agent',
        text: 'Good news — the claim is approved.',
        timestamp: timeMs(),
      });

      scheduleEvent(repConversationStart + 12_500, {
        type: 'call.transcript',
        retellCallId: scenario.retellCallId,
        role: 'agent',
        text: `The approved amount is $345 and your reference number is REF-${String(hash % 10000)}`,
        timestamp: timeMs(),
      });

      scheduleEvent(repConversationStart + 15_000, {
        type: 'call.transcript',
        retellCallId: scenario.retellCallId,
        role: 'user',
        text: 'Excellent! Thank you so much.',
        timestamp: timeMs(),
      });

      scheduleEvent(repConversationStart + 17_500, {
        type: 'call.transcript',
        retellCallId: scenario.retellCallId,
        role: 'agent',
        text: "You're welcome. No further action is needed on our end.",
        timestamp: timeMs(),
      });

      scheduleEvent(repConversationStart + 20_000, {
        type: 'call.transcript',
        retellCallId: scenario.retellCallId,
        role: 'user',
        text: 'Perfect. Goodbye.',
        timestamp: timeMs(),
      });

      scheduleEvent(repConversationStart + 21_500, {
        type: 'call.transcript',
        retellCallId: scenario.retellCallId,
        role: 'agent',
        text: 'Goodbye, have a great day!',
        timestamp: timeMs(),
      });

      // End the call with happy outcome
      schedule(repConversationStart + 23_000, () => {
        if (scenario.ended) return;
        scenario.ended = true;
        const fake = this.#port as unknown as {
          emit(retellCallId: string, event: RetellEvent): void;
        };
        const endEvent: RetellCallEndedEvent = {
          type: 'call.ended',
          retellCallId: scenario.retellCallId,
          endedAt: this.#clock().toISOString(),
          durationSeconds: 40,
          endReason: RetellCallEndReason.COMPLETED,
          collectedInfo: {
            claimStatus: 'approved',
            amountApprovedCents: 34_500,
            referenceNumber: `REF-${String(hash % 10000)}`,
            representativeName: 'Janet',
            nextSteps: 'No further action required',
          },
        };
        fake.emit(scenario.retellCallId, endEvent);
        this.#scenarios.delete(scenario.retellCallId);
      });
    }
  }
}
