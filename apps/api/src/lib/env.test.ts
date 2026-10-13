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

  it('leaves webhook verification unconfigured when RETELL_WEBHOOK_SECRET is empty', () => {
    process.env = {
      DATABASE_URL: 'postgres://test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
      RETELL_WEBHOOK_SECRET: '',
    };
    expect(() => loadEnv()).not.toThrow();
    const env = loadEnv();
    expect(env.RETELL_WEBHOOK_SECRET).toBeUndefined();
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

describe('loadEnv — Retell webhook credentials', () => {
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://test@localhost:5432/test',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    JOB_DISPATCH_MODE: 'sqs',
    JOBS_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/000000000000/test-jobs',
  };

  it('boots the AWS no-key demo without inventing a verification credential', () => {
    process.env = {
      ...base,
      DEMO_IGNORE_PAYER_HOURS: 'true',
    };
    const env = loadEnv();
    expect(env.RETELL_WEBHOOK_SECRET).toBeUndefined();
    expect(env.RETELL_API_KEY).toBeUndefined();
    expect(payerHoursOverridden(env)).toBe(true);
  });

  it.each([undefined, '', '   '])(
    'rejects live telephony with a missing or blank webhook credential (%j)',
    (webhookKey) => {
      process.env = {
        ...base,
        RETELL_API_KEY: 'outbound-test-key',
        RETELL_WEBHOOK_SECRET: webhookKey,
      };
      expect(() => loadEnv()).toThrow('RETELL_WEBHOOK_SECRET');
      expect(() => loadEnv()).not.toThrow('outbound-test-key');
    },
  );

  it('preserves an explicitly chosen webhook key independent of the outbound key', () => {
    process.env = {
      ...base,
      RETELL_API_KEY: 'outbound-test-key',
      RETELL_WEBHOOK_SECRET: 'webhook-designated-test-key',
    };
    const env = loadEnv();
    expect(env.RETELL_WEBHOOK_SECRET).toBe('webhook-designated-test-key');
    expect(env.RETELL_API_KEY).toBe('outbound-test-key');
  });

  it('can configure inbound verification without enabling outbound telephony', () => {
    process.env = {
      ...base,
      RETELL_WEBHOOK_SECRET: 'webhook-designated-test-key',
      DEMO_IGNORE_PAYER_HOURS: 'true',
    };
    const env = loadEnv();
    expect(env.RETELL_API_KEY).toBeUndefined();
    expect(payerHoursOverridden(env)).toBe(true);
  });

  it('rejects a whitespace-only outbound key', () => {
    process.env = { ...base, RETELL_API_KEY: '   ' };
    expect(() => loadEnv()).toThrow('RETELL_API_KEY');
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
      RETELL_WEBHOOK_SECRET: 'webhook-designated-test-key',
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

describe('loadEnv — reviewed observation configuration', () => {
  const base = {
    DATABASE_URL: 'postgres://test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  };

  it('boots with no observation credentials and an explicit operational allowance default', () => {
    process.env = {
      ...base,
      FIREWORKS_API_KEY: '',
      OBSERVATION_IMPLEMENTATION_ARTIFACT_SHA256: '',
    };
    const config = loadEnv();
    expect(config.FIREWORKS_API_KEY).toBeUndefined();
    expect(config.OBSERVATION_IMPLEMENTATION_ARTIFACT_SHA256).toBeUndefined();
    expect(config.SUMMARIZER_DAILY_TOKEN_BUDGET).toBe(1_000_000);
  });

  it('accepts server credentials independently of release approval or artifact availability', () => {
    process.env = {
      ...base,
      FIREWORKS_API_KEY: 'synthetic-credential',
      SUMMARIZER_DAILY_TOKEN_BUDGET: '200000',
    };
    expect(loadEnv()).toMatchObject({
      FIREWORKS_API_KEY: 'synthetic-credential',
      SUMMARIZER_DAILY_TOKEN_BUDGET: 200_000,
    });
    process.env.OBSERVATION_IMPLEMENTATION_ARTIFACT_SHA256 = 'a'.repeat(64);
    expect(loadEnv().OBSERVATION_IMPLEMENTATION_ARTIFACT_SHA256).toBe('a'.repeat(64));
  });

  it.each(['short', 'A'.repeat(64), 'https://example.test/artifact'])(
    'rejects an invalid artifact binding without disclosing the credential',
    (artifact) => {
      process.env = {
        ...base,
        FIREWORKS_API_KEY: 'synthetic-private-credential',
        OBSERVATION_IMPLEMENTATION_ARTIFACT_SHA256: artifact,
      };
      expect(() => loadEnv()).toThrow('OBSERVATION_IMPLEMENTATION_ARTIFACT_SHA256');
      expect(() => loadEnv()).not.toThrow('synthetic-private-credential');
    },
  );

  it.each(['0', '-1', '1.5', '9007199254740992'])(
    'rejects an invalid operational allowance %s',
    (limit) => {
      process.env = { ...base, SUMMARIZER_DAILY_TOKEN_BUDGET: limit };
      expect(() => loadEnv()).toThrow('SUMMARIZER_DAILY_TOKEN_BUDGET');
    },
  );
});
