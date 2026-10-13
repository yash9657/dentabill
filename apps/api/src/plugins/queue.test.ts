/**
 * ADR-053 — job dispatch mode + no-Redis boot.
 */
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../app.js';
import { loadEnv, resolveInternalApiBaseUrl, sseMaxStreamMs } from '../lib/env.js';

import { registerQueuePlugin } from './queue.js';

const ORIGINAL_ENV = process.env;
const BASE = {
  DATABASE_URL: 'postgres://test@localhost:5432/test',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
};
const SECRET = 'an-internal-job-secret-that-is-at-least-32-chars';

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

afterEach(() => {
  process.env = ORIGINAL_ENV;
});

describe('loadEnv — JOB_DISPATCH_MODE', () => {
  it('defaults to bullmq and requires REDIS_URL there', () => {
    process.env = { ...BASE };
    expect(() => loadEnv()).toThrow(/REDIS_URL: required when JOB_DISPATCH_MODE=bullmq/);
    process.env = { ...BASE, REDIS_URL: 'redis://localhost:6379' };
    expect(loadEnv().JOB_DISPATCH_MODE).toBe('bullmq');
  });

  it('inline mode boots without REDIS_URL but requires INTERNAL_JOB_SECRET', () => {
    process.env = { ...BASE, JOB_DISPATCH_MODE: 'inline' };
    expect(() => loadEnv()).toThrow(/INTERNAL_JOB_SECRET/);
    process.env = { ...BASE, JOB_DISPATCH_MODE: 'inline', INTERNAL_JOB_SECRET: SECRET };
    const env = loadEnv();
    expect(env.JOB_DISPATCH_MODE).toBe('inline');
    expect(env.REDIS_URL).toBeUndefined();
  });

  it('sqs mode boots without REDIS_URL / INTERNAL_JOB_SECRET but requires JOBS_QUEUE_URL', () => {
    process.env = { ...BASE, JOB_DISPATCH_MODE: 'sqs' };
    expect(() => loadEnv()).toThrow(/JOBS_QUEUE_URL: required when JOB_DISPATCH_MODE=sqs/);
    process.env = {
      ...BASE,
      JOB_DISPATCH_MODE: 'sqs',
      JOBS_QUEUE_URL: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs',
    };
    const env = loadEnv();
    expect(env.JOB_DISPATCH_MODE).toBe('sqs');
    expect(env.INTERNAL_JOB_SECRET).toBeUndefined();
    expect(env.REDIS_URL).toBeUndefined();
  });

  it('accepts a TLS rediss:// URL (Upstash-style)', () => {
    process.env = { ...BASE, REDIS_URL: 'rediss://default:token@example.upstash.io:6379' };
    expect(loadEnv().REDIS_URL).toMatch(/^rediss:\/\//);
  });

  it('rejects an unknown mode', () => {
    process.env = { ...BASE, REDIS_URL: 'redis://x:6379', JOB_DISPATCH_MODE: 'kafka' };
    expect(() => loadEnv()).toThrow(/JOB_DISPATCH_MODE/);
  });
});

describe('resolveInternalApiBaseUrl', () => {
  const inline = { ...BASE, JOB_DISPATCH_MODE: 'inline', INTERNAL_JOB_SECRET: SECRET };

  it('prefers INTERNAL_API_BASE_URL', () => {
    process.env = {
      ...inline,
      INTERNAL_API_BASE_URL: 'https://api.dentabill.example',
      VERCEL_URL: 'dentabill-api-abc.vercel.app',
    };
    expect(resolveInternalApiBaseUrl(loadEnv())).toBe('https://api.dentabill.example');
  });

  it('uses the production domain on production deployments, else VERCEL_URL', () => {
    process.env = {
      ...inline,
      VERCEL_ENV: 'production',
      VERCEL_PROJECT_PRODUCTION_URL: 'dentabill-api.vercel.app',
      VERCEL_URL: 'dentabill-api-abc.vercel.app',
    };
    expect(resolveInternalApiBaseUrl(loadEnv())).toBe('https://dentabill-api.vercel.app');
    process.env = { ...inline, VERCEL_ENV: 'preview', VERCEL_URL: 'dentabill-api-abc.vercel.app' };
    expect(resolveInternalApiBaseUrl(loadEnv())).toBe('https://dentabill-api-abc.vercel.app');
  });

  it('falls back to the local listener', () => {
    process.env = { ...inline, PORT: '4001' };
    expect(resolveInternalApiBaseUrl(loadEnv())).toBe('http://127.0.0.1:4001');
  });
});

describe('sseMaxStreamMs', () => {
  it('is unbounded off-platform, 780 s on Vercel / Lambda, and overridable', () => {
    process.env = { ...BASE, REDIS_URL: 'redis://x:6379' };
    expect(sseMaxStreamMs(loadEnv())).toBeNull();
    process.env = { ...BASE, REDIS_URL: 'redis://x:6379', VERCEL: '1' };
    expect(sseMaxStreamMs(loadEnv())).toBe(780_000);
    process.env = { ...BASE, REDIS_URL: 'redis://x:6379', AWS_LAMBDA_FUNCTION_NAME: 'api' };
    expect(sseMaxStreamMs(loadEnv())).toBe(780_000);
    process.env = { ...BASE, REDIS_URL: 'redis://x:6379', VERCEL: '1', SSE_MAX_STREAM_MS: '5000' };
    expect(sseMaxStreamMs(loadEnv())).toBe(5_000);
  });
});

describe('registerQueuePlugin', () => {
  it('inline mode without Redis creates no Redis client and no BullMQ queues', async () => {
    const app = Fastify();
    registerQueuePlugin(app, {
      redisUrl: undefined,
      mode: 'inline',
      inline: { baseUrl: 'http://127.0.0.1:3001', secret: SECRET },
      stubInTest: false,
    });
    await app.ready();
    expect(app.queueRedis).toBeNull();
    expect(app.callEventsPublisher).toBeNull();
    expect(app.jobDispatcher.mode).toBe('inline');
    expect(() => app.callsQueue.add('call.place', {} as never)).toThrow(/inline/);
    await app.close();
  });

  it('sqs mode without Redis wires the SQS dispatcher and no BullMQ queues', async () => {
    const app = Fastify();
    registerQueuePlugin(app, {
      redisUrl: undefined,
      mode: 'sqs',
      sqs: { queueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789012/jobs' },
      stubInTest: false,
    });
    await app.ready();
    expect(app.queueRedis).toBeNull();
    expect(app.jobDispatcher.mode).toBe('sqs');
    expect(() => app.summariesQueue.add('summary.generate', {} as never)).toThrow(/sqs/);
    await app.close();
  });

  it('sqs mode refuses to start without a queue URL', () => {
    const app = Fastify();
    expect(() => {
      registerQueuePlugin(app, { redisUrl: undefined, mode: 'sqs', stubInTest: false });
    }).toThrow(/JOBS_QUEUE_URL/);
  });

  it('bullmq mode refuses to start without Redis', () => {
    const app = Fastify();
    expect(() => {
      registerQueuePlugin(app, { redisUrl: undefined, mode: 'bullmq', stubInTest: false });
    }).toThrow(/REDIS_URL/);
  });

  it('bullmq mode wires a BullMQ dispatcher over the shared Redis client', async () => {
    const app = Fastify();
    registerQueuePlugin(app, {
      redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
      mode: 'bullmq',
      stubInTest: false,
    });
    await app.ready();
    expect(app.jobDispatcher.mode).toBe('bullmq');
    expect(app.queueRedis).not.toBeNull();
    expect(app.callEventsPublisher).toBe(app.queueRedis);
    await app.callsQueue.waitUntilReady();
    await app.summariesQueue.waitUntilReady();
    await app.close();
  });
});

describe('GET /v1/readyz without Redis', () => {
  it('reports redis as skipped and stays ready when Postgres is up', async () => {
    const server = await buildServer({ logger: false });
    try {
      const response = await server.inject({ method: 'GET', url: '/v1/readyz' });
      const body = response.json<{ ready: boolean; redis: { ok: boolean; skipped?: boolean } }>();
      expect(body.redis).toEqual({ ok: true, skipped: true });
      expect(response.statusCode).toBe(body.ready ? 200 : 503);
    } finally {
      await server.close();
    }
  });
});
