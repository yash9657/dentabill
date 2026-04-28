import type { IvrStep, PayerIvrMap } from '../ivr/types.js';

import {
  DEFAULT_MISDETECT_PATTERNS,
  type NavigatorAction,
  type NavigatorOptions,
  type NavigatorVars,
} from './types.js';

/**
 * IVR Navigator (P3-T11) — pure decision logic.
 *
 * Consumes a `PayerIvrMap` (the declarative DTMF/SPEECH script for one
 * payer) plus the worker's call variables (NPI, subscriberId, …) and
 * walks the script step-by-step. The call-worker drives the navigator
 * with two methods:
 *
 *   - `next()`         — returns the next action to dispatch (WAIT,
 *                        DTMF, SPEECH, WAIT_FOR_HUMAN, or
 *                        ESCALATE_TO_OPERATOR). `null` when the script
 *                        is complete.
 *   - `onTranscript()` — fed every `call.transcript` event from the
 *                        Retell port. The navigator scans `system` /
 *                        `agent`-role lines for IVR misdetect phrases
 *                        and trips a retry counter; after
 *                        `maxRetriesPerStep` consecutive misdetects on
 *                        the same step the navigator yields an
 *                        `ESCALATE_TO_OPERATOR` action.
 *
 * The navigator is intentionally NOT generic over Retell — it never
 * imports anything from `./retell`. The worker (`apps/call-worker`) is
 * the only place that bridges navigator actions to live RetellPort
 * calls. This is the same separation we use for the IVR maps
 * themselves and lets us exhaustively unit-test against every step in
 * every payer map without a network or fake to mock.
 */
export interface IvrNavigator {
  /**
   * Pull the next action. Returns `null` once the script reaches the
   * terminal `WAIT_FOR_HUMAN` step and the worker has consumed it —
   * after which the navigator's job is done and the rep dialog
   * (handler.ts + Retell agent prompt) takes over.
   */
  next(): NavigatorAction | null;

  /**
   * Feed a transcript event back into the navigator. The text is
   * scanned for misdetect signals; on a hit the current step's retry
   * counter increments. Calling `next()` after `maxRetriesPerStep`
   * consecutive misdetects yields `ESCALATE_TO_OPERATOR` instead of
   * advancing.
   *
   * `role` filters the scan: only `system` / `agent` (the IVR's
   * synthesised voice) lines are inspected. `user`-role transcripts
   * are our own agent talking and would otherwise produce false
   * positives (e.g. our agent reading back "I didn't catch that, sorry"
   * to apologise for misspeaking).
   */
  onTranscript(text: string, role: 'agent' | 'user' | 'system'): void;

  /** Number of consecutive misdetects observed on the current step. */
  readonly currentStepRetries: number;

  /** Number of times the navigator has emitted ESCALATE_TO_OPERATOR. */
  readonly escalationCount: number;

  /** True once the script's terminal step has been consumed. */
  readonly isComplete: boolean;
}

export interface CreateIvrNavigatorInput {
  readonly map: PayerIvrMap;
  readonly vars: NavigatorVars;
  readonly options?: NavigatorOptions;
}

class NavigatorImpl implements IvrNavigator {
  readonly #steps: readonly IvrStep[];
  readonly #vars: NavigatorVars;
  readonly #maxRetries: number;
  readonly #operatorDigit: string;
  readonly #misdetectPatterns: readonly RegExp[];

  /**
   * Index into `#steps` of the step we will emit on the *next* call to
   * `next()`. When `cursor === #steps.length`, the script is complete.
   */
  #cursor = 0;
  #currentStepRetries = 0;
  #escalationCount = 0;
  /**
   * When true, the next `next()` returns ESCALATE_TO_OPERATOR (and
   * resets so the caller can decide whether to continue or end the
   * call). Set by `onTranscript` once the misdetect cap trips.
   */
  #escalateNext = false;

  constructor(input: CreateIvrNavigatorInput) {
    this.#steps = input.map.steps;
    this.#vars = input.vars;
    this.#maxRetries = input.options?.maxRetriesPerStep ?? 2;
    this.#operatorDigit = input.options?.operatorDigit ?? '0';
    this.#misdetectPatterns = input.options?.misdetectPatterns ?? DEFAULT_MISDETECT_PATTERNS;
  }

