#!/usr/bin/env node
/**
 * Bundle budget check for `apps/web`.
 *
 * Enforces ADR-020:
 *   - Per-route initial JS ≤ BUDGET_PER_ROUTE_KB (default 200 KB).
 *   - Total of all initial-JS chunks across the app ≤ BUDGET_TOTAL_KB
 *     (default 350 KB).
 *
 * Reads `apps/web/.next/build-manifest.json` produced by `next build`,
 * walks each route's listed JS chunks, sums their on-disk gzipped sizes,
 * and exits non-zero with a readable diff if any budget is exceeded.
 *
 * Why on-disk gzip and not raw bytes: gzip is what users actually
 * download. Webpack's stat reporter shows raw, which is misleading by
 * ~3x for our typical first-load payload.
 *
 * Usage:
 *   node scripts/check-bundle-budget.mjs           # uses defaults
 *   BUDGET_PER_ROUTE_KB=250 node scripts/...        # override
 */
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const APP_ROOT = join(__dirname, '..');
const NEXT_DIR = join(APP_ROOT, '.next');

const BUDGET_PER_ROUTE_KB = Number(process.env.BUDGET_PER_ROUTE_KB ?? 200);
const BUDGET_TOTAL_KB = Number(process.env.BUDGET_TOTAL_KB ?? 350);

if (!Number.isFinite(BUDGET_PER_ROUTE_KB) || !Number.isFinite(BUDGET_TOTAL_KB)) {
  console.error('Bundle budget env vars must be numeric.');
  process.exit(2);
}

/** @returns {Record<string, string[]>} */
function readManifest() {
  const path = join(NEXT_DIR, 'build-manifest.json');
  try {
    const json = JSON.parse(readFileSync(path, 'utf8'));
    return json.pages ?? {};
  } catch (err) {
    console.error(`Could not read ${path}. Did you run \`next build\`?`);
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  }
}

/**
 * Returns the gzipped size in bytes of a static asset emitted by Next.
 * Files live under `.next/<chunkPath>`.
 */
function gzippedSize(chunkPath) {
  const fullPath = join(NEXT_DIR, chunkPath);
  try {
    const buf = readFileSync(fullPath);
    return gzipSync(buf, { level: 6 }).byteLength;
  } catch (err) {
    // Some manifest entries are virtual placeholders that don't exist on
    // disk (e.g. dev-only). Skip silently.
    if (err && err.code === 'ENOENT') return 0;
    throw err;
  }
}

const KB = 1024;
const fmt = (bytes) => `${(bytes / KB).toFixed(1)} KB`;

const manifest = readManifest();
const allChunks = new Set();
let routeFailures = [];

for (const [route, chunks] of Object.entries(manifest)) {
  let routeBytes = 0;
  for (const chunk of chunks) {
    allChunks.add(chunk);
    routeBytes += gzippedSize(chunk);
  }
  const limit = BUDGET_PER_ROUTE_KB * KB;
  if (routeBytes > limit) {
    routeFailures.push({ route, bytes: routeBytes, limit });
  }
  console.log(`${route.padEnd(30)} ${fmt(routeBytes).padStart(10)}  / ${fmt(limit)}`);
}

let totalBytes = 0;
for (const chunk of allChunks) {
  totalBytes += gzippedSize(chunk);
}
console.log('');
console.log(`Total initial JS (deduplicated): ${fmt(totalBytes)} / ${fmt(BUDGET_TOTAL_KB * KB)}`);
console.log('');

let failed = false;
if (routeFailures.length > 0) {
  failed = true;
  console.error('✖ Per-route bundle budget exceeded:');
  for (const f of routeFailures) {
    const over = f.bytes - f.limit;
    console.error(`  ${f.route}: ${fmt(f.bytes)} (over by ${fmt(over)})`);
  }
}
if (totalBytes > BUDGET_TOTAL_KB * KB) {
  failed = true;
  const over = totalBytes - BUDGET_TOTAL_KB * KB;
  console.error(`✖ Total bundle budget exceeded by ${fmt(over)}`);
}

if (failed) {
  console.error('');
  console.error(
    'Bundle budgets are locked by ADR-020. Either trim the offender, raise the budget through a follow-up ADR, or split the route.',
  );
  process.exit(1);
}

console.log('✓ All bundle budgets respected.');
