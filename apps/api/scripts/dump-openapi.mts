#!/usr/bin/env tsx
/**
 * Boots the Fastify app in-process, asks `@fastify/swagger` for the
 * OpenAPI document, writes it to `packages/api-sdk/openapi.json`, and
 * exits. Used by `pnpm --filter @dentabill/api gen:openapi` and indirectly
 * by `pnpm gen:sdk` at the repo root.
 *
 * Why in-process and not `curl http://localhost:3001/docs/json`: avoids
 * the boot/teardown port-juggling that flakes in CI. Fastify's
 * `swagger()` method returns the document directly without going through
 * the HTTP layer.
 *
 * Output is committed to git. Reviewers see the wire shape change in
 * the same PR that changes the routes (ADR-017 — REST + Zod, OpenAPI is
 * authoritative for the SDK).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const OUTPUT = join(REPO_ROOT, 'packages', 'api-sdk', 'openapi.json');

// Stub env vars BEFORE any code path that touches `process.env` — in
// particular before `@dentabill/db` (Prisma) is imported, because the
// Prisma client autoloads `.env` from the project's working directory
// and our root `.env` ships keys present-but-empty (`RETELL_WEBHOOK_SECRET=`)
// for safe template defaults. An empty string slips past `??=` and would
// then trip `getEnv()`'s `.min(16)` Zod check at boot. So we both
// undefined-fill AND replace empty strings here, mirroring the
// `vitest.setup.ts` fallback policy.
const OPENAPI_DUMP_DEFAULTS: Record<string, string> = {
  // `test` so the queue plugin (P3-T16) installs the in-process stub
  // instead of opening a real BullMQ connection — the dump only needs
  // route registration to compute the OpenAPI document, never an
  // actual Redis socket.
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://placeholder@localhost:5432/placeholder',
  REDIS_URL: 'redis://localhost:6379',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  NEXT_PUBLIC_API_URL: 'http://localhost:3001',
  // `RETELL_WEBHOOK_SECRET` is `.min(16)`-validated by Zod (P3-T17).
  // The dump script never verifies a real webhook, so any 16+ char
  // placeholder suffices.
  RETELL_WEBHOOK_SECRET: 'openapi-dump-placeholder-secret-v1',
};
for (const [key, value] of Object.entries(OPENAPI_DUMP_DEFAULTS)) {
  const current = process.env[key];
  if (current === undefined || current === '') {
    process.env[key] = value;
  }
}

// Dynamic import AFTER env stubs land — a static import would hoist
// above the env writes and re-introduce the boot failure.
const { buildServer } = await import('../src/app.ts');

const fastify = await buildServer({ logger: false });
await fastify.ready();
const document = fastify.swagger();
await fastify.close();

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, JSON.stringify(document, null, 2) + '\n', 'utf8');
console.log(`Wrote OpenAPI document to ${OUTPUT}`);
