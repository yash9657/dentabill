import { describe, expect, it } from 'vitest';

import { selectCallTranscript, type TranscriptEvent } from './call-transcript.js';

function event(id: string, eventType: string, data: unknown, second: number): TranscriptEvent {
  return { id, eventType, data, timestamp: new Date(Date.UTC(2026, 9, 13, 12, 0, second)) };
}

function snapshot(text: string | null, role: 'agent' | 'user' = 'user'): Record<string, unknown> {
  return {
    transcript: { text, turns: text === null ? [] : [{ role, text, startOffsetSeconds: 2.5 }] },
  };
}

describe('selectCallTranscript', () => {
  it('selects one latest provisional snapshot, never concatenating cumulative copies', () => {
    const result = selectCallTranscript([
      event('one', 'webhook.call.transcript_snapshot', snapshot('Hello'), 1),
      event('two', 'webhook.call.transcript_snapshot', snapshot('Hello again'), 2),
      event('three', 'webhook.call.transcript_snapshot', snapshot('Hello again'), 3),
    ]);
    expect(result.kind).toBe('provisional');
    expect(result.turns.map((turn) => turn.text)).toEqual(['Hello again']);
    expect(result.turns[0]).toMatchObject({ role: 'remote', startOffsetSeconds: 2.5 });
  });

  it('uses receipt ordering for provisional corrections even if the latest text is shorter', () => {
    const result = selectCallTranscript([
      event('later', 'webhook.call.transcript_snapshot', snapshot('Unpaid.'), 2),
      event(
        'earlier',
        'webhook.call.transcript_snapshot',
        snapshot('The claim is paid in full.'),
        1,
      ),
    ]);
    expect(result.rawText).toBe('Unpaid.');
  });

  it('prefers final source over a later intermediate snapshot and synthetic turns', () => {
    const result = selectCallTranscript([
      event('fake', 'call.transcript', { role: 'representative', text: 'FAKE PAID' }, 4),
      event('late', 'webhook.call.transcript_snapshot', snapshot('Old intermediate'), 5),
      event('final', 'webhook.call.ended', snapshot('Exact final.'), 3),
    ]);
    expect(result.kind).toBe('final');
    expect(result.rawText).toBe('Exact final.');
    expect(result.turns.map((turn) => turn.text)).toEqual(['Exact final.']);
  });

  it('preserves plain final text exactly as one source block without inventing speakers', () => {
    const text = '  Agent: Hello.\nUser: A claim.\n\n';
    const result = selectCallTranscript([
      event('final', 'webhook.call.ended', { transcript: { text, turns: null } }, 1),
    ]);
    expect(result.rawText).toBe(text);
    expect(result.turns).toHaveLength(1);
    expect(result.turns[0]).toMatchObject({ role: 'source', text });
  });

  it.each([
    { text: '', turns: [] },
    { text: null, turns: [] },
    { text: null, turns: null },
  ])('explicit final empty transcript suppresses every fallback (%j)', (transcript) => {
    const result = selectCallTranscript([
      event('fake', 'call.transcript', { role: 'agent', text: 'Synthetic evidence' }, 1),
      event('final', 'webhook.call.ended', { transcript }, 2),
      event('late', 'webhook.call.transcript_snapshot', snapshot('Partial evidence'), 3),
    ]);
    expect(result.kind).toBe('final');
    expect(result.turns).toEqual([]);
    expect(result.rawText).toBe(transcript.text);
  });

  it('does not substitute legacy turns when a real terminal event lacks transcript evidence', () => {
    expect(
      selectCallTranscript([
        event('fake', 'call.transcript', { role: 'agent', text: 'Synthetic evidence' }, 1),
        event('final', 'webhook.call.ended', {}, 2),
      ]),
    ).toEqual({ kind: 'unavailable', rawText: null, turns: [] });
  });

  it('ignores lifecycle text, model analysis, tool results, and unknown speaker roles', () => {
    expect(
      selectCallTranscript([
        event('lifecycle', 'call.started', { text: 'Life cycle text' }, 1),
        event('tool', 'tool.result', { text: 'Generated amount' }, 2),
        event('analysis', 'call.analyzed', { transcript: 'Generated analysis' }, 3),
        event('unknown', 'call.transcript', { role: 'tool', text: 'Tool result' }, 4),
      ]),
    ).toEqual({ kind: 'unavailable', rawText: null, turns: [] });
  });

  it('retains legacy demo turns when no real provider transcript source exists', () => {
    const result = selectCallTranscript([
      event('agent', 'call.transcript', { role: 'agent', text: 'Hello' }, 1),
      event('remote', 'call.transcript', { role: 'user', text: 'Enter your ID' }, 2),
      event('ended', 'call.ended', {}, 3),
    ]);
    expect(result.kind).toBe('legacy');
    expect(result.turns.map((turn) => turn.role)).toEqual(['agent', 'remote']);
  });
});
