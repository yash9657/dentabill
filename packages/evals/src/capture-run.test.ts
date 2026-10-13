/* eslint-disable security/detect-non-literal-fs-filename -- Tests own private temporary directories. */
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFireworksDiscoveryTransport } from '@dentabill/model-gateway';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createCapturePlan } from './capture-plan.js';
import { runCapture, verifyCaptureAccount } from './capture-run.js';
import { CaptureStore } from './capture-store.js';
import { evidenceHash } from './contracts.js';
import { createSeedCorpus } from './seed.js';

const artifact = 'a'.repeat(64);
const directories: string[] = [];

async function fixture(count = 1) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'dentabill-capture-run-')));
  directories.push(parent);
  const directory = join(parent, 'run');
  const corpus = createSeedCorpus();
  corpus.cases = corpus.cases.slice(0, count);
  const plan = createCapturePlan({
    corpus,
    candidateId: 'glm-flash-claim-observation.v1',
    directory,
    implementationSha256: artifact,
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
      publisherRevision: 'synthetic-license-revision',
      publisherLicenseSha256: 'd'.repeat(64),
      servingRevisionVerified: false,
      regionalRouteVerified: false,
    },
  });
  const store = await CaptureStore.create(directory, plan);
  await store.create('corpus.json', corpus);
  const run = {
    store,
    implementationSha256: artifact,
    authorizePlanSha256: evidenceHash(plan),
    apiKey: 'synthetic-test-key',
    verifyAccount: vi.fn(async () => undefined),
  };
  const name = (kind: string, index = 0): string => {
    const entry = plan.cases[index];
    if (!entry) throw new Error('Missing synthetic case');
    return `case-${entry.storageId}-${kind}.json`;
  };
  return { plan, store, run, name };
}

