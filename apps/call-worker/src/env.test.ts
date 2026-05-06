import { describe, expect, it } from 'vitest';

import { loadWorkerEnv } from './env.js';

describe('loadWorkerEnv', () => {
  const baseValid = {
    REDIS_URL: 'redis://localhost:6379',
    DATABASE_URL: 'postgresql://dentabill:dentabill@localhost:5432/dentabill',
  };

  it('parses a minimal valid env', () => {
    const env = loadWorkerEnv(baseValid);
    expect(env.REDIS_URL).toBe('redis://localhost:6379');
    expect(env.NODE_ENV).toBe('development');
    expect(env.WORKER_PORT).toBe(3010);
    expect(env.QUEUE_CONCURRENCY).toBe(4);
    expect(env.MAX_CALL_DURATION_MS).toBe(900_000);
    expect(env.MAX_HOLD_MS).toBe(600_000);
    expect(env.RETELL_API_KEY).toBe('');
  });

  it('coerces numeric overrides from string', () => {
    const env = loadWorkerEnv({
      ...baseValid,
      WORKER_PORT: '4000',
      QUEUE_CONCURRENCY: '8',
      MAX_CALL_DURATION_MS: '60000',
      MAX_HOLD_MS: '30000',
    });
    expect(env.WORKER_PORT).toBe(4000);
    expect(env.QUEUE_CONCURRENCY).toBe(8);
    expect(env.MAX_CALL_DURATION_MS).toBe(60_000);
    expect(env.MAX_HOLD_MS).toBe(30_000);
  });

  it('rejects a missing REDIS_URL', () => {
    const { REDIS_URL: _omit, ...rest } = baseValid;
    expect(() => loadWorkerEnv(rest)).toThrow(/REDIS_URL/);
  });

  it('rejects a missing DATABASE_URL', () => {
    const { DATABASE_URL: _omit, ...rest } = baseValid;
    expect(() => loadWorkerEnv(rest)).toThrow(/DATABASE_URL/);
  });

  it('rejects QUEUE_CONCURRENCY > 64', () => {
    expect(() => loadWorkerEnv({ ...baseValid, QUEUE_CONCURRENCY: '65' })).toThrow();
  });

  // ADR-049 — empty-string normalisation. dotenv loads `KEY=` lines
  // as `''`, which is truthy under `??=` and would bypass Zod
  // defaults. The loader must coerce `''` → `undefined` BEFORE Zod
  // runs so consumers see the schema-level defaults.
  it('treats KEY="" as absent (uses Zod default)', () => {
    const env = loadWorkerEnv({
      ...baseValid,
      RETELL_AGENT_ID_DELTA_DENTAL_PPO: '',
      WORKER_OUTBOUND_NUMBER: '',
    });
    expect(env.RETELL_AGENT_ID_DELTA_DENTAL_PPO).toBe('');
    expect(env.WORKER_OUTBOUND_NUMBER).toBe('+15555550100');
  });
});
