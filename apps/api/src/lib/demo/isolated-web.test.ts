/* eslint-disable security/detect-non-literal-fs-filename -- Writes are restricted to test-owned temporary directories. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  access,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { afterEach, describe, expect, it } from 'vitest';

import {
  IsolatedWebRuntimeError,
  prepareIsolatedWebRuntime,
  type IsolatedWebRuntime,
} from './isolated-web.js';

const execute = promisify(execFile);
const projectRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const demoDirectory = join(projectRoot, 'apps/web/public/examples/demo');
const temporary: string[] = [];
const runtimes: IsolatedWebRuntime[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.dispose();
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fixture(): Promise<{ root: string; web: string; bundle: string; digest: string }> {
  const root = await mkdtemp(join(tmpdir(), 'dentabill-web-staging-test-'));
  temporary.push(root);
  const web = join(root, 'apps/web');
  const bundle = join(web, 'public/examples/demo');
  await mkdir(bundle, { recursive: true });
  await mkdir(join(web, 'src/app'), { recursive: true });
  await mkdir(join(root, 'packages/ui/src'), { recursive: true });
  for (const name of [
    'package.json',
    'next.config.ts',
    'postcss.config.mjs',
    'tsconfig.json',
    'next-env.d.ts',
  ]) {
    await copyFile(join(projectRoot, 'apps/web', name), join(web, name));
  }
  await copyFile(
    join(projectRoot, 'apps/web/src/app/globals.css'),
    join(web, 'src/app/globals.css'),
  );
  await writeFile(
    join(web, 'src/app/page.tsx'),
    'export default function Page() { return null; }\n',
  );
  await writeFile(
    join(root, 'packages/ui/src/button.tsx'),
    'export const className = "bg-brand";\n',
  );
  for (const name of await readdir(demoDirectory))
    await copyFile(join(demoDirectory, name), join(bundle, name));
  await symlink(join(projectRoot, 'apps/web/node_modules'), join(web, 'node_modules'), 'dir');
  await symlink(join(projectRoot, 'node_modules'), join(root, 'node_modules'), 'dir');
  return { root, web, bundle, digest: hash(await readFile(join(bundle, 'manifest.json'))) };
}

async function stage(root: string, expectedManifestSha256: string): Promise<IsolatedWebRuntime> {
  const runtime = await prepareIsolatedWebRuntime({ projectRoot: root, expectedManifestSha256 });
  runtimes.push(runtime);
  return runtime;
}

async function linksUnder(directory: string): Promise<string[]> {
  const links: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) links.push(path);
    else if (entry.isDirectory()) links.push(...(await linksUnder(path)));
  }
  return links;
}

describe('private Next staging', () => {
  it('stages the actual app/config/assets with only known dependency links and private build output', async () => {
    const manifest = await readFile(join(demoDirectory, 'manifest.json'));
    const runtime = await stage(projectRoot, hash(manifest));
    expect((await lstat(runtime.directory)).mode & 0o777).toBe(0o700);
    expect(runtime.appDirectory).toBe(join(runtime.directory, 'apps/web'));
    expect(runtime.distDirectory).toBe(join(runtime.appDirectory, '.next'));
    expect(runtime.manifestSha256).toBe(hash(manifest));
    expect(runtime.nextModulePath).toBe(
      createRequire(join(projectRoot, 'apps/web/package.json')).resolve('next'),
    );
    for (const name of ['next.config.ts', 'postcss.config.mjs', 'tsconfig.json', 'next-env.d.ts']) {
      expect(await readFile(join(runtime.appDirectory, name))).toEqual(
        await readFile(join(projectRoot, 'apps/web', name)),
      );
    }
    expect(await readFile(join(runtime.appDirectory, 'src/middleware.ts'))).toEqual(
      await readFile(join(projectRoot, 'apps/web/src/middleware.ts')),
    );
    expect(await readFile(join(runtime.appDirectory, 'src/components/providers.tsx'))).toEqual(
      await readFile(join(projectRoot, 'apps/web/src/components/providers.tsx')),
    );
    expect(await readFile(join(runtime.directory, 'packages/ui/src/theme.css'))).toEqual(
      await readFile(join(projectRoot, 'packages/ui/src/theme.css')),
    );
    expect(await linksUnder(runtime.directory)).toEqual([
      join(runtime.appDirectory, 'node_modules'),
      join(runtime.directory, 'node_modules'),
    ]);
    const requireFromCopy = createRequire(join(runtime.appDirectory, 'package.json'));
    expect(requireFromCopy.resolve('@dentabill/ui')).toBe(
      createRequire(join(projectRoot, 'apps/web/package.json')).resolve('@dentabill/ui'),
    );
    for (const name of ['typescript', '@types/node/package.json', '@types/react/package.json']) {
      expect(requireFromCopy.resolve(name)).toBe(
        createRequire(join(projectRoot, 'apps/web/package.json')).resolve(name),
      );
    }
    await expect(access(runtime.distDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    const sentinel = join(runtime.appDirectory, 'src/cleanup-sentinel.txt');
    await writeFile(sentinel, 'private runtime only');
    await runtime.dispose();
    await runtime.dispose();
    await expect(access(runtime.directory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(demoDirectory, 'manifest.json'))).toEqual(manifest);
    expect((await lstat(join(projectRoot, 'apps/web/src/middleware.ts'))).isFile()).toBe(true);
  });

  it('skips dotenv and excluded cache/test symlinks before traversal, including nested names', async () => {
    const source = await fixture();
    for (const name of ['.env', '.env.local', '.env.development', '.env.development.local'])
      await symlink('/missing-synthetic-private-dotenv', join(source.web, name));
    for (const name of [
      '.env.secret',
      '__tests__',
      '.next',
      'screen.test.tsx',
      'tsconfig.tsbuildinfo',
    ])
      await symlink('/missing-synthetic-private-artifact', join(source.web, 'src', name));
    await mkdir(join(source.web, '.next'));
    await writeFile(join(source.web, '.next/stale-cache'), 'never reuse a build');
    const runtime = await stage(source.root, source.digest);
    expect(await readdir(join(runtime.appDirectory, 'src'))).toEqual(['app']);
    expect((await readdir(runtime.appDirectory)).some((name) => name.startsWith('.env'))).toBe(
      false,
    );
    await expect(access(runtime.distDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await lstat(join(source.web, '.env.local'))).isSymbolicLink()).toBe(true);
  });

  it('installed Next env loading and forced reload see no original dotenv or inherited canaries', async () => {
    const source = await fixture();
    for (const name of ['.env', '.env.local', '.env.development', '.env.development.local']) {
      await writeFile(join(source.web, name), 'SYNTHETIC_WEB_DOTENV_CANARY=must-not-load\n');
    }
    const runtime = await stage(source.root, source.digest);
    const script = `
      const { createRequire } = require('node:module');
      const fs = require('node:fs');
      const path = require('node:path');
      const req = createRequire(${JSON.stringify(runtime.nextModulePath)});
      const { loadEnvConfig } = req('@next/env');
      let reads = 0;
      const read = fs.readFileSync;
      fs.readFileSync = function(file, ...args) {
        if (path.basename(String(file)).startsWith('.env')) {
          reads += 1;
          throw new Error('UNEXPECTED_DOTENV_READ');
        }
        return read.call(this, file, ...args);
      };
      const initial = loadEnvConfig(${JSON.stringify(runtime.appDirectory)}, true);
      const reload = loadEnvConfig(${JSON.stringify(runtime.appDirectory)}, true, console, true);
      process.stdout.write(JSON.stringify({
        initial: initial.loadedEnvFiles.length,
        reload: reload.loadedEnvFiles.length,
        reads,
        canaryAbsent: process.env.SYNTHETIC_WEB_DOTENV_CANARY === undefined,
        approved: process.env.NEXT_PUBLIC_APP_URL
      }));
    `;
    const result = await execute(process.execPath, ['-e', script], {
      cwd: runtime.appDirectory,
      env: { NODE_ENV: 'development', NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:4300' },
      timeout: 10000,
      maxBuffer: 16 * 1024,
    });
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({
      initial: 0,
      reload: 0,
      reads: 0,
      canaryAbsent: true,
      approved: 'http://127.0.0.1:4300',
    });
  });

  it.each(['next.config.ts', 'src/app/page.tsx', 'public/examples/demo/cash.json'])(
    'rejects non-excluded symlink input %s',
    async (relative) => {
      const source = await fixture();
      const path = join(source.web, relative);
      await rm(path);
      await symlink(join(source.bundle, 'manifest.json'), path);
      await expect(stage(source.root, source.digest)).rejects.toBeInstanceOf(
        IsolatedWebRuntimeError,
      );
    },
  );

  it('rejects source directories reached through symlinks', async () => {
    const source = await fixture();
    await rm(join(source.web, 'src/app'), { recursive: true });
    await symlink(join(source.root, 'packages/ui/src'), join(source.web, 'src/app'), 'dir');
    await expect(stage(source.root, source.digest)).rejects.toThrow('DEMO_ISOLATED_WEB_FAILED');
  });

  it('fails closed before Next can install absent workspace TypeScript', async () => {
    const source = await fixture();
    await rm(join(source.root, 'node_modules'));
    await mkdir(join(source.root, 'node_modules'));
    await expect(stage(source.root, source.digest)).rejects.toThrow('DEMO_ISOLATED_WEB_FAILED');
  });

  it.each(['manifest', 'file', 'missing', 'oversized'])(
    'rejects staged bundle drift: %s',
    async (variant) => {
      const source = await fixture();
      if (variant === 'manifest') await writeFile(join(source.bundle, 'manifest.json'), '{}');
      if (variant === 'file')
        await writeFile(join(source.bundle, 'cash.json'), '{"tampered":true}');
      if (variant === 'missing') await rm(join(source.bundle, 'cash.json'));
      if (variant === 'oversized')
        await writeFile(join(source.bundle, 'cash.json'), Buffer.alloc(256 * 1024 + 1));
      await expect(stage(source.root, source.digest)).rejects.toThrow('DEMO_ISOLATED_WEB_FAILED');
    },
  );

  it.each(['../escape.json', 'manifest.json', 'cash.json'])(
    'rejects unsafe or repeated manifest entries even with a matching outer digest: %s',
    async (name) => {
      const source = await fixture();
      const manifestPath = join(source.bundle, 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        files: { name: string }[];
      };
      manifest.files[0]!.name = name;
      const bytes = Buffer.from(JSON.stringify(manifest));
      await writeFile(manifestPath, bytes);
      await expect(stage(source.root, hash(bytes))).rejects.toThrow('DEMO_ISOLATED_WEB_FAILED');
    },
  );

  it('returns closed errors for invalid admission without revealing caller paths or values', async () => {
    const result: unknown = await prepareIsolatedWebRuntime({
      projectRoot: 'private-canary-relative-path',
      expectedManifestSha256: 'private-canary-digest',
    }).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(IsolatedWebRuntimeError);
    expect(JSON.stringify(result)).not.toContain('private-canary');
  });

  it('keeps copied source and CSS scan paths physical', async () => {
    const source = await fixture();
    const runtime = await stage(source.root, source.digest);
    const css = join(runtime.appDirectory, 'src/app/globals.css');
    const ui = join(dirname(css), '../../../../packages/ui/src');
    expect(await realpath(ui)).toBe(join(runtime.directory, 'packages/ui/src'));
    expect((await lstat(join(ui, 'button.tsx'))).isFile()).toBe(true);
    expect(await readFile(css)).toEqual(await readFile(join(source.web, 'src/app/globals.css')));
  });
});
