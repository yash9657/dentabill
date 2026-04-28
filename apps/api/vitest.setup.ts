import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from 'dotenv';

/**
 * Test-time environment for `@dentabill/api`.
 *
 * Loading order:
 *   1. Read `.env` at the repo root if it exists (local dev convenience).
 *   2. Apply test-default placeholders for any required env that's still
 *      missing — `DATABASE_URL`, `REDIS_URL`, `NEXT_PUBLIC_APP_URL`. The
 *      Zod env loader (`src/lib/env.ts`) only checks shape, not
 *      reachability, so dummy URLs are sufficient — `server.inject()`
 *      never opens a real socket.
 *
 * Without this, CI test jobs that don't export every variable (the `test`
 * job in `.github/workflows/ci.yml` exports `DATABASE_URL` and
 * `REDIS_URL` but not `NEXT_PUBLIC_APP_URL`) crash at `getEnv()` before
 * any `it()` body runs. Seeding defaults here keeps tests hermetic — they
 * don't depend on a populated `.env` or on CI YAML staying in sync with
 * new schema fields.
 */
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '../../.env') });

const TEST_DEFAULTS: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  NEXT_PUBLIC_API_URL: 'http://localhost:3001',
  // P3-T17 — Retell webhook signature secret. Tests that hit the
  // webhook route override this in beforeAll with their own value;
  // every other test only needs the env to validate, not match.
  RETELL_WEBHOOK_SECRET: 'test-default-retell-webhook-secret-v1',
};

for (const [key, value] of Object.entries(TEST_DEFAULTS)) {
  // Empty strings from `.env` need replacing too — `dotenv` loads keys
  // present-but-empty as `''`, which is truthy under `??=` and would
  // bypass the default, leaving Zod's `.min(16)` checks angry.
  const current = process.env[key];
  if (current === undefined || current === '') {
    process.env[key] = value;
  }
}

/**
 * Clerk keys are explicitly UNSET in the test environment so the auth
 * plugin runs in deterministic test-header-bypass mode. With keys set,
 * `clerkPlugin` registration would attempt a network call to Clerk's
 * JWKS endpoint, which both slows tests and fails in CI without
 * outbound internet. Integration tests authenticate via the
 * `x-test-user-id` header path.
 */
delete process.env.CLERK_SECRET_KEY;
delete process.env.CLERK_PUBLISHABLE_KEY;
delete process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
