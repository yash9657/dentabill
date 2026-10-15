/* eslint-disable security/detect-non-literal-fs-filename -- All writes use test-created temporary directories. */
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { readDemoMigrations } from './preflight-database.js';
import { demoMigrationDigest } from './provision-contract.js';
import { migrateStagedDemoDatabase, stageDemoMigrations } from './provision-migrations.js';

const temporary: string[] = [];
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture(): Promise<{ source: string; schema: string; sql: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'dentabill-provision-migrations-'));
  temporary.push(directory);
  const source = join(directory, 'source');
  const privateDirectory = join(directory, 'private');
  const migration = join(source, '20261014200000_synthetic');
  await mkdir(migration, { recursive: true });
  await mkdir(privateDirectory);
  const sql = join(migration, 'migration.sql');
  await writeFile(sql, 'SELECT 1;\n');
  await writeFile(join(source, 'migration_lock.toml'), 'private-canary');
  const schema = join(privateDirectory, 'schema.prisma');
  await writeFile(schema, '// synthetic schema for staging only\n');
  return { source, schema, sql };
}

describe('private demo migration staging', () => {
  it('copies exact SQL bytes and creates only the known PostgreSQL lock file', async () => {
    const { source, schema, sql } = await fixture();
    const before = await readFile(sql);
    const staged = await stageDemoMigrations(source, schema);
    const destination = join(schema, '..', 'migrations');
    expect(await readDemoMigrations(destination)).toEqual(staged.migrations);
    expect(staged.migrationDigest).toBe(demoMigrationDigest(staged.migrations));
    expect(await readFile(join(destination, 'migration_lock.toml'), 'utf8')).toBe(
      'provider = "postgresql"\n',
    );
    expect(await readFile(sql)).toEqual(before);
    await expect(stageDemoMigrations(source, schema)).rejects.toThrow('DEMO_MIGRATIONS_INVALID');
    expect(await readDemoMigrations(destination)).toEqual(staged.migrations);
  });

  it('rejects symlink SQL and leaves source data untouched', async () => {
    const { source, schema, sql } = await fixture();
    await rm(sql);
    await symlink(schema, sql);
    await expect(stageDemoMigrations(source, schema)).rejects.toThrow('DEMO_MIGRATIONS_INVALID');
    expect(await readFile(schema, 'utf8')).toBe('// synthetic schema for staging only\n');
  });

  it.each([
    'postgresql://private-canary@remote.invalid/dentabill_demo_target',
    'postgresql://private-canary@localhost/dentabill_test',
    'postgresql://private-canary@localhost/dentabill_demo_target?host=remote.invalid',
  ])(
    'refuses inadmissible migration targets before invoking the engine %#',
    async (databaseUrl) => {
      await expect(
        migrateStagedDemoDatabase({
          projectRoot: '/private-canary-missing',
          schemaPath: '/private-canary-missing/schema.prisma',
          databaseUrl,
        }),
      ).rejects.toThrow('DEMO_MIGRATIONS_FAILED');
    },
  );
});
