import { renderTurnText, selectDemoScenario, type DemoScenario } from './demo-scenarios.js';
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
 * to drive a complete payer-appropriate call scenario with scripted IVR
 * navigation, hold, and rep conversation.
 *
 * Activation guard: `RETELL_API_KEY` empty/absent AND `DEMO_AUTOPILOT === 'true'`.
 * When inactive, the wrapped port's behaviour is completely untouched.
 *
 * Outcomes are deterministic per `idempotencyKey`, not random, so repeated
 * demo clicks yield reproducible results — but they are drawn from a library
 * of six distinct conversations (`demo-scenarios.ts`) rather than the two
 * inline branches this previously carried, so a fleet of concurrent demo calls
 * reads as six different calls instead of clones.
 *
 * Timers are injectable (testing seam) so unit tests can drive the scenario
 * with fake timers instead of waiting out the full call.
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

  #emit(retellCallId: string, event: RetellEvent): void {
    // The underlying port is FakeRetell whenever autopilot is active, because
    // activation requires RETELL_API_KEY to be empty. Cast to reach emit().
    const fake = this.#port as unknown as {
      emit(retellCallId: string, event: RetellEvent): void;
    };
    fake.emit(retellCallId, event);
  }

  #scheduleScenario(pending: PendingScenario): void {
    const hash = deterministicHash(pending.input.idempotencyKey);
    const script: DemoScenario = selectDemoScenario(hash);

    const vars = {
      subscriberId: pending.input.agentMetadata.subscriberId,
      dateOfService: pending.input.agentMetadata.dateOfService,
    };

    const schedule = (delayMs: number, fn: () => void): void => {
      if (pending.ended) return;
      const timer = this.#setTimeout(fn, delayMs);
      pending.timers.add(timer);
    };

    for (const turn of script.turns) {
      schedule(turn.atMs, () => {
        if (pending.ended) return;
        this.#emit(pending.retellCallId, {
          type: 'call.transcript',
          retellCallId: pending.retellCallId,
          role: turn.role,
          text: renderTurnText(turn.text, vars),
          timestamp: this.#clock().toISOString(),
        });
      });
    }

    // End the call two seconds after the final scripted line.
    const lastTurnAtMs = script.turns.reduce((max, turn) => Math.max(max, turn.atMs), 0);

    schedule(lastTurnAtMs + 2_000, () => {
      if (pending.ended) return;
      pending.ended = true;

      const { outcome } = script;
      const endEvent: RetellCallEndedEvent = {
        type: 'call.ended',
        retellCallId: pending.retellCallId,
        endedAt: this.#clock().toISOString(),
        durationSeconds: script.durationSeconds,
        endReason: RetellCallEndReason.COMPLETED,
        collectedInfo: {
          claimStatus: outcome.claimStatus,
          referenceNumber: outcome.referenceNumber,
          representativeName: outcome.representativeName,
          nextSteps: outcome.nextSteps,
          ...(outcome.denialCode !== undefined ? { denialCode: outcome.denialCode } : {}),
          ...(outcome.denialReason !== undefined ? { denialReason: outcome.denialReason } : {}),
          ...(outcome.amountApprovedCents !== undefined
            ? { amountApprovedCents: outcome.amountApprovedCents }
            : {}),
          scenarioId: script.id,
        },
      };
      this.#emit(pending.retellCallId, endEvent);
      this.#scenarios.delete(pending.retellCallId);
    });
  }
}
