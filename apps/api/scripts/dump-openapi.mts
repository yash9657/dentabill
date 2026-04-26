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

import { buildServer } from '../src/app.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const OUTPUT = join(REPO_ROOT, 'packages', 'api-sdk', 'openapi.json');

// Stub the env vars the env loader requires when building the app
// in-process. None of these talk to a live database — `buildServer()`
// only needs them present so `getEnv()` doesn't throw.
process.env['NODE_ENV'] ??= 'development';
process.env['DATABASE_URL'] ??= 'postgres://placeholder@localhost:5432/placeholder';
process.env['REDIS_URL'] ??= 'redis://placeholder@localhost:6379';
process.env['NEXT_PUBLIC_APP_URL'] ??= 'http://localhost:3000';
process.env['NEXT_PUBLIC_API_URL'] ??= 'http://localhost:3001';

const fastify = await buildServer({ logger: false });
await fastify.ready();
const document = fastify.swagger();
await fastify.close();

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, JSON.stringify(document, null, 2) + '\n', 'utf8');
console.log(`Wrote OpenAPI document to ${OUTPUT}`);
