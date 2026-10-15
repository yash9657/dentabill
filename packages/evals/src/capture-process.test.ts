/* eslint-disable security/detect-non-literal-fs-filename -- All paths belong to private synthetic test directories. */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, open, readFile, realpath, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCapturePlan, wireHash } from './capture-plan.js';
import { CaptureStore } from './capture-store.js';
import { evidenceHash } from './contracts.js';
import { createSeedCorpus } from './seed.js';

interface ProcessExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}
interface CaptureProcess {
  child: ChildProcess;
  closed: Promise<ProcessExit>;
  output(): string;
}
const processes: CaptureProcess[] = [];
const servers: Server[] = [];
const directories: string[] = [];

async function kill(process: CaptureProcess): Promise<ProcessExit> {
  if (process.child.exitCode === null && process.child.signalCode === null)
    process.child.kill('SIGKILL');
  return process.closed;
}

function start(
  directory: string,
  providerUrl: string,
  checkpoint?: string,
  saveCancelledAttempt = false,
): CaptureProcess {
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      fileURLToPath(new URL('./capture-process.fixture.ts', import.meta.url)),
      directory,
      providerUrl,
      checkpoint
        ? saveCancelledAttempt
          ? 'PAUSE_AFTER_CANCELLED_RAW'
          : 'PAUSE_AFTER_RAW'
        : 'NORMAL',
      ...(checkpoint ? [checkpoint] : []),
    ],
    {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      // No inherited credentials, database URL, NODE_OPTIONS, or dotenv configuration.
      env: { PATH: process.env.PATH, NODE_ENV: 'test', TZ: 'UTC' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let output = '';
  const collect = (chunk: Buffer): void => {
    output = (output + chunk.toString('utf8')).slice(-4096);
  };
  child.stdout.on('data', collect);
  child.stderr.resume();
  const closed = new Promise<ProcessExit>((resolve, reject) => {
    child.once('error', () => {
      reject(new Error('SYNTHETIC_PROCESS_START_FAILED'));
    });
    child.once('close', (code, signal) => {
      resolve({ code, signal });
    });
  });
  const value = { child, closed, output: () => output };
  processes.push(value);
  return value;
}

async function fixture(holdResponse: boolean, count = 1, inputTokens = 10) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'dentabill-capture-process-')));
  directories.push(parent);
  const directory = join(parent, 'run');
  const corpus = createSeedCorpus();
  corpus.cases = corpus.cases.slice(0, count);
  const plan = createCapturePlan({
    corpus,
    candidateId: 'glm-flash-claim-observation.v1',
    directory,
    implementationSha256: 'a'.repeat(64),
    allowanceUsdMicros: 50_000_000,
    evidence: {
      checkedAt: new Date().toISOString(),
      accountSha256: 'b'.repeat(64),
      accountEvidenceSha256: 'c'.repeat(64),
      priceSource: 'https://docs.fireworks.ai/serverless/pricing',
      contextSource: 'https://docs.fireworks.ai/api-reference/get-model',
      model: 'accounts/fireworks/routers/glm-5p3-flash-us',
      serviceTier: 'STANDARD_DEFAULT',
      contextTokens: 1_048_576,
      inputUsdMicrosPerMillion: 225_000,
      outputUsdMicrosPerMillion: 750_000,
      publisherRevision: 'synthetic-process-fixture',
      publisherLicenseSha256: 'd'.repeat(64),
      servingRevisionVerified: false,
      regionalRouteVerified: false,
    },
  });
  const store = await CaptureStore.create(directory, plan);
  await store.create('corpus.json', corpus);
  const ledgerPath = join(parent, 'synthetic-provider-acceptances.jsonl');
  const ledger = await open(ledgerPath, 'wx', 0o600);
  await ledger.sync();
  await ledger.close();
  const parentHandle = await open(parent, 'r');
  await parentHandle.sync();
  await parentHandle.close();
  let accepted = 0;
  let durableAccepted = 0;
  let providerFailed = false;
  const responseBody = JSON.stringify({
    id: 'synthetic-process-response',
    model: 'unreviewed-synthetic-provider-model',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: 'Synthetic unverified capture.' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: inputTokens, completion_tokens: 2, total_tokens: inputTokens + 2 },
  });
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on('end', () => {
      void (async () => {
        if (
          request.method !== 'POST' ||
          request.url !== '/synthetic' ||
          request.headers.authorization !== 'Bearer synthetic-local-provider'
        )
          throw new Error('INVALID_SYNTHETIC_REQUEST');
        const entry = {
          ordinal: ++accepted,
          requestSha256: wireHash(Buffer.concat(chunks).toString('utf8')),
        };
        // This provider-side ledger is outside the child journal and survives its SIGKILL.
        const file = await open(ledgerPath, 'a', 0o600);
        try {
          await file.writeFile(`${JSON.stringify(entry)}\n`);
          await file.sync();
        } finally {
          await file.close();
        }
        durableAccepted = entry.ordinal;
        if (holdResponse) return;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(responseBody);
      })().catch(() => {
        providerFailed = true;
        response.destroy();
      });
    });
  });
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('SYNTHETIC_PROVIDER_BIND_FAILED');
  const first = plan.cases[0];
  if (!first) throw new Error('SYNTHETIC_CASE_MISSING');
  return {
    plan,
    store,
    parent,
    responseBody,
    url: `http://127.0.0.1:${String(address.port)}/synthetic`,
    name: (kind: string) => `case-${first.storageId}-${kind}.json`,
    async ledger(): Promise<unknown[]> {
      if (providerFailed) throw new Error('SYNTHETIC_PROVIDER_FAILED');
      return (await readFile(ledgerPath, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as unknown)
        .slice(0, durableAccepted);
    },
  };
}