function response(inputTokens = 12, outputTokens = 8): Response {
  return new Response(
    JSON.stringify({
      model: 'unverified-provider-declaration',
      choices: [
        {
          index: 0,
          finish_reason: 'length',
          message: { role: 'assistant', content: 'PRIVATE_CAPTURE_CANARY' },
        },
      ],
      usage: {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
      },
    }),
  );
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('durable synthetic discovery capture', () => {
  it('captures the exact inventory once and reopens without account access or another send', async () => {
    const { run, store, plan, name } = await fixture(2);
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (typeof init?.body !== 'string') throw new Error('Expected synthetic request body');
      expect(JSON.parse(init.body)).toMatchObject({
        max_tokens: 4096,
        stream: false,
        n: 1,
      });
      const admission = await store.read(name('admission', fetcher.mock.calls.length - 1));
      expect(admission).toMatchObject({
        disposition: 'SEND',
        reservedUsdMicros: plan.budget.reservedPerCaseUsdMicros,
      });
      return response();
    });
    const transport = createFireworksDiscoveryTransport({ fetch: fetcher });
    const report = await runCapture({ ...run, transport });
    expect(report).toMatchObject({
      captured: 2,
      unknown: 0,
      failed: 0,
      notSent: 0,
      measuredModelQuality: false,
      productionApproval: false,
    });
    expect(report.cases).toHaveLength(2);
    expect(JSON.stringify(report)).not.toContain('PRIVATE_CAPTURE_CANARY');
    expect(JSON.stringify(await store.read(name('response')))).toContain('PRIVATE_CAPTURE_CANARY');
    expect(plan.target.policy.state).toBe('CANDIDATE');
    expect(plan.target.approval).toBeNull();
    expect(report.budget.reservedTotalUsdMicros).toBe(plan.budget.reservedTotalUsdMicros);
    const replay = await runCapture({ ...run, transport, apiKey: '' });
    expect(replay).toEqual(report);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(run.verifyAccount).toHaveBeenCalledTimes(1);
  });

  it('requires the exact reviewed plan and correct account before inference', async () => {
    const { run, store, name } = await fixture();
    const fetcher = vi.fn(async () => response());
    const transport = createFireworksDiscoveryTransport({ fetch: fetcher });
    await expect(
      runCapture({ ...run, authorizePlanSha256: 'f'.repeat(64), transport }),
    ).rejects.toMatchObject({ code: 'CAPTURE_AUTHORIZATION_REQUIRED' });
    expect(await store.read('authorization.json')).toBeNull();
    await expect(
      runCapture({
        ...run,
        transport,
        verifyAccount: async () => {
          throw new Error('synthetic account denied');
        },
      }),
    ).rejects.toThrow('synthetic account denied');
    expect(fetcher).not.toHaveBeenCalled();
    expect(await store.read(name('admission'))).toBeNull();
  });

  it('retains unknown liability and never resends a network outcome', async () => {
    const { run, store, name } = await fixture();
    const fetcher = vi.fn(async () => {
      throw new Error('PRIVATE_CAPTURE_CANARY');
    });
    const transport = createFireworksDiscoveryTransport({ fetch: fetcher });
    const report = await runCapture({ ...run, transport });
    expect(report).toMatchObject({ captured: 0, unknown: 1, failed: 0, notSent: 0 });
    expect(report.cases[0]?.attempts[0]).toMatchObject({ acceptance: 'POSSIBLE' });
    expect(await store.read(name('response'))).toBeNull();
    expect(JSON.stringify(report)).not.toContain('PRIVATE_CAPTURE_CANARY');
    expect(await runCapture({ ...run, transport })).toEqual(report);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([401, 429, 500])('records HTTP %i once without automatic retry', async (status) => {
    const { run, store, name } = await fixture();
    const fetcher = vi.fn(async () => new Response('PRIVATE_REMOTE_ERROR', { status }));
    const report = await runCapture({
      ...run,
      transport: createFireworksDiscoveryTransport({ fetch: fetcher }),
    });
    expect(report.failed).toBe(1);
    expect(report.cases[0]?.code).toBe('HTTP_ERROR');
    expect(await store.read(name('response'))).toMatchObject({ status, body: null });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retains malformed raw success evidence while marking its interpretation failed', async () => {
    const { run, store, name } = await fixture();
    const report = await runCapture({
      ...run,
      transport: createFireworksDiscoveryTransport({
        fetch: async () => new Response('PRIVATE_INVALID_JSON'),
      }),
    });
    expect(report).toMatchObject({ failed: 1, captured: 0 });
    expect(await store.read(name('response'))).toMatchObject({ body: 'PRIVATE_INVALID_JSON' });
    expect(JSON.stringify(report)).not.toContain('PRIVATE_INVALID_JSON');
  });

  it('atomically prohibits all cancelled cases and keeps them in the inventory', async () => {
    const { run, store, name } = await fixture(2);
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn(async () => response());
    const transport = createFireworksDiscoveryTransport({ fetch: fetcher });
    const report = await runCapture({ ...run, transport, signal: controller.signal });
    expect(report).toMatchObject({ notSent: 2, captured: 0 });
    expect(await store.read(name('admission'))).toMatchObject({
      disposition: 'NO_SEND',
      noSendCode: 'CANCELLED',
      reservedUsdMicros: 0,
    });
    expect(report.cases).toHaveLength(2);
    expect(await runCapture({ ...run, transport })).toEqual(report);
    expect(fetcher).not.toHaveBeenCalled();
    expect(run.verifyAccount).not.toHaveBeenCalled();
  });

  it('does not let a cancelled concurrent runner hide another runner admission or response', async () => {
    const { run, store, name } = await fixture();
    const inVerification = gate();
    const releaseVerification = gate();
    const sent = gate();
    const releaseResponse = gate();
    const controller = new AbortController();
    const fetcher = vi.fn(async () => {
      sent.resolve();
      await releaseResponse.promise;
      return response();
    });
    const transport = createFireworksDiscoveryTransport({ fetch: fetcher });
    const cancelled = runCapture({
      ...run,
      transport,
      signal: controller.signal,
      verifyAccount: async () => {
        inVerification.resolve();
        await releaseVerification.promise;
      },
    });
    await inVerification.promise;
    const owner = runCapture({ ...run, transport });
    await sent.promise;
    controller.abort();
    releaseVerification.resolve();
    await expect(cancelled).rejects.toMatchObject({ code: 'CAPTURE_BUSY' });
    expect(await store.read(name('result'))).toBeNull();
    releaseResponse.resolve();
    expect((await owner).captured).toBe(1);
    expect((await runCapture({ ...run, transport })).captured).toBe(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not admit a fresh send while another live process owns this case', async () => {
    const { run } = await fixture();
    const sent = gate();
    const releaseResponse = gate();
    const fetcher = vi.fn(async () => {
      sent.resolve();
      await releaseResponse.promise;
      return response();
    });
    const transport = createFireworksDiscoveryTransport({ fetch: fetcher });
    const owner = runCapture({ ...run, transport });
    await sent.promise;
    await expect(runCapture({ ...run, transport })).rejects.toMatchObject({ code: 'CAPTURE_BUSY' });
    releaseResponse.resolve();
    await owner;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('stops later cases if a provider receipt exceeds the frozen token allowance', async () => {
    const { run, plan } = await fixture(2);
    const fetcher = vi.fn(async () => response(plan.budget.inputTokenAllowance + 1));
    const report = await runCapture({
      ...run,
      transport: createFireworksDiscoveryTransport({ fetch: fetcher }),
    });
    expect(report.cases[1]).toMatchObject({ state: 'NOT_SENT', code: 'BUDGET_EXCEEDED' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(report.budget.reservedTotalUsdMicros).toBe(plan.budget.reservedTotalUsdMicros);
  });

  it('rejects changed raw receipts even when a terminal result and report already exist', async () => {
    const { run, store, name } = await fixture();
    const fetcher = vi.fn(async () => response());
    const transport = createFireworksDiscoveryTransport({ fetch: fetcher });
    await runCapture({ ...run, transport });
    const file = join(store.directory, name('response'));
    const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
    raw.body = '{}';
    await writeFile(file, JSON.stringify(raw));
    await expect(runCapture({ ...run, transport })).rejects.toMatchObject({
      code: 'CAPTURE_BINDING_MISMATCH',
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not finalize or proceed after ambiguous raw receipt persistence failure', async () => {
    const { run, store, name } = await fixture(2);
    const create = store.create.bind(store);
    vi.spyOn(store, 'create').mockImplementation(async (key, value) => {
      if (key === name('response')) throw new Error('PRIVATE_FS_ERROR');
      return create(key, value);
    });
    const fetcher = vi.fn(async () => response());
    const transport = createFireworksDiscoveryTransport({ fetch: fetcher });
    await expect(runCapture({ ...run, transport })).rejects.toMatchObject({
      code: 'CAPTURE_JOURNAL_ERROR',
    });
    expect(await store.read(name('result'))).toBeNull();
    expect(await store.read(name('admission', 1))).toBeNull();
    await expect(runCapture({ ...run, transport })).rejects.toMatchObject({ code: 'CAPTURE_BUSY' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('read-only capture account binding', () => {
  it('checks the exact account with no redirects or identity output', async () => {
    const { wireHash } = await import('./capture-plan.js');
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({ accounts: [{ name: 'accounts/synthetic-test' }] })),
    );
    vi.stubGlobal('fetch', fetcher);
    await verifyCaptureAccount('synthetic-key', wireHash('accounts/synthetic-test'));
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.fireworks.ai/v1/accounts?pageSize=2',
      expect.objectContaining({ redirect: 'error' }),
    );
    await expect(verifyCaptureAccount('synthetic-key', 'f'.repeat(64))).rejects.toMatchObject({
      code: 'CAPTURE_ACCOUNT_MISMATCH',
    });
  });
  it.each([
    { accounts: [] },
    { accounts: [{ name: 'accounts/a' }, { name: 'accounts/b' }] },
    { accounts: [{ name: 'accounts/a' }], nextPageToken: 'more' },
    { accounts: [{ name: 'PRIVATE_INVALID_ACCOUNT' }] },
  ])('rejects incomplete or ambiguous account metadata', async (value) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(value))),
    );
    await expect(verifyCaptureAccount('synthetic-key', 'f'.repeat(64))).rejects.toMatchObject({
      code: 'CAPTURE_ACCOUNT_MISMATCH',
    });
  });
});
