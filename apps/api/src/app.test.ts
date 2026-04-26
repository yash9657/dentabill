import { ApiError } from '@dentabill/types';
import { type FastifyInstance } from 'fastify';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { buildServer } from './app.js';

describe('Error handler', () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await buildServer({ logger: false });

    // Register a test route that throws ApiError
    server.get('/test/api-error', () => {
      throw new ApiError('VALIDATION_ERROR', 'Test validation error');
    });

    // Register a test route that throws an unknown error
    server.get('/test/unknown-error', () => {
      throw new Error('Unknown error message that should not leak');
    });
  });

  afterEach(async () => {
    await server.close();
  });

  it('converts ApiError to JSON response with correct status', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/test/api-error',
    });

    expect(response.statusCode).toBe(400); // VALIDATION_ERROR maps to 400
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body).toEqual({
      error: true,
      message: 'Test validation error',
      code: 'VALIDATION_ERROR',
    });
  });

  it('handles unknown errors with generic message', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/test/unknown-error',
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body).toEqual({
      error: true,
      message: 'An unexpected error occurred. Please try again later.',
      code: 'INTERNAL_ERROR',
    });
    // Ensure the original error message is NOT in the response
    expect(body.message).not.toContain('Unknown error message');
  });

  it('returns 404 for unknown routes', async () => {
    const response = await server.inject({
      method: 'GET',
      url: '/nonexistent-route',
    });

    expect(response.statusCode).toBe(404);
  });
});
