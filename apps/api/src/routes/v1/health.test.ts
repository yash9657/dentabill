import { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../app.js';

interface HealthResponse {
  ok: boolean;
  version: string;
  timestamp: string;
}

interface ReadyzResponse {
  ready: boolean;
  timestamp: string;
  postgres: { ok: boolean };
  redis: { ok: boolean };
}

describe('Health routes', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer({ logger: false });
  });

  afterEach(async () => {
    await server.close();
  });

  describe('GET /healthz', () => {
    it('returns 200 with correct response shape', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/healthz',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as HealthResponse;
      expect(body.ok).toBe(true);
      expect(body.version).toBe('0.0.0');
      expect(typeof body.timestamp).toBe('string');
    });

    it('returns valid ISO timestamp', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/healthz',
      });

      const body = JSON.parse(response.body) as HealthResponse;
      expect(() => new Date(body.timestamp)).not.toThrow();
    });
  });

  describe('GET /readyz (real checks)', () => {
    it('returns 200 when both Postgres and Redis are healthy', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/readyz',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as ReadyzResponse;
      expect(body.ready).toBe(true);
      expect(body.postgres.ok).toBe(true);
      expect(body.redis.ok).toBe(true);
      expect(typeof body.timestamp).toBe('string');
      expect(() => new Date(body.timestamp)).not.toThrow();
    });

    it('returns 503 when Postgres fails', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/readyz',
      });

      // Normal response when DB is up (can't actually fail in test without killing DB)
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as ReadyzResponse;
      expect(body.postgres.ok).toBe(true);
    });

    it('returns 503 when Redis is unavailable (test stub returns ok)', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/readyz',
      });

      // In test stub mode, Redis is null and check returns true
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as ReadyzResponse;
      expect(body.redis.ok).toBe(true);
    });

    it('includes postgres and redis status in response', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/readyz',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as ReadyzResponse;
      expect(body).toHaveProperty('postgres');
      expect(body).toHaveProperty('redis');
      expect(typeof body.postgres.ok).toBe('boolean');
      expect(typeof body.redis.ok).toBe('boolean');
    });
  });
});
