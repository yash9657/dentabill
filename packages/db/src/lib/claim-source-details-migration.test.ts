/* eslint-disable security/detect-non-literal-fs-filename -- Paths are repository migration fixtures and a private generated test directory. */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

describe('claim source details migration', () => {
  it('preserves legacy and imported reviewed claims verbatim without inventing snapshots', async () => {
    const databaseUrl = process.env.DATABASE_URL;
    const url = new URL(databaseUrl ?? '');
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      !url.pathname.startsWith('/dentabill_')
    )
      throw new Error('LOCAL_TEST_DATABASE_REQUIRED');
    const directory = await mkdtemp(join(tmpdir(), 'dentabill-source-details-migration-'));
    const schema = `source_details_proof_${randomUUID().replaceAll('-', '')}`;
    const migrations = resolve(import.meta.dirname, '../../prisma/migrations');
    const target = '20261014020000_claim_source_details';
    const prior = (await readdir(migrations))
      .filter((name) => name < target && /^\d/.test(name))
      .sort();
    const priorSql = await Promise.all(
      prior.map((name) => readFile(join(migrations, name, 'migration.sql'), 'utf8')),
    );
    const targetSql = await readFile(join(migrations, target, 'migration.sql'), 'utf8');
    const script = `BEGIN;
CREATE SCHEMA "${schema}";
SET LOCAL search_path TO "${schema}";
${priorSql.join('\n')}
INSERT INTO "Organization" (id, "clerkOrgId", name, "updatedAt") VALUES ('org', 'clerk', 'Synthetic', NOW());
INSERT INTO "Claim" (id, "organizationId", "patientDOBHash", "claimNumber", "claimAmount", "payerCode", "serviceDate", status, "updatedAt")
VALUES ('legacy', 'org', 'synthetic1', 'same-display', 100, 'UNKNOWN', '2026-01-01', 'APPEALING', '2026-01-02');
INSERT INTO "Claim" (id, "organizationId", "patientDOBHash", "claimNumber", "claimAmount", "payerCode", "serviceDate", status, "updatedAt", "sourceSystem", "sourceNamespace", "sourceClaimId", "sourceContentHash")
VALUES ('imported', 'org', 'synthetic2', 'same-display', 200, 'UNKNOWN', '2026-01-01', 'RESOLVED', '2026-01-03', 'OPEN_DENTAL', 'synthetic', '0001', repeat('a', 64));
CREATE TEMP TABLE original_claims AS SELECT to_jsonb(c) AS payload FROM "Claim" c;
${targetSql}
DO $$ BEGIN
  IF (SELECT count(*) FROM "Claim") <> 2
    OR (SELECT count(*) FROM "ClaimSourceDetails") <> 0
    OR (SELECT count(*) FROM "ClaimSourceLine") <> 0
    OR (SELECT count(*) FROM "ClaimSourceCoverage") <> 0
  THEN RAISE EXCEPTION 'Unexpected source snapshot backfill'; END IF;
  IF EXISTS (
    (SELECT payload FROM original_claims EXCEPT SELECT to_jsonb(c) FROM "Claim" c)
    UNION ALL
    (SELECT to_jsonb(c) FROM "Claim" c EXCEPT SELECT payload FROM original_claims)
  ) THEN RAISE EXCEPTION 'Existing claim payload changed'; END IF;
END $$;
ROLLBACK;`;
    const path = join(directory, 'proof.sql');
    try {
      await writeFile(path, script, { mode: 0o600 });
      const result = await execFileAsync(
        process.execPath,
        [
          require.resolve('prisma/build/index.js'),
          'db',
          'execute',
          '--schema',
          resolve(import.meta.dirname, '../../prisma/schema.prisma'),
          '--file',
          path,
        ],
        {
          env: { PATH: process.env.PATH, DATABASE_URL: databaseUrl, NODE_ENV: 'test' },
          maxBuffer: 1024 * 1024,
        },
      );
      expect(result.stdout).toContain('Script executed successfully');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
