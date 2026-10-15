import type { SelectedTranscriptTurn } from '@dentabill/types';

import type { CallEvent } from './types.js';

export interface PhoneTreeStep {
  readonly id: string;
  readonly kind: 'menu' | 'info' | 'hold' | 'human';
  readonly label: string;
}

type Turn = Pick<SelectedTranscriptTurn, 'id' | 'role' | 'text'>;

const DIGIT_WORDS: Readonly<Record<string, string>> = {
  zero: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
};
const MENU_PROMPT =
  /\bfor ([a-z][a-z '-]{1,40}?),? press (\d|zero|one|two|three|four|five|six|seven|eight|nine)\b/i;
const AGENT_PRESS =
  /\b(?:press(?:ing|ed)?|key)\s+(\d|zero|one|two|three|four|five|six|seven|eight|nine)\b/i;
const IVR_ACK = /\backnowledged key (\d|zero|one|two|three|four|five|six|seven|eight|nine)\b/i;
const REP_INTRO = /\b[Tt]his is ([A-Z][a-z]+)\b/;
const INFO_PROMPTS: readonly (readonly [RegExp, string])[] = [
  [/\bNPI\b/, 'Gave NPI'],
  [/\bsubscriber id\b/i, 'Gave subscriber ID'],
  [/\bdate of service\b/i, 'Gave date of service'],
];

function digit(raw: string | undefined): string | undefined {
  return raw === undefined ? undefined : (DIGIT_WORDS[raw.toLowerCase()] ?? raw);
}

function isRemote(turn: Turn): boolean {
  return turn.role === 'system' || turn.role === 'remote';
}

/** Index of the first turn that is evidently a person speaking for the payer. */
function representativeIndex(turns: readonly Turn[]): number {
  return turns.findIndex(
    (turn) =>
      turn.role === 'representative' || (turn.role === 'remote' && REP_INTRO.test(turn.text)),
  );
}

/** The payer representative's first name, only when they said it ("this is Denise"). */
export function representativeName(turns: readonly Turn[]): string | null {
  const turn = turns[representativeIndex(turns)];
  return turn ? (REP_INTRO.exec(turn.text)?.[1] ?? null) : null;
}

/**
 * Summarise how the agent got through the payer's phone menu, using only what the
 * transcript records. A menu option counts only when a later turn shows the key
 * press; an information prompt counts only when the agent answered it next.
 * Returns [] when nothing is supported by the data.
 */
export function derivePhoneTreePath(
  turns: readonly Turn[],
  call: { readonly humanReached: boolean; readonly holdTimeSeconds: number | null },
): PhoneTreeStep[] {
  const repAt = representativeIndex(turns);
  const ivr = repAt === -1 ? turns : turns.slice(0, repAt);
  const steps: PhoneTreeStep[] = [];
  const push = (step: PhoneTreeStep): void => {
    if (steps.at(-1)?.label !== step.label) steps.push(step);
  };

  ivr.forEach((turn, index) => {
    if (!isRemote(turn)) return;
    const menu = MENU_PROMPT.exec(turn.text);
    if (menu?.[1] && menu[2]) {
      const key = digit(menu[2]);
      const later = ivr.slice(index + 1);
      const end = later.findIndex((next) => isRemote(next) && MENU_PROMPT.test(next.text));
      const pressed = (end === -1 ? later : later.slice(0, end)).some((next) => {
        const evidence =
          next.role === 'agent' ? AGENT_PRESS.exec(next.text) : IVR_ACK.exec(next.text);
        return digit(evidence?.[1]) === key;
      });
      if (pressed) {
        const option = menu[1].trim();
        push({
          id: turn.id,
          kind: 'menu',
          label: `${option.charAt(0).toUpperCase()}${option.slice(1)} · pressed ${String(key)}`,
        });
      }
      return;
    }
    if (ivr[index + 1]?.role === 'agent') {
      for (const [pattern, label] of INFO_PROMPTS)
        if (pattern.test(turn.text)) push({ id: `${turn.id}:${label}`, kind: 'info', label });
    }
    if (/\bhold\b/i.test(turn.text)) {
      push({
        id: turn.id,
        kind: 'hold',
        label:
          call.holdTimeSeconds === null
            ? 'On hold'
            : `On hold · ${formatDuration(call.holdTimeSeconds)}`,
      });
    }
  });

  const rep = turns[repAt];
  if (rep) {
    const name = representativeName(turns);
    push({
      id: rep.id,
      kind: 'human',
      label: name ? `Reached ${name}` : 'Reached a representative',
    });
  } else if (call.humanReached) {
    push({ id: 'human-reached', kind: 'human', label: 'Reached a representative' });
  }
  return steps;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The next step the call itself recorded on its end event (`collectedInfo.nextSteps`). */
export function recordedNextStep(events: readonly CallEvent[]): string | null {
  let found: string | null = null;
  for (const event of events) {
    if (event.eventType !== 'call.ended' && event.eventType !== 'webhook.call.ended') continue;
    const next = record(event.data.collectedInfo)?.nextSteps;
    if (typeof next === 'string' && next.trim().length > 0) found = next.trim();
  }
  return found;
}

export function formatDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  if (minutes === 0) return `${String(rest)}s`;
  return rest === 0 ? `${String(minutes)}m` : `${String(minutes)}m ${String(rest)}s`;
}
