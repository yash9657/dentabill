/* eslint-disable security/detect-non-literal-fs-filename -- The CLI pins this directory; discovered migration names and SQL files are bounded and validated below. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import type { PrismaClient } from '@dentabill/db';

import {
  DemoPreflightError,
  type DemoDatabaseSnapshot,
  type DemoPreflightConfiguration,
  type ExpectedDemoMigration,
} from './preflight-policy.js';

export async function readDemoMigrations(directory: string): Promise<ExpectedDemoMigration[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.name !== 'migration_lock.toml');
    if (
      directories.length === 0 ||
      directories.length > 1000 ||
      directories.some((entry) => !entry.isDirectory() || !/^\d{14}_[a-z0-9_]+$/.test(entry.name))
    ) {
      throw new DemoPreflightError('DEMO_MIGRATIONS_INVALID');
    }
    const migrations: ExpectedDemoMigration[] = [];
    for (const entry of directories.sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name, 'migration.sql');
      const maximum = 2 * 1024 * 1024;
      const file = await open(
        path,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size === 0 || stat.size > maximum) {
          throw new DemoPreflightError('DEMO_MIGRATIONS_INVALID');
        }
        const content = Buffer.alloc(maximum + 1);
        let offset = 0;
        while (offset <= maximum) {
          const read = await file.read(content, offset, maximum + 1 - offset, offset);
          if (!read.bytesRead) break;
          offset += read.bytesRead;
        }
        if (offset === 0 || offset > maximum) {
          throw new DemoPreflightError('DEMO_MIGRATIONS_INVALID');
        }
        migrations.push({
          name: entry.name,
          checksum: createHash('sha256').update(content.subarray(0, offset)).digest('hex'),
        });
      } finally {
        await file.close();
      }
    }
    return migrations;
  } catch {
    throw new DemoPreflightError('DEMO_MIGRATIONS_INVALID');
  }
}

export async function inspectDemoDatabase(
  client: PrismaClient,
  configuration: DemoPreflightConfiguration,
): Promise<DemoDatabaseSnapshot> {
  try {
    return await client.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SET TRANSACTION READ ONLY`;
        const [database] = await transaction.$queryRaw<
          { databaseName: string; readOnly: string }[]
        >`SELECT current_database() AS "databaseName", current_setting('transaction_read_only') AS "readOnly"`;
        if (database?.readOnly !== 'on') {
          throw new DemoPreflightError('DEMO_READ_ONLY_REQUIRED');
        }
        if (database.databaseName !== configuration.databaseName) {
          throw new DemoPreflightError('DEMO_DATABASE_NOT_ISOLATED');
        }
        const migrations = await transaction.$queryRaw<DemoDatabaseSnapshot['migrations']>`
          SELECT migration_name AS "name", checksum,
            finished_at IS NOT NULL AS "finished", rolled_back_at IS NOT NULL AS "rolledBack"
          FROM "_prisma_migrations" ORDER BY migration_name
        `;
        const organization = await transaction.organization.findUnique({
          where: { id: configuration.actor.organizationId },
          select: { clerkOrgId: true },
        });
        const actor = await transaction.user.findFirst({
          where: {
            id: configuration.actor.userId,
            organizationId: configuration.actor.organizationId,
          },
          select: { clerkUserId: true, role: true },
        });
        // These counts establish database isolation, without reading any other tenant's facts.
        const otherOrganizations = await transaction.organization.count({
          where: { id: { not: configuration.actor.organizationId } },
        });
        const otherActors = await transaction.user.count({
          where: {
            organizationId: configuration.actor.organizationId,
            id: { not: configuration.actor.userId },
          },
        });
        return {
          databaseName: database.databaseName,
          readOnly: true,
          migrations,
          organization,
          actor,
          otherOrganizations,
          otherActors,
        };
      },
      { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 10000 },
    );
  } catch (error) {
    if (error instanceof DemoPreflightError) throw error;
    throw new DemoPreflightError('DEMO_DATABASE_UNAVAILABLE');
  }
}