afterEach(async () => {
  for (const process of processes.splice(0)) await kill(process);
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('synthetic localhost capture process durability', () => {
  it('does not resend after SIGKILL following provider acceptance without a durable response', async () => {
    const input = await fixture(true);
    const worker = start(input.store.directory, input.url);
    await vi.waitFor(
      async () => {
        expect(await input.ledger()).toHaveLength(1);
      },
      { timeout: 10_000, interval: 20 },
    );
    expect(await kill(worker)).toEqual({ code: null, signal: 'SIGKILL' });
    expect(await input.store.read(input.name('response'))).toBeNull();
    expect(await input.store.read(input.name('result'))).toBeNull();
    const admission = await input.store.read(input.name('admission'));
    expect(admission).toMatchObject({
      ownerPid: worker.child.pid,
      disposition: 'SEND',
      reservedUsdMicros: input.plan.budget.reservedPerCaseUsdMicros,
    });
    const resumed = start(input.store.directory, input.url);
    expect(await resumed.closed).toEqual({ code: 0, signal: null });
    expect(resumed.output()).toBe('CAPTURE_PROCESS_COMPLETED\n');
    expect(await input.store.read('capture-report.json')).toMatchObject({
      captured: 0,
      unknown: 1,
      failed: 0,
      notSent: 0,
      productionApproval: false,
      measuredModelQuality: false,
      budget: input.plan.budget,
      cases: [
        {
          state: 'UNKNOWN',
          code: 'INFERENCE_REVIEW_REQUIRED',
          responseSha256: null,
          attempts: [{ index: 1, acceptance: 'POSSIBLE', usage: { totalTokens: null } }],
        },
      ],
    });
    expect(await input.store.read(input.name('admission'))).toEqual(admission);
    expect(await input.ledger()).toEqual([
      { ordinal: 1, requestSha256: input.plan.cases[0]?.wireRequestSha256 },
    ]);
  }, 30_000);

  it('locally replays a raw response after SIGKILL before interpretation without a second send', async () => {
    const input = await fixture(false);
    const checkpoint = join(input.parent, 'raw-response.checkpoint');
    const worker = start(input.store.directory, input.url, checkpoint);
    await vi.waitFor(
      async () => {
        expect(await readFile(checkpoint, 'utf8')).toBe('RAW_RESPONSE_DURABLE\n');
      },
      { timeout: 10_000, interval: 20 },
    );
    expect(await kill(worker)).toEqual({ code: null, signal: 'SIGKILL' });
    const receipt = await input.store.read(input.name('response'));
    expect(receipt).toMatchObject({ index: 1, status: 200, body: input.responseBody });
    expect(await input.store.read(input.name('attempt'))).toBeNull();
    expect(await input.store.read(input.name('result'))).toBeNull();
    const resumed = start(input.store.directory, input.url);
    expect(await resumed.closed).toEqual({ code: 0, signal: null });
    expect(resumed.output()).toBe('CAPTURE_PROCESS_COMPLETED\n');
    expect(await input.store.read('capture-report.json')).toMatchObject({
      captured: 1,
      unknown: 0,
      failed: 0,
      notSent: 0,
      productionApproval: false,
      measuredModelQuality: false,
      cases: [
        {
          state: 'CAPTURED_UNVERIFIED',
          code: null,
          responseSha256: evidenceHash(receipt),
          attempts: [
            { index: 1, httpStatus: 200, acceptance: 'RESPONDED', usage: { totalTokens: 12 } },
          ],
        },
      ],
    });
    expect(await input.store.read(input.name('response'))).toEqual(receipt);
    expect(await input.ledger()).toEqual([
      { ordinal: 1, requestSha256: input.plan.cases[0]?.wireRequestSha256 },
    ]);
  }, 30_000);

  it('retains an interrupted null-usage attempt across SIGKILL but stops the next case from raw over-allowance usage', async () => {
    const input = await fixture(false, 2, 1_048_577);
    const checkpoint = join(input.parent, 'raw-over-allowance.checkpoint');
    const worker = start(input.store.directory, input.url, checkpoint, true);
    await vi.waitFor(
      async () => {
        expect(await readFile(checkpoint, 'utf8')).toBe('RAW_RESPONSE_DURABLE\n');
      },
      { timeout: 10_000, interval: 20 },
    );
    expect(await kill(worker)).toEqual({ code: null, signal: 'SIGKILL' });
    const receipt = await input.store.read(input.name('response'));
    expect(receipt).toMatchObject({ status: 200, body: input.responseBody });
    const cancelledAttempt = await input.store.read(input.name('attempt'));
    expect(cancelledAttempt).toMatchObject({
      errorCode: 'CANCELLED',
      attempt: {
        index: 1,
        httpStatus: 200,
        acceptance: 'RESPONDED',
        outcome: 'CANCELLED',
        usage: {
          inputTokens: null,
          outputTokens: null,
          totalTokens: null,
          cachedInputTokens: null,
        },
      },
    });
    const resumed = start(input.store.directory, input.url);
    expect(await resumed.closed).toEqual({ code: 0, signal: null });
    expect(resumed.output()).toBe('CAPTURE_PROCESS_COMPLETED\n');
    expect(await input.store.read('capture-report.json')).toMatchObject({
      captured: 1,
      unknown: 0,
      failed: 0,
      notSent: 1,
      productionApproval: false,
      measuredModelQuality: false,
      budget: input.plan.budget,
      cases: [
        {
          state: 'CAPTURED_UNVERIFIED',
          responseSha256: evidenceHash(receipt),
          attempts: [{ outcome: 'CANCELLED', usage: { inputTokens: null, totalTokens: null } }],
        },
        { state: 'NOT_SENT', code: 'BUDGET_EXCEEDED', attempts: [], responseSha256: null },
      ],
    });
    const second = input.plan.cases[1];
    if (!second) throw new Error('SYNTHETIC_SECOND_CASE_MISSING');
    expect(await input.store.read(`case-${second.storageId}-response.json`)).toBeNull();
    expect(await input.store.read(input.name('response'))).toEqual(receipt);
    expect(await input.store.read(input.name('attempt'))).toEqual(cancelledAttempt);
    expect(await input.ledger()).toEqual([
      { ordinal: 1, requestSha256: input.plan.cases[0]?.wireRequestSha256 },
    ]);
  }, 30_000);
});
