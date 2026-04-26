import { describe, expect, it } from 'vitest';

import { daysOutstandingSince, scoreClaim } from './priority.js';

describe('scoreClaim', () => {
  it('matches the PRD formula on the canonical sample', () => {
    // $4000, 30 days → amountScore=40, ageScore=60 → 0.6*40 + 0.4*60 = 48
    expect(scoreClaim({ claimAmount: 4000, daysOutstanding: 30 })).toBe(48);
  });

  it('caps amountScore at 100 ($10000+ saturates)', () => {
    expect(scoreClaim({ claimAmount: 10_000, daysOutstanding: 0 })).toBe(60);
    expect(scoreClaim({ claimAmount: 50_000, daysOutstanding: 0 })).toBe(60);
  });

  it('caps ageScore at 100 (50+ days saturates)', () => {
    expect(scoreClaim({ claimAmount: 0, daysOutstanding: 50 })).toBe(40);
    expect(scoreClaim({ claimAmount: 0, daysOutstanding: 365 })).toBe(40);
  });

  it('returns 0 for a brand-new $0 claim', () => {
    expect(scoreClaim({ claimAmount: 0, daysOutstanding: 0 })).toBe(0);
  });

  it('returns 100 for a maxed-out claim', () => {
    expect(scoreClaim({ claimAmount: 10_000, daysOutstanding: 50 })).toBe(100);
  });

  it('rounds the final score (no fractional priorities on disk)', () => {
    // $250, 7d → amountScore=2.5, ageScore=14 → 0.6*2.5 + 0.4*14 = 7.1 → round 7
    expect(scoreClaim({ claimAmount: 250, daysOutstanding: 7 })).toBe(7);
  });

  it('clamps negative inputs to 0 (defence-in-depth)', () => {
    expect(scoreClaim({ claimAmount: -500, daysOutstanding: 30 })).toBe(24);
    expect(scoreClaim({ claimAmount: 4000, daysOutstanding: -5 })).toBe(24);
    expect(scoreClaim({ claimAmount: -1, daysOutstanding: -1 })).toBe(0);
  });

  it('treats NaN / Infinity as 0', () => {
    expect(scoreClaim({ claimAmount: Number.NaN, daysOutstanding: 10 })).toBe(8);
    expect(scoreClaim({ claimAmount: Number.POSITIVE_INFINITY, daysOutstanding: 0 })).toBe(60);
  });

  it('is deterministic — same inputs, same output', () => {
    const a = scoreClaim({ claimAmount: 1234, daysOutstanding: 21 });
    const b = scoreClaim({ claimAmount: 1234, daysOutstanding: 21 });
    expect(a).toBe(b);
  });

  it('priority is monotonic non-decreasing in age (holding amount fixed)', () => {
    let prev = -1;
    for (const days of [0, 5, 10, 25, 50, 100]) {
      const score = scoreClaim({ claimAmount: 1000, daysOutstanding: days });
      expect(score).toBeGreaterThanOrEqual(prev);
      prev = score;
    }
  });

  it('priority is monotonic non-decreasing in amount (holding age fixed)', () => {
    let prev = -1;
    for (const amount of [0, 250, 1000, 5000, 10_000, 50_000]) {
      const score = scoreClaim({ claimAmount: amount, daysOutstanding: 14 });
      expect(score).toBeGreaterThanOrEqual(prev);
      prev = score;
    }
  });
});

describe('daysOutstandingSince', () => {
  it('floors the difference in whole days', () => {
    const now = new Date('2026-04-26T00:00:00.000Z');
    expect(daysOutstandingSince('2026-04-20T00:00:00.000Z', now)).toBe(6);
    expect(daysOutstandingSince('2026-04-26T12:00:00.000Z', now)).toBe(0);
  });

  it('returns 0 for a future date', () => {
    const now = new Date('2026-04-26T00:00:00.000Z');
    expect(daysOutstandingSince('2026-05-01T00:00:00.000Z', now)).toBe(0);
  });

  it('returns 0 for an invalid date', () => {
    expect(daysOutstandingSince('not-a-date')).toBe(0);
  });
});
