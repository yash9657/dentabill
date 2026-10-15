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

describe('claim source identity migration', () => {
  it('applies over duplicate reviewed legacy claims without losing or backfilling data', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dentabill-source-migration-'));
    const schema = `source_proof_${randomUUID().replaceAll('-', '')}`;
    const migrations = resolve(import.meta.dirname, '../../prisma/migrations');
    const migrationName = '20261014010000_claim_source_identity';
    const prior = (await readdir(migrations))
      .filter((name) => name < migrationName && /^\d/.test(name))
      .sort();
    const priorSql = await Promise.all(
      prior.map((name) => readFile(join(migrations, name, 'migration.sql'), 'utf8')),
    );
    const targetSql = await readFile(join(migrations, migrationName, 'migration.sql'), 'utf8');
    const script = `BEGIN;
CREATE SCHEMA "${schema}";
SET LOCAL search_path TO "${schema}";
${priorSql.join('\n')}
INSERT INTO "Organization" (id, "clerkOrgId", name, "updatedAt") VALUES ('org', 'clerk', 'Synthetic', NOW());
INSERT INTO "Claim" (id, "organizationId", "patientDOBHash", "claimNumber", "claimAmount", "payerCode", "serviceDate", status, "updatedAt")
VALUES ('one', 'org', 'fakehash1', 'same-number', 100, 'UNKNOWN', '2026-01-01', 'APPEALING', '2026-01-02'),
       ('two', 'org', 'fakehash2', 'same-number', 200, 'UNKNOWN', '2026-01-01', 'RESOLVED', '2026-01-03');
CREATE TEMP TABLE original_claims AS SELECT to_jsonb(c) AS payload FROM "Claim" c;
${targetSql}
DO $$ BEGIN
  IF (SELECT count(*) FROM "Claim") <> 2 OR EXISTS (
    SELECT 1 FROM "Claim" WHERE "sourceSystem" IS NOT NULL OR "sourceNamespace" IS NOT NULL
      OR "sourceClaimId" IS NOT NULL OR "sourceVersion" IS NOT NULL OR "sourceContentHash" IS NOT NULL
  ) THEN RAISE EXCEPTION 'Legacy identities changed'; END IF;
  IF EXISTS (
    (SELECT payload FROM original_claims EXCEPT
     SELECT to_jsonb(c) - ARRAY['sourceSystem','sourceNamespace','sourceClaimId','sourceVersion','sourceContentHash'] FROM "Claim" c)
    UNION ALL
    (SELECT to_jsonb(c) - ARRAY['sourceSystem','sourceNamespace','sourceClaimId','sourceVersion','sourceContentHash'] FROM "Claim" c
     EXCEPT SELECT payload FROM original_claims)
  ) THEN RAISE EXCEPTION 'Legacy payload changed'; END IF;
END $$;
ROLLBACK;`;
    const path = join(directory, 'proof.sql');
    try {
      await writeFile(path, script);
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
        { env: { ...process.env }, maxBuffer: 1024 * 1024 },
      );
      expect(result.stdout).toContain('Script executed successfully');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30000);
});
