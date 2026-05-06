import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadEnv } from './env.js';

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
