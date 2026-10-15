/* eslint-disable security/detect-non-literal-fs-filename -- All writable paths belong to test-created temporary directories. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assertIsolatedPrismaMetadata,
  IsolatedDemoRuntimeError,
  prepareIsolatedDemoRuntime,
  type IsolatedDemoRuntime,
} from './isolated-runtime.js';

const execute = promisify(execFile);
const projectRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const temporary: string[] = [];
const runtimes: IsolatedDemoRuntime[] = [];
const environment = {
  PATH: process.env.PATH,
  DATABASE_URL:
    'postgresql://synthetic:synthetic@127.0.0.1:1/dentabill_demo_runtime?connect_timeout=1',
};
const canary = 'SYNTHETIC_PRIVATE_DOTENV_CANARY';

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const runtime of runtimes.splice(0)) await runtime.dispose();
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fakeProject(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dentabill-runtime-test-'));
  temporary.push(directory);
  const db = join(directory, 'packages/db');
  await mkdir(join(db, 'prisma'), { recursive: true });
  await copyFile(
    join(projectRoot, 'packages/db/prisma/schema.prisma'),
    join(db, 'prisma/schema.prisma'),
  );
  await writeFile(join(directory, 'package.json'), '{"private":true}\n');
  await writeFile(join(db, 'package.json'), '{"private":true}\n');
  await symlink(join(projectRoot, 'packages/db/node_modules'), join(db, 'node_modules'), 'dir');
  await symlink(join(projectRoot, 'packages/logger'), join(directory, 'packages/logger'), 'dir');
  await mkdir(join(directory, 'apps'), { recursive: true });
  await symlink(join(projectRoot, 'apps/api'), join(directory, 'apps/api'), 'dir');
  // Synthetic fixtures only. No repository dotenv content is read, copied or modified.
  for (const path of [join(directory, '.env'), join(db, '.env'), join(db, 'prisma/.env')]) {
    await writeFile(path, `${canary}=must-not-load\nRETELL_API_KEY=synthetic-forbidden-value\n`);
  }
  return directory;
}

describe('isolated demo runtime', () => {
  it.each([{}, { rootEnvPath: null }, { rootEnvPath: null, schemaEnvPath: null }])(
    'accepts only recognized absent/null dotenv paths %#',
    (paths) => {
      expect(() => {
        assertIsolatedPrismaMetadata(`{"relativeEnvPaths":${JSON.stringify(paths)}}`);
      }).not.toThrow();
    },
  );

  it.each([
    '{"relativeEnvPaths":{"rootEnvPath":"/synthetic-private/.env"}}',
    '{"relativeEnvPaths":{"schemaEnvPath":"../../.env"}}',
    '{"relativeEnvPaths":{"schemaEnvPath":false}}',
    '{"relativeEnvPaths":{"unknown":null}}',
    '{"relativeEnvPaths":null}',
    '{"relativeEnvPaths":[]}',
    '{"relativeEnvPaths":{broken}}',
    '{"relativeEnvPaths":{}} {"relativeEnvPaths":{}}',
    'unknown generated client layout',
  ])('rejects configured paths and unknown generated metadata %#', (generated) => {
    expect(() => {
      assertIsolatedPrismaMetadata(generated);
    }).toThrow(IsolatedDemoRuntimeError);
  });

  it('generates private Prisma without original dotenv paths, bundles real workspace code and initializes under a dotenv read guard', async () => {
    const sourceProject = await fakeProject();
    const esbuildCanary = join(sourceProject, 'forbidden-esbuild');
    const executedCanary = join(sourceProject, 'forbidden-esbuild-executed');
    await writeFile(
      esbuildCanary,
      `#!/usr/bin/env node\nrequire('node:fs').writeFileSync(${JSON.stringify(executedCanary)}, 'executed');\n`,
      { mode: 0o700 },
    );
    vi.stubEnv('ESBUILD_BINARY_PATH', esbuildCanary);
    const originalSchema = await readFile(join(sourceProject, 'packages/db/prisma/schema.prisma'));
    const runtime = await prepareIsolatedDemoRuntime({
      projectRoot: sourceProject,
      environment: {
        ...environment,
        RETELL_API_KEY: 'must-not-pass-to-generator',
        NODE_OPTIONS: '--invalid-canary-option',
      },
      entrySource: `
        import { PrismaClient } from '@prisma/client';
        import { verifyDemoBundle } from ${JSON.stringify(join(projectRoot, 'apps/api/src/lib/demo/bundle.ts'))};
        const bundle = await verifyDemoBundle(${JSON.stringify(join(projectRoot, 'apps/web/public/examples/demo'))});
        const client = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL, log: [] });
        let connectionRefused = false;
        try { await client.$connect(); }
        catch (error) { connectionRefused = error.errorCode === 'P1001'; }
        finally { await client.$disconnect(); }
        process.stdout.write(JSON.stringify({
          scenarioId: bundle.manifest.scenarioId,
          connectionRefused,
          canaryAbsent: process.env.${canary} === undefined,
          liveKeyAbsent: process.env.RETELL_API_KEY === undefined,
          dotenvReads: globalThis.__demoDotenvReads,
        }) + '\\n');
      `,
    }).catch((error: unknown) => {
      if (error instanceof IsolatedDemoRuntimeError)
        throw new Error(`${error.code}:${error.stage}`);
      throw new Error('UNKNOWN_ISOLATION_FAILURE');
    });
    runtimes.push(runtime);
    expect((await lstat(runtime.directory)).mode & 0o777).toBe(0o700);
    const generated = await readFile(
      join(runtime.directory, 'node_modules/@prisma/client/index.js'),
      'utf8',
    );
    const metadata = /"relativeEnvPaths"\s*:\s*(\{[^{}]*\})/.exec(generated)?.[1];
    expect(metadata).toBeDefined();
    expect(
      Object.entries(JSON.parse(metadata ?? 'null') as Record<string, unknown>).every(
        ([key, value]) => ['rootEnvPath', 'schemaEnvPath'].includes(key) && value === null,
      ),
    ).toBe(true);
    expect(generated).not.toContain(sourceProject);
    expect(await readFile(join(sourceProject, 'packages/db/prisma/schema.prisma'))).toEqual(
      originalSchema,
    );
    await expect(access(join(runtime.directory, 'generator/node_modules'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    const entry = await readFile(runtime.entryPath, 'utf8');
    expect(entry).not.toMatch(/from ["']@dentabill\//);
    expect(entry).not.toContain('must-not-pass-to-generator');
    await expect(access(executedCanary)).rejects.toMatchObject({ code: 'ENOENT' });

    const guard = join(runtime.directory, 'guard.mjs');
    await writeFile(
      guard,
      `
      import fs from 'node:fs';
      import promises from 'node:fs/promises';
      import { basename } from 'node:path';
      import { syncBuiltinESMExports } from 'node:module';
      globalThis.__demoDotenvReads = 0;
      function check(path) {
        const name = basename(String(path));
        if (name === '.env' || name.startsWith('.env.')) {
          globalThis.__demoDotenvReads += 1;
          throw new Error('FORBIDDEN_DOTENV_READ');
        }
      }
      const sync = fs.readFileSync;
      fs.readFileSync = function(path, ...args) { check(path); return sync.call(this, path, ...args); };
      const callback = fs.readFile;
      fs.readFile = function(path, ...args) { check(path); return callback.call(this, path, ...args); };
      const asyncRead = promises.readFile;
      promises.readFile = function(path, ...args) { check(path); return asyncRead.call(this, path, ...args); };
      syncBuiltinESMExports();
    `,
    );
    const result = await execute(process.execPath, ['--import', guard, runtime.entryPath], {
      cwd: runtime.directory,
      env: { ...environment, NODE_ENV: 'development' },
      timeout: 15000,
      maxBuffer: 32 * 1024,
    });
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      scenarioId: 'financial-review-v1',
      connectionRefused: true,
      canaryAbsent: true,
      liveKeyAbsent: true,
      dotenvReads: 0,
    });
    const directory = runtime.directory;
    await runtime.dispose();
    await runtime.dispose();
    await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(
      createHash('sha256')
        .update(await readFile(join(sourceProject, 'packages/db/prisma/schema.prisma')))
        .digest('hex'),
    ).toBe(createHash('sha256').update(originalSchema).digest('hex'));
  }, 90000);

  it('returns a fixed closed diagnostic for invalid inputs without exposing paths or environment', async () => {
    const error: unknown = await prepareIsolatedDemoRuntime({
      projectRoot: 'relative-synthetic-private-path',
      environment: { DATABASE_URL: 'private-secret-url' },
      entrySource: '',
    }).catch((failure: unknown) => failure);
    expect(error).toBeInstanceOf(IsolatedDemoRuntimeError);
    expect(error).toMatchObject({
      code: 'DEMO_ISOLATED_RUNTIME_FAILED',
      message: 'DEMO_ISOLATED_RUNTIME_FAILED',
    });
    expect(JSON.stringify(error)).not.toContain('private-secret');
    expect(JSON.stringify(error)).not.toContain('relative-synthetic');
  });

  it('rejects additional generators before any generator can execute', async () => {
    const sourceProject = await fakeProject();
    const schema = join(sourceProject, 'packages/db/prisma/schema.prisma');
    await writeFile(
      schema,
      `${await readFile(schema, 'utf8')}\ngenerator untrusted {\n provider = "synthetic-private-command"\n}\n`,
    );
    await expect(
      prepareIsolatedDemoRuntime({
        projectRoot: sourceProject,
        environment,
        entrySource: 'throw new Error("never");',
      }),
    ).rejects.toMatchObject({ code: 'DEMO_ISOLATED_RUNTIME_FAILED' });
    expect(await readFile(join(dirname(schema), 'schema.prisma'), 'utf8')).toContain(
      'synthetic-private-command',
    );
  });
});
