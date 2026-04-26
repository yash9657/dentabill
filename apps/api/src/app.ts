import { randomUUID } from 'crypto';

import { createLogger, type Logger } from '@dentabill/logger';
import { ApiError } from '@dentabill/types';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import sensible from '@fastify/sensible';
import swagger from '@fastify/swagger';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';
import {
  createSerializerCompiler,
  jsonSchemaTransform,
  validatorCompiler,
} from 'fastify-type-provider-zod';

import { getEnv } from './lib/env.js';
import { healthRoutes } from './routes/v1/health.js';

export interface BuildServerOptions {
  /**
   * Optional custom logger. If false, logging is disabled (useful in tests).
   * If not provided, creates a default logger.
   */
  logger?: Logger | false;
}

/**
 * Builds and configures a Fastify server instance.
 * The instance is ready to inject requests against but not yet bound to a port.
 *
 * Usage in server.ts: `const server = buildServer(); await server.listen(...);`
 * Usage in tests: `const server = buildServer({ logger: false }); await server.inject(...);`
 */
export async function buildServer(opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  const env = getEnv();

  // Determine logger configuration
  const loggerConfig =
    opts.logger === false
      ? false
      : (opts.logger ??
        createLogger({
          level: env.NODE_ENV === 'production' ? 'info' : 'debug',
        }));

  // Create Fastify instance
  // Use type assertion only for the actual incompatibility; Fastify types are complex
  const fastifyOptions = {
    genReqId: () => randomUUID(),
    trustProxy: true,
  } as const;

  const loggerOption = loggerConfig === false ? false : loggerConfig;
  // Type assertion needed because of complex Fastify type internals (http2 vs http1)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  const fastify = Fastify({
    ...fastifyOptions,
    logger: loggerOption,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any) as unknown as FastifyInstance;

  // Register Zod type provider
  fastify.setValidatorCompiler(validatorCompiler);
  fastify.setSerializerCompiler(createSerializerCompiler());

  // Register sensible plugin (httpErrors factories)
  await fastify.register(sensible);

  /**
   * @fastify/swagger walks every route's Zod schemas and emits an OpenAPI
   * 3.1 document. `jsonSchemaTransform` from fastify-type-provider-zod
   * unwraps the Zod types into JSON Schema. The spec is exposed at
   * `/docs/json` so `pnpm gen:openapi` can curl it and feed the result
   * into `packages/api-sdk` for typed-client codegen (ADR-017).
   */
  await fastify.register(swagger, {
    openapi: {
      info: {
        title: 'DentaBill API',
        description:
          'Internal REST API for the DentaBill dashboard and CSV ingestion. Generated from Zod schemas — see ADR-017.',
        version: '0.0.0',
      },
      servers: [
        {
          url: env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
          description: env.NODE_ENV,
        },
      ],
      components: {
        securitySchemes: {
          // Phase 2 auth lands with @clerk/fastify (P2-T37); document the
          // bearer-token shape now so generated clients are aligned.
          bearer: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
    },
    transform: jsonSchemaTransform,
  });

  /**
   * Headless JSON endpoint at `/docs/json` — we deliberately omit
   * `@fastify/swagger-ui` for now to keep the surface minimal. The SDK
   * codegen pipeline only needs the JSON; an interactive UI is a Phase 5
   * follow-up alongside the cloud target.
   */
  fastify.get('/docs/json', () => fastify.swagger());

  // Register CORS
  const corsOrigins = env.API_CORS_ORIGINS
    ? env.API_CORS_ORIGINS.split(',').map((s) => s.trim())
    : [];
  await fastify.register(cors, {
    origin: [env.NEXT_PUBLIC_APP_URL, ...corsOrigins],
  });

  // Register rate limiting
  await fastify.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
  });

  // Global error handler — converts thrown ApiError to JSON response
  fastify.setErrorHandler((err, req, reply) => {
    if (ApiError.isApiError(err)) {
      // Known error with a code and status
      const status = err.statusCode || 500;
      return reply.code(status).send(err.toJson());
    }

    // Unknown error — never leak message to client, log the stack
    const requestId = req.id;
    if (loggerConfig) {
      req.log.error({ err, requestId }, 'Unhandled error in request');
    }

    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const status = (err as { statusCode?: number | undefined }).statusCode || 500;
    const publicMessage = 'An unexpected error occurred. Please try again later.';
    return reply.code(status).send({
      error: true,
      message: publicMessage,
      code: 'INTERNAL_ERROR',
    });
  });

  // Register health routes
  await fastify.register(healthRoutes, { prefix: '/v1' });

  return fastify;
}
