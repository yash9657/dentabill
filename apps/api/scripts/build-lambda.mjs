#!/usr/bin/env node
/**
 * Build the AWS Lambda deployment artifacts (ADR-053, AWS deployment).
 *
 * Two functions, both nodejs22.x / x86_64 (Amazon Linux 2023):
 *
 *   dist-lambda/api/     — src/lambda-server.ts, run under the AWS Lambda Web
 *                          Adapter layer. Handler `run.sh` (`exec node
 *                          index.mjs`); the adapter proxies invocations to the
 *                          Fastify server on $PORT (8080).
 *   dist-lambda/worker/  — src/lambda-worker.ts, a plain SQS-triggered
 *                          handler. Handler `index.handler`.
 *
 * and a zip of each (`api.zip`, `worker.zip`) ready for Terraform /
 * `aws lambda update-function-code`.
 *
 * Like build-vercel.mjs, every workspace package ships raw TypeScript, so
 * esbuild bundles each entry + all workspace TS + npm deps into one ESM
 * file. Only `@prisma/client` stays external: its generated client loads
 * the query engine from disk. It is traced with @vercel/nft (which knows
 * Prisma's engine files) and copied into a flat `node_modules/` next to the
 * bundle, keeping only the `rhel-openssl-3.0.x` engine. Everything is
 * copied dereferenced — Lambda zips cannot contain symlinks.
 *
 * Run: `pnpm --filter @dentabill/api build:lambda`.
 */
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { nodeFileTrace } from '@vercel/nft';
import { build } from 'esbuild';

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(apiDir, '../..');
const outRoot = join(apiDir, 'dist-lambda');

/** Query-engine binaries to ship. Lambda nodejs22.x runs Amazon Linux 2023. */
const ENGINE_KEEP = /rhel-openssl-3\.0\.x/;
const ENGINE_FILE = /(libquery_engine-|query-engine-|schema-engine-)/;
/** Lambda's limit for an unzipped deployment package. */
const MAX_UNZIPPED_BYTES = 250 * 1024 * 1024;

const FUNCTIONS = [
  { name: 'api', entry: 'src/lambda-server.ts' },
  { name: 'worker', entry: 'src/lambda-worker.ts' },
];

// ─── Prisma client trace (shared by both functions) ─────────────────────────
const dbRequire = createRequire(join(repoRoot, 'packages/db/package.json'));
const prismaClientEntry = realpathSync(dbRequire.resolve('@prisma/client'));

const { fileList, warnings } = await nodeFileTrace([prismaClientEntry], { base: repoRoot });
for (const warning of warnings) {
  if (!/Failed to resolve dependency/.test(String(warning?.message ?? warning))) {
    console.warn(`[nft] ${String(warning?.message ?? warning)}`);
  }
}

/**
 * Map a traced repo-relative path to its place in the flat `node_modules`:
 * everything after the last `node_modules/` segment, so pnpm's
 * `node_modules/.pnpm/<pkg>@<v>/node_modules/@prisma/client/x.js` becomes
 * `node_modules/@prisma/client/x.js` (and `.prisma/client` likewise).
 */
function flatModulePath(file) {
  const marker = 'node_modules/';
  const at = file.lastIndexOf(marker);
  return at === -1 ? null : join('node_modules', file.slice(at + marker.length));
}

const prismaFiles = [];
let skippedEngines = 0;
for (const file of fileList) {
  const name = file.split('/').pop() ?? '';
  if (ENGINE_FILE.test(name) && !ENGINE_KEEP.test(name)) {
    skippedEngines += 1;
    continue;
  }
  const dest = flatModulePath(file);
  if (dest === null) continue;
  // nft lists package directories too; only copy files.
  if (statSync(join(repoRoot, file)).isDirectory()) continue;
  prismaFiles.push({ from: join(repoRoot, file), dest });
}
if (!prismaFiles.some((f) => ENGINE_KEEP.test(f.dest) && ENGINE_FILE.test(f.dest))) {
  throw new Error(
    'build-lambda: no rhel-openssl-3.0.x Prisma query engine was traced. ' +
      'Run `pnpm --filter @dentabill/db db:generate` (schema.prisma binaryTargets must include it).',
  );
}

// ─── Bundle + assemble each function ────────────────────────────────────────
rmSync(outRoot, { recursive: true, force: true });

const report = [];
for (const fn of FUNCTIONS) {
  const fnDir = join(outRoot, fn.name);
  mkdirSync(fnDir, { recursive: true });

  await build({
    entryPoints: [join(apiDir, fn.entry)],
    outfile: join(fnDir, 'index.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    sourcemap: 'linked',
    legalComments: 'none',
    logLevel: 'warning',
    // `@prisma/client` resolves from the flat node_modules copied below.
    // `pino-pretty` is a dev-only transport (NODE_ENV=production disables it).
    external: ['@prisma/client', 'pino-pretty'],
    // CommonJS dependencies inside an ESM bundle expect these globals.
    banner: {
      js: [
        "import { createRequire as __dbCreateRequire } from 'node:module';",
        "import { fileURLToPath as __dbFileURLToPath } from 'node:url';",
        "import { dirname as __dbDirname } from 'node:path';",
        'const require = __dbCreateRequire(import.meta.url);',
        'const __filename = __dbFileURLToPath(import.meta.url);',
        'const __dirname = __dbDirname(__filename);',
      ].join('\n'),
    },
  });

  for (const { from, dest } of prismaFiles) {
    const to = join(fnDir, dest);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to, { dereference: true });
  }

  if (fn.name === 'api') {
    // Web Adapter handler: the layer's /opt/bootstrap execs this script and
    // proxies invocations to the server it starts.
    writeFileSync(join(fnDir, 'run.sh'), '#!/bin/sh\nexec node index.mjs\n');
    chmodSync(join(fnDir, 'run.sh'), 0o755);
  }
  assertNoSymlinks(fnDir);
  const unzipped = dirSize(fnDir);
  if (unzipped > MAX_UNZIPPED_BYTES) {
    throw new Error(`build-lambda: ${fn.name} is ${mb(unzipped)} unzipped (limit 250 MB)`);
  }

  const zipPath = join(outRoot, `${fn.name}.zip`);
  // -X: no extra file attributes; -y is deliberately NOT passed (no symlinks).
  execFileSync('zip', ['-qr9X', zipPath, '.'], { cwd: fnDir, stdio: 'inherit' });
  report.push({ fn: fn.name, unzipped, zipped: statSync(zipPath).size });
}

for (const r of report) {
  console.log(
    `build-lambda: ${r.fn.padEnd(6)} ${mb(r.unzipped).padStart(9)} unzipped, ` +
      `${mb(r.zipped).padStart(9)} zip → ${relative(apiDir, join(outRoot, `${r.fn}.zip`))}`,
  );
}
console.log(
  `build-lambda: ${String(prismaFiles.length)} Prisma files per function ` +
    `(${String(skippedEngines)} non-Lambda engines skipped)`,
);

// ─── helpers ────────────────────────────────────────────────────────────────
function assertNoSymlinks(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    const path = join(entry.parentPath, entry.name);
    if (lstatSync(path).isSymbolicLink()) {
      throw new Error(`build-lambda: symlink in artifact (Lambda zips cannot hold them): ${path}`);
    }
  }
}

function dirSize(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += statSync(join(entry.parentPath, entry.name)).size;
  }
  return total;
}

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
