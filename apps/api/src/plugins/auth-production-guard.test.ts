import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { initEnv } from '../lib/env.js';

import { registerAuthPlugin } from './auth.js';

/**
 * The test-header fallback (`x-test-user-id`) is a complete authentication
 * bypass, so it must be impossible to reach it on a production boot. These
 * tests pin that: production without Clerk keys must REFUSE to start, not warn.
 */
describe('registerAuthPlugin — production requires real auth', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = {
      DATABASE_URL: 'postgres://test@localhost:5432/test',
      REDIS_URL: 'redis://localhost:6379',
      NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    };
  });

  afterEach(() => {
    process.env = original;
  });

  it('refuses to start in production when Clerk keys are absent', async () => {
    process.env.NODE_ENV = 'production';
    initEnv();
    const fastify = Fastify();
    await expect(registerAuthPlugin(fastify)).rejects.toThrow(/Refusing to start/);
    await fastify.close();
  });

  it('names the bypass in the error so the cause is unmistakable', async () => {
    process.env.NODE_ENV = 'production';
    initEnv();
    const fastify = Fastify();
    await expect(registerAuthPlugin(fastify)).rejects.toThrow(/x-test-user-id/);
    await fastify.close();
  });

  it('allows the fallback outside production, which the integration suite needs', async () => {
    process.env.NODE_ENV = 'test';
    initEnv();
    const fastify = Fastify();
    const auth = await registerAuthPlugin(fastify);
    expect(auth.hasClerkKeys).toBe(false);
    await fastify.close();
  });
});
