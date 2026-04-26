import { describe, expect, it } from 'vitest';

import { CLAIM_STATE_TRANSITIONS, isValidClaimTransition } from './claim-state.js';

describe('claim state machine', () => {
  it('allows every status to self-transition', () => {
    for (const status of Object.keys(
      CLAIM_STATE_TRANSITIONS,
    ) as (keyof typeof CLAIM_STATE_TRANSITIONS)[]) {
      expect(isValidClaimTransition(status, status), `${status} -> ${status}`).toBe(true);
    }
  });

  it('allows the canonical happy-path PENDING -> IN_QUEUE -> CALLING -> COMPLETED -> RESOLVED', () => {
    expect(isValidClaimTransition('PENDING', 'IN_QUEUE')).toBe(true);
    expect(isValidClaimTransition('IN_QUEUE', 'CALLING')).toBe(true);
    expect(isValidClaimTransition('CALLING', 'COMPLETED')).toBe(true);
    expect(isValidClaimTransition('COMPLETED', 'RESOLVED')).toBe(true);
  });

  it('blocks RESOLVED and WRITTEN_OFF as terminal states', () => {
    expect(isValidClaimTransition('RESOLVED', 'IN_QUEUE')).toBe(false);
    expect(isValidClaimTransition('RESOLVED', 'PENDING')).toBe(false);
    expect(isValidClaimTransition('WRITTEN_OFF', 'IN_QUEUE')).toBe(false);
    expect(isValidClaimTransition('WRITTEN_OFF', 'PENDING')).toBe(false);
  });

  it('blocks the obvious illegal jumps', () => {
    expect(isValidClaimTransition('PENDING', 'CALLING')).toBe(false);
    expect(isValidClaimTransition('PENDING', 'COMPLETED')).toBe(false);
    expect(isValidClaimTransition('IN_QUEUE', 'COMPLETED')).toBe(false);
    expect(isValidClaimTransition('CALLING', 'RESOLVED')).toBe(false);
  });

  it('allows DENIED to APPEALING and onward', () => {
    expect(isValidClaimTransition('DENIED', 'APPEALING')).toBe(true);
    expect(isValidClaimTransition('APPEALING', 'IN_QUEUE')).toBe(true);
    expect(isValidClaimTransition('APPEALING', 'RESOLVED')).toBe(true);
  });

  it('routes FAILED back through IN_QUEUE for retries', () => {
    expect(isValidClaimTransition('FAILED', 'IN_QUEUE')).toBe(true);
    expect(isValidClaimTransition('FAILED', 'CALLING')).toBe(false);
  });
});
