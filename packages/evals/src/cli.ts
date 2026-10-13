/* eslint-disable security/detect-non-literal-fs-filename -- Offline operator-selected inputs, fixed implementation files, and exclusively created output artifacts; no server-controlled paths. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { runSyntheticBaseline } from './baseline.js';
import { EvaluationError, canonicalJson, evidenceHash } from './contracts.js';
import { prepareEvaluationReview } from './review.js';
import { evaluate } from './scoring.js';
import { createSeedCorpus } from './seed.js';

const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const help = `Offline synthetic evaluation. No network calls or release promotion.
  seed --out <new-directory>
  score --corpus <json> --results <json> --out <new-directory>
  verify --corpus <json> --results <json> --report <json> --review <json>
Existing output directories are never overwritten. Imported provenance is unverified.`;

async function readJson(path: string): Promise<unknown> {
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_INPUT_BYTES) throw new EvaluationError('INVALID_INPUT');
  const bytes = await readFile(path);
  if (bytes.length > MAX_INPUT_BYTES) throw new EvaluationError('INVALID_INPUT');
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new EvaluationError('INVALID_INPUT');
  }
}

async function implementationHash(): Promise<string> {
  const files: { path: string; sha256: string }[] = [];
  for (const [prefix, directory] of [
    ['evals', new URL('.', import.meta.url)],
    ['model-gateway', new URL('.', import.meta.resolve('@dentabill/model-gateway'))],
  ] as const) {
    for (const name of (await readdir(directory)).sort()) {
      if (!name.endsWith('.ts') || name.endsWith('.test.ts') || name === 'test-fixtures.ts')
        continue;
      const bytes = await readFile(new URL(name, directory));
      files.push({
        path: `${prefix}/${name}`,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    for (const name of ['package.json', 'tsconfig.json']) {
      const bytes = await readFile(new URL(`../${name}`, directory));
      files.push({
        path: `${prefix}/${name}`,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
  const lock = await readFile(new URL('../../../pnpm-lock.yaml', import.meta.url));
  files.push({ path: 'pnpm-lock.yaml', sha256: createHash('sha256').update(lock).digest('hex') });
  return evidenceHash(files);
}

async function writeArtifacts(
  directory: string,
  artifacts: Record<string, unknown>,
): Promise<void> {
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'EEXIST')
      throw new EvaluationError('OUTPUT_EXISTS');
    throw new EvaluationError('INVALID_INPUT');
  }
  for (const [name, value] of Object.entries(artifacts))
    await writeFile(resolve(directory, name), `${canonicalJson(value)}\n`, {
      flag: 'wx',
      mode: 0o600,
    });
}

export async function runEvaluationCli(args: readonly string[]): Promise<void> {
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
    process.stdout.write(`${help}\n`);
    return;
  }
  const command = args[0];
  const required =
    command === 'seed'
      ? ['out']
      : command === 'score'
        ? ['corpus', 'results', 'out']
        : command === 'verify'
          ? ['corpus', 'results', 'report', 'review']
          : null;
  if (!required || args.length !== 1 + required.length * 2)
    throw new EvaluationError('INVALID_INPUT');
  const flags = new Map<string, string>();
  for (let i = 1; i < args.length; i += 2) {
    const name = args[i]?.slice(2);
    const value = args[i + 1];
    if (
      !args[i]?.startsWith('--') ||
      !name ||
      !required.includes(name) ||
      !value ||
      flags.has(name)
    )
      throw new EvaluationError('INVALID_INPUT');
    flags.set(name, value);
  }
  if (required.some((name) => !flags.has(name))) throw new EvaluationError('INVALID_INPUT');
  const option = (name: string): string => {
    const value = flags.get(name);
    if (!value) throw new EvaluationError('INVALID_INPUT');
    return value;
  };
  const corpus = command === 'seed' ? createSeedCorpus() : await readJson(option('corpus'));
  const results =
    command === 'seed' ? await runSyntheticBaseline(corpus) : await readJson(option('results'));
  const report =
    command === 'verify' ? await readJson(option('report')) : evaluate(corpus, results);
  const review = prepareEvaluationReview(corpus, results, report, await implementationHash());
  if (command === 'verify') {
    const saved = await readJson(option('review'));
    if (evidenceHash(saved) !== evidenceHash(review)) throw new EvaluationError('INVALID_REPORT');
    process.stdout.write('EVALUATION_BINDINGS_VERIFIED; productionApproval=false\n');
    return;
  }
  await writeArtifacts(option('out'), {
    'corpus.json': corpus,
    'results.json': results,
    'report.json': report,
    'review.json': review,
  });
  process.stdout.write(
    `EVALUATION_SAVED; cases=${String(review.counts.cases)}; productionApproval=false\n`,
  );
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href ===
    pathToFileURL(fileURLToPath(import.meta.url)).href
) {
  runEvaluationCli(process.argv.slice(2)).catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof EvaluationError ? error.code : 'EVALUATION_IO_FAILED'}\n`,
    );
    process.exitCode = 1;
  });
}
