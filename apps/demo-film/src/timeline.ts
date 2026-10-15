import durations from './durations.json';
import { s } from './theme';

/** Measured clip lengths, written from public/audio/manifest.json by `pnpm sync-durations`. */
const d = (id: keyof typeof durations): number => durations[id];

export interface Cue {
  readonly id: string;
  readonly kind: 'voice' | 'dtmf' | 'hold' | 'ring';
  readonly speaker?: 'ivr' | 'agent' | 'rep';
  readonly text?: string;
  readonly digits?: string;
  /** Seconds from the start of the call scene. */
  readonly at: number;
  readonly len: number;
}

const LINES: Record<string, { speaker: 'ivr' | 'agent' | 'rep'; text: string }> = {
  ivr1: {
    speaker: 'ivr',
    text: 'Thanks for calling Delta Dental. For provider services, press 2.',
  },
  ivr2: { speaker: 'ivr', text: 'For claim status, press 1.' },
  ivr3: { speaker: 'ivr', text: 'Enter the provider NPI.' },
  ivr5: { speaker: 'ivr', text: 'Please hold for the next available representative.' },
  rep1: { speaker: 'rep', text: 'Provider services, this is Marcus.' },
  agent2: {
    speaker: 'agent',
    text: 'Hi Marcus! I’m checking a claim for DEMO1042, date of service September 18.',
  },
  rep2: {
    speaker: 'rep',
    text: 'I see it. That claim is pending review. Follow up in 10 business days. Reference SIM-2026-1042.',
  },
  agent3: { speaker: 'agent', text: 'Perfect. Thanks, Marcus!' },
};

/** Lay the call out back to back with short, natural gaps. */
function buildCall(): Cue[] {
  const cues: Cue[] = [];
  let t = 0;
  const add = (cue: Omit<Cue, 'at'>, gapBefore: number): void => {
    t += gapBefore;
    cues.push({ ...cue, at: t });
    t += cue.len;
  };
  const voice = (id: string, gap: number): void => {
    add({ id, kind: 'voice', ...LINES[id], len: d(`voice_${id}` as keyof typeof durations) }, gap);
  };

  add({ id: 'ring', kind: 'ring', len: 1.2 }, 0.2);
  voice('ivr1', 0.25);
  add({ id: 'dtmf_2', kind: 'dtmf', digits: '2', len: 0.2 }, 0.3);
  voice('ivr2', 0.35);
  add({ id: 'dtmf_1', kind: 'dtmf', digits: '1', len: 0.2 }, 0.3);
  voice('ivr3', 0.35);
  add({ id: 'dtmf_npi', kind: 'dtmf', digits: '1234567893', len: d('dtmf_npi') }, 0.25);
  voice('ivr5', 0.35);
  add({ id: 'hold', kind: 'hold', len: 2.3 }, 0.1);
  voice('rep1', 0.15);
  voice('agent2', 0.3);
  voice('rep2', 0.3);
  voice('agent3', 0.3);
  return cues;
}

export const CALL = buildCall();
export const cue = (id: string): Cue => {
  const found = CALL.find((c) => c.id === id);
  if (!found) throw new Error(`No cue ${id}`);
  return found;
};
const callEnd = CALL[CALL.length - 1].at + CALL[CALL.length - 1].len;

/** Scene boundaries in frames. Music bars are 60 frames (120 BPM). */
export const T = (() => {
  const hook = 0;
  const logo = s(4);
  const queue = s(8);
  const call = s(15.5);
  const callLen = s(callEnd + 0.6);
  const outcome = call + callLen;
  const scale = outcome + s(4);
  const end = scale + s(5.5);
  const total = end + s(5.5);
  return { hook, logo, queue, call, callLen, outcome, scale, end, total };
})();

/** Absolute frame of a call cue. */
export const at = (id: string, offset = 0): number => T.call + s(cue(id).at + offset);
export const until = (id: string): number => T.call + s(cue(id).at + cue(id).len);
