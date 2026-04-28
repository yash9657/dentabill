import { describe, expect, it } from 'vitest';

import { CIGNA_DENTAL_IVR, DELTA_DENTAL_PPO_IVR, METLIFE_DENTAL_IVR } from '../ivr/maps/index.js';
import { DTMF_TIMING, type PayerIvrMap } from '../ivr/types.js';

import { createIvrNavigator } from './navigator.js';
import type { NavigatorAction, NavigatorVars } from './types.js';

const baseVars: NavigatorVars = {
  npi: '1234567890',
  subscriberId: 'SUB123',
  dateOfService: '2026-01-15',
  memberId: 'M-001',
  claimNumber: 'CLM-9001',
};

function drain(map: PayerIvrMap, vars: NavigatorVars): NavigatorAction[] {
  const nav = createIvrNavigator({ map, vars });
  const out: NavigatorAction[] = [];
  for (let i = 0; i < map.steps.length + 5; i += 1) {
    const action = nav.next();
    if (action === null) break;
    out.push(action);
  }
  return out;
}

describe('createIvrNavigator — script translation (per-payer)', () => {
  it.each([
    ['Delta Dental PPO', DELTA_DENTAL_PPO_IVR],
    ['Cigna Dental', CIGNA_DENTAL_IVR],
    ['MetLife Dental', METLIFE_DENTAL_IVR],
  ])('emits exactly one action per scripted step for %s', (_label, map) => {
    const actions = drain(map, baseVars);
    expect(actions).toHaveLength(map.steps.length);
  });

  it.each([
    ['Delta Dental PPO', DELTA_DENTAL_PPO_IVR],
    ['Cigna Dental', CIGNA_DENTAL_IVR],
    ['MetLife Dental', METLIFE_DENTAL_IVR],
  ])('the terminal action is WAIT_FOR_HUMAN for %s', (_label, map) => {
    const actions = drain(map, baseVars);
    expect(actions[actions.length - 1]?.type).toBe('WAIT_FOR_HUMAN');
  });

  it.each([
    ['Delta Dental PPO', DELTA_DENTAL_PPO_IVR],
    ['Cigna Dental', CIGNA_DENTAL_IVR],
    ['MetLife Dental', METLIFE_DENTAL_IVR],
  ])('every DTMF action emits a single PRD §6 character for %s', (_label, map) => {
    const actions = drain(map, baseVars);
    for (const action of actions) {
      if (action.type === 'DTMF') {
        expect(action.digit).toMatch(/^[0-9*#]$/);
      }
    }
  });

  it('isComplete becomes true after the terminal step is consumed and next() returns null', () => {
    const nav = createIvrNavigator({ map: DELTA_DENTAL_PPO_IVR, vars: baseVars });
    expect(nav.isComplete).toBe(false);
    let action: NavigatorAction | null = nav.next();
    while (action !== null) action = nav.next();
    expect(nav.isComplete).toBe(true);
    expect(nav.next()).toBeNull();
  });
});

describe('createIvrNavigator — variable interpolation', () => {
  it('templates {{npi}} / {{subscriberId}} / {{dateOfService}} into SPEECH text', () => {
    const map: PayerIvrMap = {
      ...DELTA_DENTAL_PPO_IVR,
      steps: [
        {
          type: 'SPEECH',
          say: 'Provider {{npi}}, subscriber {{subscriberId}}, DOS {{dateOfService}}.',
          waitAfter: DTMF_TIMING.POST_SPEECH_MS,
        },
        {
          type: 'WAIT_FOR_HUMAN',
          maxWaitMs: 60_000,
        },
      ],
    };
    const nav = createIvrNavigator({ map, vars: baseVars });
    const action = nav.next();
    expect(action).not.toBeNull();
    expect(action!.type).toBe('SPEECH');
    if (action!.type !== 'SPEECH') return;
    expect(action!.say).toBe('Provider 1234567890, subscriber SUB123, DOS 2026-01-15.');
  });

  it('hyphenates digit strings on COLLECT_VOICE_INPUT for clearer TTS pacing', () => {
    const map: PayerIvrMap = {
      ...DELTA_DENTAL_PPO_IVR,
      steps: [
        { type: 'COLLECT_VOICE_INPUT', fromVar: 'npi', waitAfter: 0 },
        { type: 'COLLECT_VOICE_INPUT', fromVar: 'subscriberId', waitAfter: 0 },
        { type: 'WAIT_FOR_HUMAN', maxWaitMs: 60_000 },
      ],
    };
    const [npiAction, subAction] = drain(map, baseVars);
    expect(npiAction?.type).toBe('SPEECH');
    if (npiAction?.type !== 'SPEECH') return;
    expect(npiAction.say).toBe('1-2-3-4-5-6-7-8-9-0');
    expect(subAction?.type).toBe('SPEECH');
    if (subAction?.type !== 'SPEECH') return;
    expect(subAction.say).toBe('S-U-B-1-2-3');
  });

  it('passes dateOfService through unhyphenated so TTS reads it naturally', () => {
    const map: PayerIvrMap = {
      ...DELTA_DENTAL_PPO_IVR,
      steps: [
        { type: 'COLLECT_VOICE_INPUT', fromVar: 'dateOfService', waitAfter: 0 },
        { type: 'WAIT_FOR_HUMAN', maxWaitMs: 60_000 },
      ],
    };
    const [dosAction] = drain(map, baseVars);
    if (dosAction?.type !== 'SPEECH') {
      throw new Error('expected SPEECH');
    }
    expect(dosAction.say).toBe('2026-01-15');
  });

  it('falls back to empty string for an undefined optional variable', () => {
    const map: PayerIvrMap = {
      ...DELTA_DENTAL_PPO_IVR,
      steps: [
        { type: 'COLLECT_VOICE_INPUT', fromVar: 'memberId', waitAfter: 0 },
        { type: 'WAIT_FOR_HUMAN', maxWaitMs: 60_000 },
      ],
    };
    const sparseVars: NavigatorVars = { ...baseVars };
    delete (sparseVars as { memberId?: string }).memberId;
    const [action] = drain(map, sparseVars);
    if (action?.type !== 'SPEECH') {
      throw new Error('expected SPEECH');
    }
    expect(action.say).toBe('');
  });
});

describe('createIvrNavigator — misdetect retry policy', () => {
  function nav(maxRetries = 2) {
    return createIvrNavigator({
      map: {
        ...DELTA_DENTAL_PPO_IVR,
        steps: [
          { type: 'DTMF', digit: '2', waitBefore: 0, waitAfter: DTMF_TIMING.INTER_DIGIT_MS },
          { type: 'DTMF', digit: '1', waitBefore: 0, waitAfter: DTMF_TIMING.INTER_DIGIT_MS },
          { type: 'WAIT_FOR_HUMAN', maxWaitMs: 60_000 },
        ],
      },
      vars: baseVars,
      options: { maxRetriesPerStep: maxRetries },
    });
  }

  it('escalates to operator after maxRetriesPerStep IVR misdetects on a step', () => {
    const n = nav();
    const first = n.next();
    expect(first?.type).toBe('DTMF');
    n.onTranscript("I didn't catch that.", 'system');
    expect(n.currentStepRetries).toBe(1);
    n.onTranscript('Please try again.', 'system');
    expect(n.currentStepRetries).toBe(2);

    const next = n.next();
    expect(next?.type).toBe('ESCALATE_TO_OPERATOR');
    if (next?.type === 'ESCALATE_TO_OPERATOR') {
      expect(next.digit).toBe('0');
      expect(next.reason).toMatch(/cap/i);
    }
    expect(n.escalationCount).toBe(1);
  });

  it('does NOT escalate when the misdetect cap is not reached', () => {
    const n = nav();
    n.next();
    n.onTranscript("I didn't catch that.", 'system');
    expect(n.currentStepRetries).toBe(1);
    const followUp = n.next();
    expect(followUp?.type).not.toBe('ESCALATE_TO_OPERATOR');
  });

  it('ignores user-role transcript when scanning for misdetects', () => {
    const n = nav();
    n.next();
    // Our agent reads back an apology — must NOT count as IVR misdetect.
    n.onTranscript("I didn't catch that, sorry, repeating.", 'user');
    expect(n.currentStepRetries).toBe(0);
  });

  it('resets the per-step retry counter when a step advances normally', () => {
    const n = nav();
    n.next();
    n.onTranscript("I didn't catch that.", 'system');
    expect(n.currentStepRetries).toBe(1);
    n.next(); // advance to next step
    expect(n.currentStepRetries).toBe(0);
  });

  it('respects a custom operatorDigit', () => {
    const n = createIvrNavigator({
      map: {
        ...DELTA_DENTAL_PPO_IVR,
        steps: [
          { type: 'DTMF', digit: '2', waitBefore: 0, waitAfter: DTMF_TIMING.INTER_DIGIT_MS },
          { type: 'WAIT_FOR_HUMAN', maxWaitMs: 60_000 },
        ],
      },
      vars: baseVars,
      options: { maxRetriesPerStep: 1, operatorDigit: '9' },
    });
    n.next();
    n.onTranscript('Invalid entry.', 'system');
    const escalation = n.next();
    if (escalation?.type !== 'ESCALATE_TO_OPERATOR') {
      throw new Error('expected ESCALATE_TO_OPERATOR');
    }
    expect(escalation.digit).toBe('9');
  });

  it('disables misdetect detection when patterns array is empty', () => {
    const n = createIvrNavigator({
      map: {
        ...DELTA_DENTAL_PPO_IVR,
        steps: [
          { type: 'DTMF', digit: '2', waitBefore: 0, waitAfter: DTMF_TIMING.INTER_DIGIT_MS },
          { type: 'WAIT_FOR_HUMAN', maxWaitMs: 60_000 },
        ],
      },
      vars: baseVars,
      options: { misdetectPatterns: [] },
    });
    n.next();
    n.onTranscript("I didn't catch that.", 'system');
    n.onTranscript('Please try again.', 'system');
    expect(n.currentStepRetries).toBe(0);
  });

  it('ignores misdetects emitted before any step has been issued', () => {
    const n = nav();
    n.onTranscript("I didn't catch that.", 'system');
    expect(n.currentStepRetries).toBe(0);
  });
});

describe('createIvrNavigator — DEFAULT_MISDETECT_PATTERNS coverage', () => {
  it.each([
    "I didn't catch that",
    'I did not understand',
    'Please try again',
    'Invalid entry',
    'That is invalid',
    "Sorry, I didn't get that",
  ])('matches "%s" as a misdetect', (phrase) => {
    const n = createIvrNavigator({
      map: {
        ...DELTA_DENTAL_PPO_IVR,
        steps: [
          { type: 'DTMF', digit: '1', waitBefore: 0, waitAfter: 0 },
          { type: 'WAIT_FOR_HUMAN', maxWaitMs: 60_000 },
        ],
      },
      vars: baseVars,
      options: { maxRetriesPerStep: 1 },
    });
    n.next();
    n.onTranscript(phrase, 'system');
    const next = n.next();
    expect(next?.type).toBe('ESCALATE_TO_OPERATOR');
  });
});
