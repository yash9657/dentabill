import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv, payerHoursOverridden } from './env.js';

const ORIGINAL_ENV = process.env;

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('loadEnv — empty-string normalisation (ADR-049)', () => {
  it('treats KEY="" as absent and falls back to Zod default for DOB_HASH_SECRET', () => {
    process.env = {
      DATABASE_URL: 'postgres://test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      DOB_HASH_SECRET: '',
    };
    const env = loadEnv();
    expect(env.DOB_HASH_SECRET).toBe('dev-only-dob-hash-secret-rotate-before-production');
  });

  it('treats KEY="" as absent for RETELL_WEBHOOK_SECRET (otherwise .min(16) trips)', () => {
    process.env = {
      DATABASE_URL: 'postgres://test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      RETELL_WEBHOOK_SECRET: '',
    };
    expect(() => loadEnv()).not.toThrow();
    const env = loadEnv();
    expect(env.RETELL_WEBHOOK_SECRET).toBe(
      'dev-only-retell-webhook-secret-rotate-before-production',
    );
  });

  it('keeps explicit non-empty values verbatim', () => {
    process.env = {
      DATABASE_URL: 'postgres://test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      DOB_HASH_SECRET: 'my-explicit-dob-hash-secret-32-chars-long',
    };
    const env = loadEnv();
    expect(env.DOB_HASH_SECRET).toBe('my-explicit-dob-hash-secret-32-chars-long');
  });
});

describe('payerHoursOverridden — demo bypass interlock', () => {
  const base = {
    DATABASE_URL: 'postgres://test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  };

  it('is off by default', () => {
    process.env = { ...base };
    expect(payerHoursOverridden(loadEnv())).toBe(false);
  });

  it('is on when opted in and no telephony key is configured', () => {
    process.env = { ...base, DEMO_IGNORE_PAYER_HOURS: 'true' };
    expect(payerHoursOverridden(loadEnv())).toBe(true);
  });

  // The safety interlock: a real telephony key must win over the demo flag,
  // otherwise a production deployment that left the flag set could dial a
  // payer line that is genuinely closed.
  it('refuses to override once RETELL_API_KEY is present', () => {
    process.env = {
      ...base,
      DEMO_IGNORE_PAYER_HOURS: 'true',
      RETELL_API_KEY: 'key_live_abc123',
    };
    expect(payerHoursOverridden(loadEnv())).toBe(false);
  });

  it('treats an empty RETELL_API_KEY as absent (ADR-049 normalisation)', () => {
    process.env = { ...base, DEMO_IGNORE_PAYER_HOURS: 'true', RETELL_API_KEY: '' };
    expect(payerHoursOverridden(loadEnv())).toBe(true);
  });

  it('stays off when the flag is explicitly false even without telephony', () => {
    process.env = { ...base, DEMO_IGNORE_PAYER_HOURS: 'false' };
    expect(payerHoursOverridden(loadEnv())).toBe(false);
  });
});
