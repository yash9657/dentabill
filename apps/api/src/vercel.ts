/**
 * Vercel Node.js function entry (ADR-053).
 *
 * One function serves every route: `scripts/build-vercel.mjs` bundles this
 * file into `.vercel/output/functions/index.func` and routes `/(.*)` to it.
 * The Fastify instance is built once per function instance and reused
 * across invocations (Fluid Compute runs many requests per instance).
 *
 * Requests are handed to Fastify's own request listener, so streaming
 * responses (SSE via `reply.raw.write`) flow straight through to Vercel's
 * streaming response support.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { FastifyInstance } from 'fastify';

import { buildServer } from './app.js';
import { initEnv } from './lib/env.js';

let app: Promise<FastifyInstance> | null = null;

function getApp(): Promise<FastifyInstance> {
  app ??= (async (): Promise<FastifyInstance> => {
    initEnv();
    const server = await buildServer();
    await server.ready();
    return server;
  })().catch((err: unknown) => {
    // Do not cache a failed boot — the next request retries.
    app = null;
    throw err;
  });
  return app;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const server = await getApp();
  // Settle only when the response is done, so the platform never treats a
  // still-streaming response (SSE) as finished.
  const finished = new Promise<void>((resolve) => {
    res.once('close', resolve);
    res.once('finish', resolve);
  });
  server.server.emit('request', req, res);
  await finished;
}
