import { describe, expect, it } from 'vitest';

import { loadSummaryWorkerEnv } from './env.js';

const baseValid = {
  REDIS_URL: 'redis://localhost:6379',
  DATABASE_URL: 'postgresql://dentabill:dentabill@localhost:5432/dentabill',
};

describe('loadSummaryWorkerEnv', () => {
  it('parses a minimal valid env', () => {
    const env = loadSummaryWorkerEnv(baseValid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.WORKER_PORT).toBe(3011);
    expect(env.QUEUE_CONCURRENCY).toBe(4);
    expect(env.SUMMARIZER_MAX_OUTPUT_TOKENS).toBe(4000);
    expect(env.SUMMARIZER_DAILY_TOKEN_BUDGET).toBe(1_000_000);
    expect(env.SUMMARIZER_AUTO_TRANSITION_ENABLED).toBe(false);
    expect(env.ANTHROPIC_API_KEY).toBe('');
  });

  it('coerces numeric overrides from string', () => {
    const env = loadSummaryWorkerEnv({
      ...baseValid,
      SUMMARIZER_MAX_OUTPUT_TOKENS: '6000',
      SUMMARIZER_DAILY_TOKEN_BUDGET: '500000',
    });
    expect(env.SUMMARIZER_MAX_OUTPUT_TOKENS).toBe(6000);
    expect(env.SUMMARIZER_DAILY_TOKEN_BUDGET).toBe(500_000);
  });

  it('treats KEY="" as absent (ADR-049)', () => {
    const env = loadSummaryWorkerEnv({
      ...baseValid,
      ANTHROPIC_API_KEY: '',
    });
    expect(env.ANTHROPIC_API_KEY).toBe('');
  });

  it('rejects a missing REDIS_URL', () => {
    const { REDIS_URL: _omit, ...rest } = baseValid;
    expect(() => loadSummaryWorkerEnv(rest)).toThrow(/REDIS_URL/);
  });

  it('coerces SUMMARIZER_AUTO_TRANSITION_ENABLED via Zod boolean', () => {
    expect(
      loadSummaryWorkerEnv({ ...baseValid, SUMMARIZER_AUTO_TRANSITION_ENABLED: 'true' })
        .SUMMARIZER_AUTO_TRANSITION_ENABLED,
    ).toBe(true);
  });
});
