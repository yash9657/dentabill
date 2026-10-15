/* eslint-disable security/detect-non-literal-fs-filename -- Sources are fixed project paths; writes and cleanup belong to one new private runtime. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';

import { z } from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const manifestEnvelope = z.object({
  schemaVersion: z.literal(1),
  scenarioId: z.literal('financial-review-v1'),
  synthetic: z.literal(true),
  files: z
    .array(
      z.strictObject({
        name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}\.(?:csv|json)$/),
        kind: z.enum([
          'CLAIMS_CSV',
          'CLAIM_REMITTANCE',
          'REMITTANCE_BATCH',
          'CASH_EVIDENCE',
          'POSTING_EVIDENCE',
          'BATCH_CORRECTION',
        ]),
        sha256: digest,
      }),
    )
    .min(6)
    .max(7),
});
const excludedDirectories = new Set([
  'node_modules',
  '.next',
  '.git',
  '.turbo',
  '.cache',
  '.vercel',
  'dist',
  'coverage',
  'test',
  'tests',
  'e2e',
  '__tests__',
  '__fixtures__',
  '__snapshots__',
  'test-results',
  'playwright-report',
]);
const webFiles = [
  'package.json',
  'next.config.ts',
  'postcss.config.mjs',
  'tsconfig.json',
  'next-env.d.ts',
] as const;
const maximumFileBytes = 32 * 1024 * 1024;
const maximumTotalBytes = 256 * 1024 * 1024;
const maximumEntries = 10000;

export class IsolatedWebRuntimeError extends Error {
  public readonly code = 'DEMO_ISOLATED_WEB_FAILED';

  public constructor() {
    super('DEMO_ISOLATED_WEB_FAILED');
    this.name = 'IsolatedWebRuntimeError';
  }
}

export interface IsolatedWebRuntime {
  readonly directory: string;
  readonly appDirectory: string;
  readonly nextModulePath: string;
  readonly distDirectory: string;
  readonly manifestSha256: string;
  /** Call only after the launcher has stopped its owned server processes. */
  dispose(): Promise<void>;
}

export interface PrepareIsolatedWebRuntimeInput {
  readonly projectRoot: string;
  /** The exact manifest hash from the successful preflight in this launch. */
  readonly expectedManifestSha256: string;
}

function excluded(name: string): boolean {
  return (
    name.startsWith('.env') ||
    excludedDirectories.has(name) ||
    /\.(?:test|spec)\./.test(name) ||
    name.endsWith('.tsbuildinfo') ||
    name === '.DS_Store'
  );
}

async function readRegularFile(path: string, maximum: number): Promise<Buffer> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maximum) throw new Error();
    // One extra byte detects a growing source without an unbounded allocation/read.
    const bytes = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const result = await file.read(bytes, offset, bytes.length - offset, offset);
      if (result.bytesRead === 0) break;
      offset += result.bytesRead;
    }
    if (offset !== stat.size) throw new Error();
    return bytes.subarray(0, offset);
  } finally {
    await file.close();
  }
}

async function requirePhysicalDirectory(path: string): Promise<void> {
  if (!(await lstat(path)).isDirectory() || (await realpath(path)) !== path) throw new Error();
}

async function copyTree(
  source: string,
  destination: string,
  budget: { entries: number; bytes: number },
  depth = 0,
): Promise<void> {
  // Check names before stat/open so excluded dotenv symlinks are never followed.
  if (excluded(basename(source))) return;
  budget.entries += 1;
  if (depth > 32 || budget.entries > maximumEntries) throw new Error();
  const stat = await lstat(source);
  if (stat.isSymbolicLink() || (await realpath(source)) !== source) throw new Error();
  if (stat.isDirectory()) {
    await mkdir(destination, { mode: 0o700 });
    for (const name of (await readdir(source)).sort()) {
      await copyTree(join(source, name), join(destination, name), budget, depth + 1);
    }
    return;
  }
  if (!stat.isFile()) throw new Error();
  const bytes = await readRegularFile(source, maximumFileBytes);
  budget.bytes += bytes.length;
  if (budget.bytes > maximumTotalBytes) throw new Error();
  await writeFile(destination, bytes, { mode: 0o600, flag: 'wx' });
}