  next(): NavigatorAction | null {
    if (this.#escalateNext) {
      this.#escalateNext = false;
      this.#escalationCount += 1;
      return {
        type: 'ESCALATE_TO_OPERATOR',
        digit: this.#operatorDigit,
        reason: `IVR misdetect cap (${String(this.#maxRetries)}) hit on step ${String(this.#cursor)}`,
      };
    }
    const step = this.#steps[this.#cursor];
    if (step === undefined) {
      return null;
    }
    this.#cursor += 1;
    this.#currentStepRetries = 0;
    return translateStep(step, this.#vars);
  }

  onTranscript(text: string, role: 'agent' | 'user' | 'system'): void {
    // Our own agent's lines are role=user from Retell's perspective
    // (the LLM agent is the caller). Skip them — only inspect the IVR
    // side (agent or system role from the Retell stream).
    if (role === 'user') return;
    if (this.#cursor === 0) return; // No step has been emitted yet.
    const matched = this.#misdetectPatterns.some((re) => re.test(text));
    if (!matched) return;
    this.#currentStepRetries += 1;
    if (this.#currentStepRetries >= this.#maxRetries) {
      this.#escalateNext = true;
      // Do NOT decrement cursor: after an operator handoff we don't
      // re-issue the misdetected step — the operator (a human) will
      // reroute us. Cursor is left pointing at the next scripted step
      // so that, if the worker decides to continue the script post-
      // handoff, it picks up where it left off.
    }
  }

  get currentStepRetries(): number {
    return this.#currentStepRetries;
  }

  get escalationCount(): number {
    return this.#escalationCount;
  }

  get isComplete(): boolean {
    return this.#cursor >= this.#steps.length && !this.#escalateNext;
  }
}

export function createIvrNavigator(input: CreateIvrNavigatorInput): IvrNavigator {
  return new NavigatorImpl(input);
}

/**
 * Translate one declarative `IvrStep` into the runtime action the
 * worker will dispatch. Pure — never throws on a well-typed input;
 * unsupported `fromVar`s fall back to the empty string so the caller's
 * test suite catches the gap rather than the production call.
 */
function translateStep(step: IvrStep, vars: NavigatorVars): NavigatorAction {
  // exactOptionalPropertyTypes is on, so `note: undefined` is rejected;
  // we have to spread the property in only when it is set.
  const noteSpread = step.note === undefined ? {} : { note: step.note };
  switch (step.type) {
    case 'WAIT':
      return { type: 'WAIT', ms: step.ms, ...noteSpread };
    case 'DTMF':
      return { type: 'DTMF', digit: step.digit, ...noteSpread };
    case 'SPEECH':
      return {
        type: 'SPEECH',
        say: applyTemplates(step.say, vars),
        ...noteSpread,
      };
    case 'WAIT_FOR_HUMAN':
      return { type: 'WAIT_FOR_HUMAN', maxWaitMs: step.maxWaitMs, ...noteSpread };
    case 'COLLECT_VOICE_INPUT': {
      const value = resolveVar(step.fromVar, vars);
      return {
        type: 'SPEECH',
        say: spokenValue(step.fromVar, value),
        note: step.note ?? `Speak ${step.fromVar}.`,
      };
    }
    default:
      // The discriminated union is exhaustive at the type level; this
      // branch is unreachable but kept as a runtime guardrail.
      return assertNever(step);
  }
}

function resolveVar(
  name: 'memberId' | 'subscriberId' | 'npi' | 'claimNumber' | 'dateOfService',
  vars: NavigatorVars,
): string {
  switch (name) {
    case 'npi':
      return vars.npi;
    case 'subscriberId':
      return vars.subscriberId;
    case 'dateOfService':
      return vars.dateOfService;
    case 'memberId':
      return vars.memberId ?? '';
    case 'claimNumber':
      return vars.claimNumber ?? '';
  }
}

/**
 * Format a value for spoken delivery. Long digit strings (NPI,
 * subscriber IDs) are hyphen-separated so the LLM agent paces them
 * digit-by-digit; dates are spoken in their natural form rather than
 * read as digits.
 */
function spokenValue(
  name: 'memberId' | 'subscriberId' | 'npi' | 'claimNumber' | 'dateOfService',
  value: string,
): string {
  if (value.length === 0) return '';
  if (name === 'dateOfService') return value; // YYYY-MM-DD; agent prompt handles natural reading.
  // Insert a hyphen between every digit so an LLM TTS pauses naturally
  // — much higher recognition rate on the IVR side than a raw digit
  // string spoken at conversational speed.
  return value.split('').join('-');
}

const TEMPLATE_RE = /\{\{\s*(npi|subscriberId|dateOfService|memberId|claimNumber)\s*\}\}/g;

function applyTemplates(text: string, vars: NavigatorVars): string {
  return text.replace(TEMPLATE_RE, (_match, name: string) => {
    return resolveVar(
      name as 'memberId' | 'subscriberId' | 'npi' | 'claimNumber' | 'dateOfService',
      vars,
    );
  });
}

function assertNever(x: never): never {
  throw new Error(`IvrNavigator: unreachable step type ${JSON.stringify(x)}`);
}
