import { describe, expect, it } from 'vitest';

import { checkPayerHours, isWithinPayerHours } from './business-hours.js';

/**
 * All test instants are constructed via `Date.UTC(...)` so the suite
 * is independent of the developer's machine timezone (CI runs UTC,
 * Macs in CT/PT, etc.). Comments translate each UTC instant to the
 * relevant payer-local wall clock for readability.
 */

describe('checkPayerHours — Delta Dental PPO (America/Chicago, 8 AM – 5 PM, Mon–Fri)', () => {
  it('returns "open" mid-day on a weekday', () => {
    // Tuesday 2026-04-28 10:00 America/Chicago = 15:00 UTC.
    const now = new Date(Date.UTC(2026, 3, 28, 15, 0, 0));
    const result = checkPayerHours('DELTA_DENTAL_PPO', now);
    expect(result.state).toBe('open');
  });

  it('returns "closed" with reason=after_hours after 5 PM CT on a weekday', () => {
    // Tuesday 2026-04-28 18:00 America/Chicago = 23:00 UTC.
    const now = new Date(Date.UTC(2026, 3, 28, 23, 0, 0));
    const result = checkPayerHours('DELTA_DENTAL_PPO', now);
    if (result.state !== 'closed') throw new Error('expected closed');
    expect(result.reason).toBe('after_hours');
    expect(result.nextOpeningAt.getTime()).toBeGreaterThan(now.getTime());
  });

  it('returns "closed" with reason=before_hours before 8 AM CT on a weekday', () => {
    // Tuesday 2026-04-28 06:00 America/Chicago = 11:00 UTC.
    const now = new Date(Date.UTC(2026, 3, 28, 11, 0, 0));
    const result = checkPayerHours('DELTA_DENTAL_PPO', now);
    if (result.state !== 'closed') throw new Error('expected closed');
    expect(result.reason).toBe('before_hours');
  });

  it('returns "closed" with reason=non_business_day on a Saturday', () => {
    // Saturday 2026-04-25 12:00 America/Chicago = 17:00 UTC.
    const now = new Date(Date.UTC(2026, 3, 25, 17, 0, 0));
    const result = checkPayerHours('DELTA_DENTAL_PPO', now);
    if (result.state !== 'closed') throw new Error('expected closed');
    expect(result.reason).toBe('non_business_day');
  });

  it('next opening from Saturday lunchtime is Monday 8 AM CT', () => {
    // Saturday 2026-04-25 12:00 CT.
    const now = new Date(Date.UTC(2026, 3, 25, 17, 0, 0));
    const result = checkPayerHours('DELTA_DENTAL_PPO', now);
    if (result.state !== 'closed') throw new Error('expected closed');
    // Monday 2026-04-27 08:00 America/Chicago = 13:00 UTC (CDT, UTC-5).
    expect(result.nextOpeningAt.toISOString()).toBe('2026-04-27T13:00:00.000Z');
  });

  it('next opening from Tuesday after-hours is Wednesday 8 AM CT', () => {
    // Tuesday 2026-04-28 18:00 CT.
    const now = new Date(Date.UTC(2026, 3, 28, 23, 0, 0));
    const result = checkPayerHours('DELTA_DENTAL_PPO', now);
    if (result.state !== 'closed') throw new Error('expected closed');
    // Wednesday 2026-04-29 08:00 CDT = 13:00 UTC.
    expect(result.nextOpeningAt.toISOString()).toBe('2026-04-29T13:00:00.000Z');
  });

  it('next opening from Tuesday pre-hours is the same day at 8 AM CT', () => {
    // Tuesday 2026-04-28 06:00 CT = 11:00 UTC.
    const now = new Date(Date.UTC(2026, 3, 28, 11, 0, 0));
    const result = checkPayerHours('DELTA_DENTAL_PPO', now);
    if (result.state !== 'closed') throw new Error('expected closed');
    // Same Tuesday 08:00 CDT = 13:00 UTC.
    expect(result.nextOpeningAt.toISOString()).toBe('2026-04-28T13:00:00.000Z');
  });
});

