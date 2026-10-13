/* eslint-disable security/detect-non-literal-fs-filename -- Explicit offline operator inputs; run records use the private CaptureStore allowlist. */
import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { implementationHash } from './artifact.js';
import { CaptureError, createCapturePlan, validateCapturePlan } from './capture-plan.js';
import { runCapture } from './capture-run.js';
import { CaptureStore, CaptureStoreError } from './capture-store.js';
import { EvaluationError, evidenceHash, parseCorpus } from './contracts.js';

const help = `Synthetic Fireworks contract discovery. No production release approval.
  prepare --corpus <json> --candidate <release-id> --evidence <json> --allowance-usd <decimal> --out <new-absolute-directory>
  inspect --run <absolute-directory>
  run --run <absolute-directory> --authorize-plan <exact-sha256>
Prepare and inspect make no network requests. Run requires explicit spending authorization
and FIREWORKS_API_KEY in the process environment. It binds that key's account before inference.
Only one attempt per frozen case. Unknown outcomes are never resent. Raw receipts stay private.
The price-based allowance is not a verified provider-side billing cap.`;

async function readInput(path: string): Promise<unknown> {
  const info = await stat(path);
  if (!info.isFile() || info.size > 16 * 1024 * 1024)
    throw new CaptureError('CAPTURE_INVALID_INPUT');
  const bytes = await readFile(path);
  if (bytes.length > 16 * 1024 * 1024) throw new CaptureError('CAPTURE_INVALID_INPUT');
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch {
    throw new CaptureError('CAPTURE_INVALID_INPUT');
  }
}

function allowance(value: string): number {
  const parts = value.split('.');
  const [whole = '', fractional = ''] = parts;
  if (
    parts.length > 2 ||
    !/^[0-9]{1,3}$/.test(whole) ||
    (whole.length > 1 && whole.startsWith('0')) ||
    (parts.length === 2 && !/^[0-9]{1,6}$/.test(fractional))
  )
    throw new CaptureError('CAPTURE_INVALID_INPUT');
  return Number(whole) * 1_000_000 + Number(fractional.padEnd(6, '0'));
}

export async function runCaptureCli(args: readonly string[]): Promise<void> {
  if (args.length === 0 || (args.length === 1 && args[0] === '--help')) {
    process.stdout.write(`${help}\n`);
    return;
  }
  const command = args[0];
  const required =
    command === 'prepare'
      ? ['corpus', 'candidate', 'evidence', 'allowance-usd', 'out']
      : command === 'inspect'
        ? ['run']
        : command === 'run'
          ? ['run', 'authorize-plan']
          : null;
  if (!required || args.length !== 1 + required.length * 2)
    throw new CaptureError('CAPTURE_INVALID_INPUT');
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
      throw new CaptureError('CAPTURE_INVALID_INPUT');
    flags.set(name, value);
  }
  const option = (name: string): string => {
    const value = flags.get(name);
    if (!value) throw new CaptureError('CAPTURE_INVALID_INPUT');
    return value;
  };
  const artifact = await implementationHash();
  if (command === 'prepare') {
    const corpus = parseCorpus(await readInput(option('corpus')));
    const destination = resolve(option('out'));
    const directory = join(await realpath(dirname(destination)), basename(destination));
    const plan = createCapturePlan({
      corpus,
      candidateId: option('candidate'),
      evidence: await readInput(option('evidence')),
      directory,
      implementationSha256: artifact,
      allowanceUsdMicros: allowance(option('allowance-usd')),
    });
    const store = await CaptureStore.create(directory, plan);
    await store.create('corpus.json', corpus);
    process.stdout.write(
      `CAPTURE_PREPARED; cases=${String(plan.cases.length)}; reservedUsdMicros=${String(plan.budget.reservedTotalUsdMicros)}; planSha256=${evidenceHash(plan)}; authorized=false\n`,
    );
    return;
  }
  const store = await CaptureStore.open(resolve(option('run')));
  const { plan } = validateCapturePlan(
    await store.read('manifest.json'),
    await store.read('corpus.json'),
    artifact,
    store.directory,
  );
  if (command === 'inspect') {
    process.stdout.write(
      `CAPTURE_PLAN_VERIFIED; cases=${String(plan.cases.length)}; reservedUsdMicros=${String(plan.budget.reservedTotalUsdMicros)}; planSha256=${evidenceHash(plan)}; expiresAt=${plan.expiresAt}; productionApproval=false\n`,
    );
    return;
  }
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort();
  };
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  try {
    const report = await runCapture({
      store,
      implementationSha256: artifact,
      authorizePlanSha256: option('authorize-plan'),
      ...(process.env.FIREWORKS_API_KEY ? { apiKey: process.env.FIREWORKS_API_KEY } : {}),
      signal: controller.signal,
    });
    process.stdout.write(
      `CAPTURE_FINISHED; captured=${String(report.captured)}; failed=${String(report.failed)}; unknown=${String(report.unknown)}; notSent=${String(report.notSent)}; productionApproval=false\n`,
    );
  } finally {
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runCaptureCli(process.argv.slice(2)).catch((error: unknown) => {
    const code =
      error instanceof CaptureError || error instanceof EvaluationError
        ? error.code
        : error instanceof CaptureStoreError
          ? `CAPTURE_STORE_${error.code}`
          : 'CAPTURE_IO_FAILED';
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
