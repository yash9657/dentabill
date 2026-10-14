/* eslint-disable security/detect-non-literal-fs-filename -- Files are test-owned mkdtemp fixtures or the fixed repository migrations directory. */
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PrismaClient } from '@dentabill/db';
import { afterAll, describe, expect, it } from 'vitest';

import { inspectDemoDatabase, readDemoMigrations } from './preflight-database.js';
import type { DemoPreflightConfiguration } from './preflight-policy.js';

const migrationsPath = fileURLToPath(
  new URL('../../../../../packages/db/prisma/migrations/', import.meta.url),
);
const temporaryDirectories: string[] = [];

async function temporaryMigration(): Promise<{ directory: string; sql: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'dentabill-demo-migrations-'));
  temporaryDirectories.push(directory);
  const migration = join(directory, '20261014210000_synthetic');
  await mkdir(migration);
  const sql = join(migration, 'migration.sql');
  await writeFile(sql, 'SELECT 1;\n');
  return { directory, sql };
}

afterAll(async () => {
  for (const directory of temporaryDirectories)
    await rm(directory, { recursive: true, force: true });
});

describe('read-only demo database preflight', () => {
  it('reads exact tracked SQL checksums without changing source files', async () => {
    const migrations = await readDemoMigrations(migrationsPath);
    expect(migrations.length).toBeGreaterThanOrEqual(33);
    expect(
      migrations.find((entry) => entry.name === '20261014040000_cash_source_evidence')?.checksum,
    ).toBe('d5165c437ef346adb27551a35b99389c53e1cbe8b725667fe1b65450fde3ec74');
    const fixture = await temporaryMigration();
    const before = await readFile(fixture.sql);
    expect(await readDemoMigrations(fixture.directory)).toHaveLength(1);
    expect(await readFile(fixture.sql)).toEqual(before);
  });

  it('rejects empty or malformed migration layouts with a closed error', async () => {
    const fixture = await temporaryMigration();
    await writeFile(join(fixture.directory, 'unexpected-private-canary.txt'), 'private-canary');
    await expect(readDemoMigrations(fixture.directory)).rejects.toThrow('DEMO_MIGRATIONS_INVALID');
    await expect(
      readDemoMigrations(join(fixture.directory, 'private-canary-missing')),
    ).rejects.toThrow('DEMO_MIGRATIONS_INVALID');
  });

  it('rejects empty, oversized and symbolic SQL files', async () => {
    const fixture = await temporaryMigration();
    await writeFile(fixture.sql, '');
    await expect(readDemoMigrations(fixture.directory)).rejects.toThrow('DEMO_MIGRATIONS_INVALID');
    await writeFile(fixture.sql, Buffer.alloc(2 * 1024 * 1024 + 1));
    await expect(readDemoMigrations(fixture.directory)).rejects.toThrow('DEMO_MIGRATIONS_INVALID');
    await rm(fixture.sql);
    const target = join(fixture.directory, 'migration_lock.toml');
    await writeFile(target, 'SELECT 1;');
    await symlink(target, fixture.sql);
    await expect(readDemoMigrations(fixture.directory)).rejects.toThrow('DEMO_MIGRATIONS_INVALID');
  });

  it('uses an actual read-only transaction, scopes the actor and leaves records unchanged', async () => {
    const databaseUrl = process.env.DATABASE_URL ?? '';
    const url = new URL(databaseUrl);
    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      !['/dentabill_test', '/dentabill_w0_identity'].includes(url.pathname)
    ) {
      throw new Error('DEMO_PREFLIGHT_TEST_REQUIRES_LOCAL_TEST_DATABASE');
    }
    const client = new PrismaClient({ datasourceUrl: databaseUrl, log: [] });
    const id = randomUUID();
    const configuration: DemoPreflightConfiguration = {
      databaseUrl,
      // Test the database reader on the shared test DB; CLI target admission is covered separately.
      databaseName: url.pathname.slice(1),
      appOrigin: 'http://localhost:3000',
      apiOrigin: 'http://localhost:3001',
      actor: {
        organizationId: `preflight-org-${id}`,
        userId: `preflight-user-${id}`,
        clerkOrganizationId: `org_preflight${id.replaceAll('-', '')}`,
        clerkUserId: `user_preflight${id.replaceAll('-', '')}`,
      },
    };
    const organizationId = configuration.actor.organizationId;
    try {
      await client.organization.create({
        data: {
          id: organizationId,
          clerkOrgId: configuration.actor.clerkOrganizationId,
          name: 'Synthetic preflight only',
        },
      });
      await client.user.create({
        data: {
          id: configuration.actor.userId,
          organizationId,
          clerkUserId: configuration.actor.clerkUserId,
          role: 'OWNER',
          email: 'synthetic-preflight@example.invalid',
        },
      });
      const before = await client.organization.findUniqueOrThrow({ where: { id: organizationId } });
      const snapshot = await inspectDemoDatabase(client, configuration);
      expect(snapshot.readOnly).toBe(true);
      expect(snapshot.databaseName).toBe(url.pathname.slice(1));
      expect(snapshot.actor).toEqual({
        clerkUserId: configuration.actor.clerkUserId,
        role: 'OWNER',
      });
      expect(snapshot.organization).toEqual({
        clerkOrgId: configuration.actor.clerkOrganizationId,
      });
      expect(snapshot.migrations.map(({ name, checksum }) => ({ name, checksum }))).toEqual(
        await readDemoMigrations(migrationsPath),
      );
      expect(snapshot.migrations.every((entry) => entry.finished && !entry.rolledBack)).toBe(true);
      expect(snapshot.otherActors).toBe(0);
      expect(
        await client.organization.findUniqueOrThrow({ where: { id: organizationId } }),
      ).toEqual(before);
      expect(await client.auditLog.count({ where: { organizationId } })).toBe(0);
      const wrongActor = await inspectDemoDatabase(client, {
        ...configuration,
        actor: { ...configuration.actor, organizationId: `absent-${id}` },
      });
      expect(wrongActor.actor).toBeNull();
      expect(wrongActor.organization).toBeNull();
      await expect(
        inspectDemoDatabase(client, { ...configuration, databaseName: 'wrong-database' }),
      ).rejects.toThrow('DEMO_DATABASE_NOT_ISOLATED');
    } finally {
      await client.user.deleteMany({ where: { organizationId } });
      await client.organization.deleteMany({ where: { id: organizationId } });
      await client.$disconnect();
    }
  }, 30000);
});
