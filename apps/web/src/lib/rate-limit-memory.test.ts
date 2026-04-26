import { describe, expect, it } from 'vitest';

import { recordHit, type RateLimitConfig } from './rate-limit-memory.js';

/**
 * Each test instantiates its own `RateLimitConfig` object so the
 * WeakMap-keyed store is isolated per case, no shared state across
 * tests.
 */

describe('recordHit()', () => {
  it('allows up to `max` hits in the window', () => {
    const cfg: RateLimitConfig = { windowMs: 1000, max: 3 };
    const now = 1_000_000;
    expect(recordHit('a', cfg, now).ok).toBe(true);
    expect(recordHit('a', cfg, now + 1).ok).toBe(true);
    expect(recordHit('a', cfg, now + 2).ok).toBe(true);
  });

  it('rejects the next hit and reports a retry-after', () => {
    const cfg: RateLimitConfig = { windowMs: 1000, max: 2 };
    const now = 2_000_000;
    recordHit('b', cfg, now);
    recordHit('b', cfg, now + 100);
    const blocked = recordHit('b', cfg, now + 200);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('recovers when older hits roll out of the window', () => {
    const cfg: RateLimitConfig = { windowMs: 1000, max: 2 };
    const now = 3_000_000;
    recordHit('c', cfg, now);
    recordHit('c', cfg, now + 100);
    expect(recordHit('c', cfg, now + 200).ok).toBe(false);
    // Step forward past the window: the first two hits roll off.
    expect(recordHit('c', cfg, now + 1500).ok).toBe(true);
  });

  it('keeps separate counters per key', () => {
    const cfg: RateLimitConfig = { windowMs: 1000, max: 1 };
    const now = 4_000_000;
    expect(recordHit('alice', cfg, now).ok).toBe(true);
    expect(recordHit('bob', cfg, now).ok).toBe(true);
    expect(recordHit('alice', cfg, now + 1).ok).toBe(false);
    expect(recordHit('bob', cfg, now + 1).ok).toBe(false);
  });

  it('reports a positive remaining count when under the cap', () => {
    const cfg: RateLimitConfig = { windowMs: 1000, max: 5 };
    const now = 5_000_000;
    const r1 = recordHit('d', cfg, now);
    expect(r1.remaining).toBe(4);
    const r2 = recordHit('d', cfg, now + 10);
    expect(r2.remaining).toBe(3);
  });
});
