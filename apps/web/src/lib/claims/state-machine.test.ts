import { describe, expect, it } from 'vitest';

import { allowedTransitions, isTerminal } from './state-machine.js';

describe('claim state machine (web mirror)', () => {
  it('mirrors the canonical happy path PENDING -> IN_QUEUE -> CALLING -> COMPLETED -> RESOLVED', () => {
    expect(allowedTransitions('PENDING')).toContain('IN_QUEUE');
    expect(allowedTransitions('IN_QUEUE')).toContain('CALLING');
    expect(allowedTransitions('CALLING')).toContain('COMPLETED');
    expect(allowedTransitions('COMPLETED')).toContain('RESOLVED');
  });

  it('marks RESOLVED and WRITTEN_OFF as terminal', () => {
    expect(isTerminal('RESOLVED')).toBe(true);
    expect(isTerminal('WRITTEN_OFF')).toBe(true);
    expect(allowedTransitions('RESOLVED')).toEqual([]);
    expect(allowedTransitions('WRITTEN_OFF')).toEqual([]);
  });

  it('does not include illegal jumps like PENDING -> CALLING', () => {
    expect(allowedTransitions('PENDING')).not.toContain('CALLING');
    expect(allowedTransitions('PENDING')).not.toContain('COMPLETED');
  });

  it('routes FAILED back through IN_QUEUE for retries', () => {
    expect(allowedTransitions('FAILED')).toContain('IN_QUEUE');
    expect(allowedTransitions('FAILED')).not.toContain('CALLING');
  });
});
