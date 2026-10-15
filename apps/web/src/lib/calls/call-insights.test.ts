import { selectCallTranscript } from '@dentabill/types';
import { describe, expect, it } from 'vitest';

import {
  derivePhoneTreePath,
  formatDuration,
  recordedNextStep,
  representativeName,
} from './call-insights.js';
import type { CallEvent } from './types.js';

let seq = 0;
function turn(role: string, text: string): CallEvent {
  seq += 1;
  return {
    id: `t${String(seq).padStart(3, '0')}`,
    eventType: 'call.transcript',
    data: { role, text },
    timestamp: new Date(Date.UTC(2026, 9, 14, 12, 0, seq)).toISOString(),
  };
}
const flags: { humanReached: boolean; holdTimeSeconds: number | null } = {
  humanReached: false,
  holdTimeSeconds: null,
};
const labels = (events: CallEvent[], call = flags): string[] =>
  derivePhoneTreePath(selectCallTranscript(events).turns, call).map((step) => step.label);

describe('derivePhoneTreePath', () => {
  it('summarises the runtime demo script from its recorded turns', () => {
    const events = [
      turn('system', 'Simulated call for demonstration only. No payer has been contacted.'),
      turn('system', 'Welcome to the simulated line. Please enter the subscriber ID.'),
      turn('agent', 'Subscriber ID DEMO1042.'),
      turn('system', 'For claim status, press 2.'),
      turn('agent', 'Simulating key 2 for claim status.'),
      turn('system', 'Simulating transfer to a representative.'),
      turn('system', 'Simulated hold. No audio is playing.'),
      turn('user', 'Simulated Delta Dental PPO provider services, this is Denise.'),
      turn('agent', 'Calling about date of service 2026-09-18.'),
    ];
    expect(labels(events, { humanReached: false, holdTimeSeconds: 95 })).toEqual([
      'Gave subscriber ID',
      'Claim status · pressed 2',
      'On hold · 1m 35s',
      'Reached Denise',
    ]);
  });

  it('follows the local navigator trace, using menu acknowledgements as key evidence', () => {
    const events = [
      turn('system', 'For provider services, press two.'),
      turn('system', 'Local synthetic menu acknowledged key 2.'),
      turn('system', 'For claim status, press one.'),
      turn('system', 'Local synthetic menu acknowledged key 1.'),
      turn('system', 'Provider NPI?'),
      turn('agent', '1-2-3-4-5-6-7-8-9-3'),
      turn('system', 'Subscriber ID?'),
      turn('agent', 'D-E-M-O-1-0-4-2'),
      turn('system', 'Date of service?'),
      turn('agent', '2026-09-18'),
      turn('user', 'The claim is pending review. Follow up in ten business days.'),
    ];
    // The final line names nobody and the call does not confirm human contact.
    expect(labels(events)).toEqual([
      'Provider services · pressed 2',
      'Claim status · pressed 1',
      'Gave NPI',
      'Gave subscriber ID',
      'Gave date of service',
    ]);
    expect(labels(events, { humanReached: true, holdTimeSeconds: null }).at(-1)).toBe(
      'Reached a representative',
    );
  });

  it('never claims a key press or answer the transcript does not show', () => {
    const events = [
      turn('system', 'For claim status, press 2.'),
      turn('agent', 'Pressing 3.'),
      turn('system', 'Please enter the subscriber ID.'),
      turn('system', 'For eligibility, press 4.'),
    ];
    expect(labels(events)).toEqual([]);
    expect(labels([])).toEqual([]);
  });

  it('ignores menu-like words spoken after the representative answers', () => {
    const events = [
      turn('representative', 'This is Marcus. You can call back and press 2 for claim status.'),
      turn('agent', 'Pressing 2.'),
    ];
    expect(labels(events)).toEqual(['Reached Marcus']);
  });
});

describe('call insight helpers', () => {
  it('reads the representative name only from an introduction', () => {
    const turns = selectCallTranscript([
      turn('system', 'This is a recorded line.'),
      turn('user', 'Provider services, this is Priya.'),
    ]).turns;
    expect(representativeName(turns)).toBe('Priya');
    expect(representativeName(selectCallTranscript([turn('user', 'Hello.')]).turns)).toBeNull();
  });

  it('returns the next step recorded on the latest end event', () => {
    const ended = (id: string, collectedInfo: unknown): CallEvent => ({
      id,
      eventType: 'call.ended',
      data: { collectedInfo },
      timestamp: '2026-10-14T12:10:00.000Z',
    });
    expect(
      recordedNextStep([ended('a', { nextSteps: '  Follow up in ten business days. ' })]),
    ).toBe('Follow up in ten business days.');
    expect(recordedNextStep([ended('a', { nextSteps: '' }), ended('b', null)])).toBeNull();
    expect(recordedNextStep([turn('agent', 'nextSteps')])).toBeNull();
  });

  it('formats durations for people', () => {
    expect(formatDuration(38)).toBe('38s');
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(75)).toBe('1m 15s');
  });
});
