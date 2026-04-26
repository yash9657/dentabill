import { type FastifyInstance } from 'fastify';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { buildServer } from '../../app.js';

interface HealthResponse {
  ok: boolean;
  version: string;
  timestamp: string;
}

interface ReadyzResponse {
  ready: boolean;
  timestamp: string;
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

  describe('GET /readyz', () => {
    it('returns 200 with correct response shape', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/readyz',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as ReadyzResponse;
      expect(body.ready).toBe(true);
      expect(typeof body.timestamp).toBe('string');
    });

    it('returns valid ISO timestamp', async () => {
      const response = await server.inject({
        method: 'GET',
        url: '/v1/readyz',
      });

      const body = JSON.parse(response.body) as ReadyzResponse;
      expect(() => new Date(body.timestamp)).not.toThrow();
    });
  });
});
