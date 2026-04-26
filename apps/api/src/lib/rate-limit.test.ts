import { type FastifyInstance } from 'fastify';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { buildServer } from '../app.js';

describe('Rate limiting', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer({ logger: false });

    // Register a test route
    server.get('/test/ping', () => {
      return { ok: true };
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it('allows requests within the limit', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/test/ping',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-ratelimit-limit']).toBeDefined();
  });

  it('blocks requests over the limit with 429', async () => {
    // The default limit is 300 requests per minute.
    // We'll send 301 rapid requests from the same IP.
    const responses: number[] = [];

    for (let i = 0; i < 301; i++) {
      const response = await server.inject({
        method: 'GET',
        url: '/test/ping',
      });
      responses.push(response.statusCode);
    }

    // Expect that at least one request hits the rate limit (429)
    const hasRateLimit = responses.some((status) => status === 429);
    expect(hasRateLimit).toBe(true);
  });
});