function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function verifyStagedBundle(directory: string, expected: string): Promise<string> {
  const bytes = await readRegularFile(join(directory, 'manifest.json'), 16 * 1024);
  const actual = hash(bytes);
  if (actual !== expected) throw new Error();
  // Full source semantics were checked by preflight. Recheck the bounded file
  // envelope and every copied byte against that exact preflighted manifest.
  const manifest = manifestEnvelope.parse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown,
  );
  if (
    new Set(manifest.files.map((file) => file.name)).size !== manifest.files.length ||
    manifest.files.some(
      (file) =>
        file.name === 'manifest.json' ||
        !file.name.endsWith(file.kind === 'CLAIMS_CSV' ? '.csv' : '.json'),
    )
  )
    throw new Error();
  for (const kind of [
    'CLAIMS_CSV',
    'CLAIM_REMITTANCE',
    'REMITTANCE_BATCH',
    'CASH_EVIDENCE',
    'POSTING_EVIDENCE',
    'BATCH_CORRECTION',
  ] as const) {
    const count = manifest.files.filter((file) => file.kind === kind).length;
    if (kind === 'BATCH_CORRECTION' ? count > 1 : count !== (kind === 'CLAIM_REMITTANCE' ? 2 : 1))
      throw new Error();
  }
  for (const file of manifest.files) {
    const contents = await readRegularFile(
      join(directory, file.name),
      file.kind === 'CLAIMS_CSV' ? 64 * 1024 : 256 * 1024,
    );
    if (contents.length === 0 || hash(contents) !== file.sha256) throw new Error();
  }
  return actual;
}

/** Stage source/assets only. Does not import Next/app code, read dotenv, or start a process. */
export async function prepareIsolatedWebRuntime(
  input: PrepareIsolatedWebRuntimeInput,
): Promise<IsolatedWebRuntime> {
  let directory: string | undefined;
  try {
    if (!isAbsolute(input.projectRoot) || !digest.safeParse(input.expectedManifestSha256).success)
      throw new Error();
    const projectRoot = await realpath(input.projectRoot);
    const web = join(projectRoot, 'apps/web');
    await requirePhysicalDirectory(web);
    const uiSource = join(projectRoot, 'packages/ui/src');
    await requirePhysicalDirectory(uiSource);
    const modules = await realpath(join(web, 'node_modules'));
    if (!(await lstat(modules)).isDirectory()) throw new Error();
    const rootModules = await realpath(join(projectRoot, 'node_modules'));
    if (!(await lstat(rootModules)).isDirectory()) throw new Error();
    const sourceRequire = createRequire(join(web, 'package.json'));
    const nextModulePath = sourceRequire.resolve('next');
    if (!(await lstat(nextModulePath)).isFile()) throw new Error();

    directory = await mkdtemp(join(tmpdir(), 'dentabill-isolated-web-'));
    await chmod(directory, 0o700);
    // Canonical paths keep Next's project-root and relative CSS source discovery aligned.
    directory = await realpath(directory);
    const appDirectory = join(directory, 'apps/web');
    await mkdir(appDirectory, { recursive: true, mode: 0o700 });
    const budget = { entries: 0, bytes: 0 };
    for (const name of [...webFiles, 'src', 'public']) {
      await copyTree(join(web, name), join(appDirectory, name), budget);
    }
    const sharedUi = join(directory, 'packages/ui');
    await mkdir(sharedUi, { recursive: true, mode: 0o700 });
    await copyTree(uiSource, join(sharedUi, 'src'), budget);
    await symlink(modules, join(appDirectory, 'node_modules'), 'dir');
    // The workspace installs TypeScript at its root. Preserve that ancestor
    // lookup without copying package-manager state or triggering Next installs.
    await symlink(rootModules, join(directory, 'node_modules'), 'dir');
    const stagedRequire = createRequire(join(appDirectory, 'package.json'));
    for (const name of [
      'typescript/lib/typescript.js',
      '@types/react/package.json',
      '@types/node/package.json',
    ]) {
      const resolved = stagedRequire.resolve(name);
      if (resolved !== sourceRequire.resolve(name) || !(await lstat(resolved)).isFile())
        throw new Error();
      if (
        name.startsWith('@types/') &&
        !(await lstat(join(dirname(resolved), 'index.d.ts'))).isFile()
      )
        throw new Error();
    }
    const manifestSha256 = await verifyStagedBundle(
      join(appDirectory, 'public/examples/demo'),
      input.expectedManifestSha256,
    );
    const ownedDirectory = directory;
    return {
      directory: ownedDirectory,
      appDirectory,
      nextModulePath,
      distDirectory: join(appDirectory, '.next'),
      manifestSha256,
      dispose: async (): Promise<void> => {
        await rm(ownedDirectory, { recursive: true, force: true });
      },
    };
  } catch {
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw new IsolatedWebRuntimeError();
  }
}
