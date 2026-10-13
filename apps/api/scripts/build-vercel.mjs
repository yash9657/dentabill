#!/usr/bin/env node
/**
 * Build the API as a Vercel Build Output API v3 bundle (ADR-053).
 *
 * Why not Vercel's zero-config Node builder: every workspace package ships
 * raw TypeScript (`"main": "./src/index.ts"`, NodeNext `.js` specifiers that
 * point at `.ts` files). Rather than depend on how the platform builder
 * treats those, we produce the exact artifact ourselves:
 *
 *   1. esbuild bundles src/vercel.ts + all workspace TS + npm deps into one
 *      ESM file. `@prisma/client` stays external — its generated client
 *      locates the query engine on disk at runtime and cannot be inlined.
 *      It is rewritten to a relative path into the pnpm store so it resolves
 *      without apps/api declaring it.
 *   2. @vercel/nft traces the bundle (it knows Prisma's engine files) and the
 *      traced files are copied into the function directory, preserving their
 *      repo-relative layout.
 *   3. config.json routes every path to the single function; .vc-config.json
 *      sets Node 22, response streaming (SSE) and maxDuration 800 (Pro max).
 *
 * Output: apps/api/.vercel/output — Vercel deploys it as-is when the build
 * command leaves it behind. Run locally with `pnpm --filter @dentabill/api
 * build:vercel` to verify.
 */
import { cpSync, existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { nodeFileTrace } from '@vercel/nft';
import { build } from 'esbuild';

const apiDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(apiDir, '../..');
const outputDir = join(apiDir, '.vercel/output');
const funcDir = join(outputDir, 'functions/index.func');
const bundleFile = join(apiDir, 'dist-vercel/index.mjs');

/** Query-engine binaries to ship. Vercel functions run on Amazon Linux 2023. */
const ENGINE_KEEP = /rhel-openssl-3\.0\.x/;
const ENGINE_FILE = /(libquery_engine-|query-engine-|schema-engine-)/;

// ─── 1. Bundle ──────────────────────────────────────────────────────────────
const dbRequire = createRequire(join(repoRoot, 'packages/db/package.json'));
const prismaClientEntry = realpathSync(dbRequire.resolve('@prisma/client'));

/** @type {import('esbuild').Plugin} */
const prismaExternal = {
  name: 'prisma-external',
  setup(b) {
    b.onResolve({ filter: /^@prisma\/client$/ }, () => {
      let rel = relative(dirname(bundleFile), prismaClientEntry).split(sep).join('/');
      if (!rel.startsWith('.')) rel = `./${rel}`;
      return { path: rel, external: true };
    });
  },
};

rmSync(join(apiDir, 'dist-vercel'), { recursive: true, force: true });
await build({
  entryPoints: [join(apiDir, 'src/vercel.ts')],
  outfile: bundleFile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'linked',
  legalComments: 'none',
  logLevel: 'warning',
  // Optional / dev-only modules that are never loaded in production.
  external: ['pino-pretty'],
  plugins: [prismaExternal],
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

// ─── 2. Trace + copy ────────────────────────────────────────────────────────
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(funcDir, { recursive: true });

const { fileList, warnings } = await nodeFileTrace([bundleFile], {
  base: repoRoot,
  processCwd: apiDir,
});
for (const warning of warnings) {
  // Unresolvable optional requires inside dependencies are expected noise;
  // anything else is surfaced but not fatal (the smoke import below is).
  if (!/Failed to resolve dependency/.test(String(warning?.message ?? warning))) {
    console.warn(`[nft] ${String(warning?.message ?? warning)}`);
  }
}

let copied = 0;
let skippedEngines = 0;
for (const file of fileList) {
  const name = file.split('/').pop() ?? '';
  if (ENGINE_FILE.test(name) && !ENGINE_KEEP.test(name)) {
    skippedEngines += 1;
    continue;
  }
  const from = join(repoRoot, file);
  const to = join(funcDir, file);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to, { dereference: true, recursive: true });
  copied += 1;
}
cpSync(`${bundleFile}.map`, join(funcDir, relative(repoRoot, `${bundleFile}.map`)));

const shippedEngine = [...fileList].some((f) => ENGINE_KEEP.test(f) && ENGINE_FILE.test(f));
if (!shippedEngine) {
  throw new Error(
    'build-vercel: no rhel-openssl-3.0.x Prisma query engine was traced. ' +
      'Run `pnpm --filter @dentabill/db db:generate` (schema.prisma binaryTargets must include it).',
  );
}

// ─── 3. Build Output API config ─────────────────────────────────────────────
writeFileSync(
  join(funcDir, '.vc-config.json'),
  `${JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: relative(repoRoot, bundleFile).split(sep).join('/'),
      launcherType: 'Nodejs',
      shouldAddHelpers: false,
      supportsResponseStreaming: true,
      maxDuration: 800,
    },
    null,
    2,
  )}\n`,
);
writeFileSync(
  join(outputDir, 'config.json'),
  `${JSON.stringify({ version: 3, routes: [{ src: '/(.*)', dest: '/index' }] }, null, 2)}\n`,
);

if (!existsSync(join(funcDir, relative(repoRoot, bundleFile)))) {
  throw new Error('build-vercel: bundle missing from function directory');
}
console.log(
  `build-vercel: ${String(copied)} files → ${relative(apiDir, funcDir)} ` +
    `(${String(skippedEngines)} non-Vercel Prisma engines skipped)`,
);
