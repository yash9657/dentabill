import { afterAll, afterEach, beforeAll } from 'vitest';

import { prisma } from '../src/client.js';

/**
 * Vitest setup for `@dentabill/db` integration tests.
 *
 * Tests run against a separate Postgres database (`dentabill_test`) so
 * dev data is never touched. The DATABASE_URL is set in vitest.config.ts
 * via `test.env` and read by the prisma singleton on first import.
 *
 * Each test gets a clean schema: tables are TRUNCATEd in CASCADE between
 * tests. RESTART IDENTITY zeroes any sequence counters.
 *
 * Schema is assumed already applied — run
 *   DATABASE_URL=...test pnpm --filter @dentabill/db exec prisma migrate deploy
 * once before the first test run, and again whenever the schema changes.
 */

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Organization", "User", "Claim", "Call", "CallSummary", "CallEvent", "PayerConfig", "AuditLog" RESTART IDENTITY CASCADE',
  );
});
