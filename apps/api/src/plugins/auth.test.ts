import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../app.js';

describe('auth plugin (no Clerk keys path)', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    server = await buildServer({ logger: false });
  });

  afterEach(async () => {
    await server.close();
  });

  it('reports hasClerkKeys=false when no keys are configured', () => {
    expect(server.auth.hasClerkKeys).toBe(false);
  });

  it('returns 401 with AUTHENTICATION_REQUIRED on a protected route without test headers', async () => {
    const response = await server.inject({ method: 'GET', url: '/v1/me' });
    expect(response.statusCode).toBe(401);
    const body = response.json<{ code?: string }>();
    expect(body.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('returns the test identity when both x-test-user-id and x-test-org-id are present', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/v1/me',
      headers: {
        'x-test-user-id': 'user_test_1',
        'x-test-org-id': 'org_test_1',
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ userId: 'user_test_1', orgId: 'org_test_1' });
  });

  it('rejects when only the user header is set (orgId is required)', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { 'x-test-user-id': 'user_test_1' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects when an empty test header value is supplied', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/v1/me',
      headers: {
        'x-test-user-id': '',
        'x-test-org-id': 'org_test_1',
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it('leaves /healthz public and unprotected', async () => {
    const response = await server.inject({ method: 'GET', url: '/v1/healthz' });
    expect(response.statusCode).toBe(200);
  });
});
