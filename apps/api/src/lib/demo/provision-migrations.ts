/* eslint-disable security/detect-non-literal-fs-filename -- The source is the tracked migrations directory; destinations belong to the caller's new private runtime. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join } from 'node:path';
import { promisify } from 'node:util';

import { readDemoMigrations } from './preflight-database.js';
import { DemoPreflightError, type ExpectedDemoMigration } from './preflight-policy.js';
import { demoMigrationDigest } from './provision-contract.js';

const execute = promisify(execFile);

async function readMigrationBytes(path: string): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    const maximum = 2 * 1024 * 1024;
    if (!stat.isFile() || stat.size === 0 || stat.size > maximum) throw new Error();
    const bytes = Buffer.alloc(maximum + 1);
    let offset = 0;
    while (offset <= maximum) {
      const result = await file.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset === 0 || offset > maximum) throw new Error();
    return bytes.subarray(0, offset);
  } finally {
    await file.close();
  }
}

export async function stageDemoMigrations(
  sourceDirectory: string,
  privateSchemaPath: string,
): Promise<{ migrations: ExpectedDemoMigration[]; migrationDigest: string }> {
  try {
    if (!isAbsolute(privateSchemaPath) || !(await lstat(privateSchemaPath)).isFile()) {
      throw new Error();
    }
    const migrations = await readDemoMigrations(sourceDirectory);
    const migrationDigest = demoMigrationDigest(migrations);
    const destination = join(dirname(privateSchemaPath), 'migrations');
    await mkdir(destination, { mode: 0o700 });
    for (const migration of migrations) {
      const bytes = await readMigrationBytes(
        join(sourceDirectory, migration.name, 'migration.sql'),
      );
      if (createHash('sha256').update(bytes).digest('hex') !== migration.checksum)
        throw new Error();
      const directory = join(destination, migration.name);
      await mkdir(directory, { mode: 0o700 });
      await writeFile(join(directory, 'migration.sql'), bytes, { mode: 0o600, flag: 'wx' });
    }
    await writeFile(join(destination, 'migration_lock.toml'), 'provider = "postgresql"\n', {
      mode: 0o600,
      flag: 'wx',
    });
    return { migrations, migrationDigest };
  } catch {
    throw new DemoPreflightError('DEMO_MIGRATIONS_INVALID');
  }
}

/** Called only after create-only provisioning has acknowledged creation of the admitted target. */
export async function migrateStagedDemoDatabase(input: {
  readonly projectRoot: string;
  readonly schemaPath: string;
  readonly databaseUrl: string;
  readonly path?: string | undefined;
}): Promise<void> {
  try {
    const database = new URL(input.databaseUrl);
    if (
      !isAbsolute(input.projectRoot) ||
      !isAbsolute(input.schemaPath) ||
      !['postgres:', 'postgresql:'].includes(database.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(database.hostname) ||
      !/^\/dentabill_demo_[a-z0-9][a-z0-9_]{0,47}$/.test(database.pathname) ||
      database.hash ||
      [...database.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public') ||
      database.searchParams.getAll('schema').length > 1
    ) {
      throw new Error();
    }
    const prismaCli = createRequire(join(input.projectRoot, 'packages/db/package.json')).resolve(
      'prisma/build/index.js',
    );
    await execute(
      process.execPath,
      [prismaCli, 'migrate', 'deploy', '--schema', input.schemaPath],
      {
        cwd: dirname(input.schemaPath),
        env: {
          ...(input.path ? { PATH: input.path } : {}),
          DATABASE_URL: database.href,
          NODE_ENV: 'development',
          CHECKPOINT_DISABLE: '1',
          PRISMA_HIDE_UPDATE_MESSAGE: '1',
          PRISMA_GENERATE_SKIP_AUTOINSTALL: 'true',
        },
        timeout: 120000,
        maxBuffer: 256 * 1024,
        windowsHide: true,
      },
    );
  } catch {
    throw new Error('DEMO_MIGRATIONS_FAILED');
  }
}