describe('checkPayerHours — Cigna Dental (America/New_York, 8 AM – 6 PM, Mon–Fri)', () => {
  it('open at 5:30 PM ET on a Tuesday (still before 6 PM cutoff)', () => {
    // Tuesday 2026-04-28 17:30 ET = 21:30 UTC (EDT, UTC-4).
    const now = new Date(Date.UTC(2026, 3, 28, 21, 30, 0));
    expect(checkPayerHours('CIGNA_DENTAL', now).state).toBe('open');
  });

  it('closed at 6:00 PM ET on a Tuesday (cutoff is exclusive)', () => {
    // Tuesday 2026-04-28 18:00 ET = 22:00 UTC.
    const now = new Date(Date.UTC(2026, 3, 28, 22, 0, 0));
    expect(checkPayerHours('CIGNA_DENTAL', now).state).toBe('closed');
  });
});

describe('checkPayerHours — MetLife Dental (America/New_York, 8 AM – 8 PM, Mon–Fri)', () => {
  it('still open at 7:30 PM ET — longest evening window of the Phase-3 payers', () => {
    // Tuesday 2026-04-28 19:30 ET = 23:30 UTC.
    const now = new Date(Date.UTC(2026, 3, 28, 23, 30, 0));
    expect(checkPayerHours('METLIFE_DENTAL', now).state).toBe('open');
  });
});

describe('checkPayerHours — DST transition (America/Chicago)', () => {
  it('handles spring-forward correctly: Monday 9 AM CDT in March is open', () => {
    // 2026-03-09 (Mon, day after spring-forward) at 09:00 CDT = 14:00 UTC.
    const now = new Date(Date.UTC(2026, 2, 9, 14, 0, 0));
    expect(checkPayerHours('DELTA_DENTAL_PPO', now).state).toBe('open');
  });

  it('handles fall-back correctly: Monday 9 AM CST in November is open', () => {
    // 2026-11-02 (Mon, day after fall-back) at 09:00 CST = 15:00 UTC.
    const now = new Date(Date.UTC(2026, 10, 2, 15, 0, 0));
    expect(checkPayerHours('DELTA_DENTAL_PPO', now).state).toBe('open');
  });

  it('next opening in March correctly bridges spring-forward', () => {
    // Sunday 2026-03-08 12:00 CDT = 17:00 UTC (DST already active by noon).
    const now = new Date(Date.UTC(2026, 2, 8, 17, 0, 0));
    const result = checkPayerHours('DELTA_DENTAL_PPO', now);
    if (result.state !== 'closed') throw new Error('expected closed (Sunday)');
    // Monday 2026-03-09 08:00 CDT = 13:00 UTC.
    expect(result.nextOpeningAt.toISOString()).toBe('2026-03-09T13:00:00.000Z');
  });
});

describe('checkPayerHours — unsupported payers', () => {
  it.each(['AETNA_DENTAL', 'GUARDIAN_DENTAL', 'UNKNOWN'] as const)(
    '%s returns unsupported_payer',
    (code) => {
      const now = new Date(Date.UTC(2026, 3, 28, 15, 0, 0));
      const result = checkPayerHours(code, now);
      expect(result.state).toBe('unsupported_payer');
    },
  );
});

describe('isWithinPayerHours', () => {
  it('is true for open + false for closed', () => {
    const open = new Date(Date.UTC(2026, 3, 28, 15, 0, 0));
    const closed = new Date(Date.UTC(2026, 3, 25, 17, 0, 0));
    expect(isWithinPayerHours('DELTA_DENTAL_PPO', open)).toBe(true);
    expect(isWithinPayerHours('DELTA_DENTAL_PPO', closed)).toBe(false);
  });

  it('is false for unsupported payers (defensive default)', () => {
    expect(isWithinPayerHours('AETNA_DENTAL', new Date())).toBe(false);
  });
});
