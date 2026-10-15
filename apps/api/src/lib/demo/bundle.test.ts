import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  DemoBundleError,
  DemoManifestSchema,
  verifyDemoBundle,
  type DemoBundleErrorCode,
} from './bundle.js';

const published = fileURLToPath(new URL('../../../../web/public/examples/demo/', import.meta.url));
const temporary: string[] = [];
const marker = 'SYNTHETIC-PRIVATE-BUNDLE-MARKER';

async function copy(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'dentabill-demo-bundle-'));
  temporary.push(directory);
  await cp(published, directory, { recursive: true });
  return directory;
}
async function readJson(directory: string, name: string): Promise<Record<string, unknown>> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test-owned temporary files
  return JSON.parse(await readFile(join(directory, name), 'utf8')) as Record<string, unknown>;
}
async function save(directory: string, name: string, value: unknown): Promise<void> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test-owned temporary files
  await writeFile(join(directory, name), JSON.stringify(value));
}
async function rehash(directory: string, name: string): Promise<void> {
  const manifest = DemoManifestSchema.parse(await readJson(directory, 'manifest.json'));
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- test-owned temporary files
  const bytes = await readFile(join(directory, name));
  const entry = manifest.files.find((file) => file.name === name);
  if (!entry) throw new Error('Test file missing from manifest.');
  entry.sha256 = createHash('sha256').update(bytes).digest('hex');
  await save(directory, 'manifest.json', manifest);
}
async function fails(directory: string, code: DemoBundleErrorCode): Promise<void> {
  const error: unknown = await verifyDemoBundle(directory).catch((reason: unknown) => reason);
  expect(error).toBeInstanceOf(DemoBundleError);
  expect(error).toMatchObject({ code, message: code });
  expect(JSON.stringify(error)).not.toContain(marker);
  expect(JSON.stringify(error)).not.toContain(directory);
}
afterEach(async () => {
  for (const directory of temporary.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('published synthetic demo bundle', () => {
  it('verifies exact published bytes, real parser output, source identities and separate financial amounts', async () => {
    const bundle = await verifyDemoBundle(published);
    expect(bundle.manifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(bundle.manifest.files).toHaveLength(7);
    expect(
      bundle.claims.map((claim) => [claim.sourceClaimId, claim.claimAmount, claim.payerCode]),
    ).toEqual([
      ['demo-claim-a', '200.00', 'DELTA_DENTAL_PPO'],
      ['demo-claim-b', '160.00', 'DELTA_DENTAL_PPO'],
    ]);
    expect(bundle.remittances.map((row) => row.input.reportedAmount)).toEqual(['100.00', '80.00']);
    expect(bundle.batch).toMatchObject({
      reportedClaimAmount: '180.00',
      reportedAdjustmentAmount: '-30.00',
      reportedNetAmount: '150.00',
    });
    expect(bundle.cash).toMatchObject({
      amount: '150.00',
      sourceAmount: '-150.00',
      sourceSignConvention: 'DEBIT_POSITIVE',
    });
    expect(bundle.posting.entries[1]).toMatchObject({
      sourceLineId: null,
      sourceProcedureId: 'demo-unresolved-procedure-b',
      entryKind: 'TRANSFER',
      sourceIsTransfer: true,
      amount: '80.00',
    });
    expect(bundle.posting.amount).toBe('150.00');
    expect(bundle.posting.entries.map((entry) => entry.amount)).toEqual(['100.00', '80.00']);
    expect(bundle.batchCorrection).toMatchObject({
      schemaVersion: 2,
      sourceSequence: 1,
      sourceBatchId: bundle.batch.sourceBatchId,
      reportedNetAmount: '140.00',
    });
  });

  it('supports the baseline chapter without the optional correction file', async () => {
    const directory = await copy();
    const manifest = DemoManifestSchema.parse(await readJson(directory, 'manifest.json'));
    manifest.files = manifest.files.filter((file) => file.kind !== 'BATCH_CORRECTION');
    await save(directory, 'manifest.json', manifest);
    expect((await verifyDemoBundle(directory)).batchCorrection).toBeNull();
  });

  it.each([
    { synthetic: false },
    { scenarioId: marker },
    { sourceNamespace: 'other-office' },
    { sourceSystem: 'SYNTHETIC_PMS' },
    { organizationId: marker },
    { expected: { cash: '180.00' } },
  ])('rejects changed scenario authority and financial expectations %#', async (patch) => {
    const directory = await copy();
    await save(directory, 'manifest.json', {
      ...(await readJson(directory, 'manifest.json')),
      ...patch,
    });
    await fails(directory, 'DEMO_BUNDLE_MANIFEST_INVALID');
  });

  it.each(['../private.json', '/private.json', 'sub/file.json', 'manifest.json'])(
    'rejects unsafe or recursive manifest filename %s',
    async (name) => {
      const directory = await copy();
      const manifest = DemoManifestSchema.parse(await readJson(directory, 'manifest.json'));
      manifest.files[0]!.name = name;
      await save(directory, 'manifest.json', manifest);
      await fails(directory, 'DEMO_BUNDLE_MANIFEST_INVALID');
    },
  );

  it('rejects duplicate filenames and missing required file kinds', async () => {
    const directory = await copy();
    let manifest = DemoManifestSchema.parse(await readJson(directory, 'manifest.json'));
    manifest.files[1] = { ...manifest.files[2]! };
    await save(directory, 'manifest.json', manifest);
    await fails(directory, 'DEMO_BUNDLE_MANIFEST_INVALID');
    manifest = DemoManifestSchema.parse(await readJson(published, 'manifest.json'));
    manifest.files = manifest.files.filter((file) => file.kind !== 'CASH_EVIDENCE');
    await save(directory, 'manifest.json', manifest);
    await fails(directory, 'DEMO_BUNDLE_MANIFEST_INVALID');
  });

  it('rejects byte changes before parsing and does not expose private input', async () => {
    const directory = await copy();
    await save(directory, 'cash.json', { private: marker });
    await fails(directory, 'DEMO_BUNDLE_HASH_MISMATCH');
    await rehash(directory, 'cash.json');
    await fails(directory, 'DEMO_BUNDLE_CONTRACT_INVALID');
  });

  it.each([
    ['posting.json', { sourceNamespace: 'other-office' }, 'DEMO_BUNDLE_IDENTITY_MISMATCH'],
    ['batch.json', { sourceBatchId: 'different-batch' }, 'DEMO_BUNDLE_IDENTITY_MISMATCH'],
    ['remittance-a.json', { sourceRecordId: 'different-record' }, 'DEMO_BUNDLE_IDENTITY_MISMATCH'],
    ['cash.json', { amount: '180.00', sourceAmount: '-180.00' }, 'DEMO_BUNDLE_FINANCIAL_MISMATCH'],
    [
      'posting.json',
      { amount: '180.00', sourceAmount: '-180.00' },
      'DEMO_BUNDLE_FINANCIAL_MISMATCH',
    ],
    ['batch-correction.json', { reportedNetAmount: '150.00' }, 'DEMO_BUNDLE_FINANCIAL_MISMATCH'],
  ] as const)('rejects rehashed incompatible %s facts %#', async (name, patch, code) => {
    const directory = await copy();
    await save(directory, name, { ...(await readJson(directory, name)), ...patch });
    await rehash(directory, name);
    await fails(directory, code);
  });

  it.each(['sourceClaimId', 'sourceLineId', 'sourceProcedureId'] as const)(
    'rejects an exact posting target mismatch in %s even after rehashing',
    async (field) => {
      const directory = await copy();
      const posting = await readJson(directory, 'posting.json');
      const entries = posting.entries as Record<string, unknown>[];
      entries[0]![field] = 'other-source-reference';
      await save(directory, 'posting.json', posting);
      await rehash(directory, 'posting.json');
      await fails(directory, 'DEMO_BUNDLE_IDENTITY_MISMATCH');
    },
  );

  it('rejects a procedure-only reference promoted into a line association', async () => {
    const directory = await copy();
    const posting = await readJson(directory, 'posting.json');
    const entries = posting.entries as Record<string, unknown>[];
    entries[1]!.sourceLineId = 'demo-line-b';
    await save(directory, 'posting.json', posting);
    await rehash(directory, 'posting.json');
    await fails(directory, 'DEMO_BUNDLE_IDENTITY_MISMATCH');
  });

  it.each(['unsupported-payer', 'missing-subscriber'] as const)(
    'runs the real CSV parser and rejects %s data',
    async (kind) => {
      const directory = await copy();
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- test-owned temporary file
      const csv = await readFile(join(directory, 'claims.csv'), 'utf8');
      const changed =
        kind === 'unsupported-payer'
          ? csv.replaceAll('Delta Dental PPO', marker)
          : csv.replace('SYNTHETIC-DEMO-SUBSCRIBER-A', '');
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- test-owned temporary file
      await writeFile(join(directory, 'claims.csv'), changed);
      await rehash(directory, 'claims.csv');
      await fails(directory, 'DEMO_BUNDLE_IDENTITY_MISMATCH');
    },
  );

  it('rejects invalid UTF-8 even when its exact bytes match the manifest', async () => {
    const directory = await copy();
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test-owned temporary file
    await writeFile(join(directory, 'cash.json'), Buffer.from([0xc3, 0x28]));
    await rehash(directory, 'cash.json');
    await fails(directory, 'DEMO_BUNDLE_CONTRACT_INVALID');
  });

  it('rejects symlinked files and directories without following their content', async () => {
    const directory = await copy();
    await rm(join(directory, 'cash.json'));
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- explicit symlink rejection test within temporary directory
    await symlink(join(published, 'cash.json'), join(directory, 'cash.json'));
    await fails(directory, 'DEMO_BUNDLE_FILE_INVALID');
    const alias = join(directory, 'alias');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- explicit symlink rejection test within temporary directory
    await symlink(published, alias);
    await fails(alias, 'DEMO_BUNDLE_DIRECTORY_INVALID');
    await fails(`${alias}/`, 'DEMO_BUNDLE_DIRECTORY_INVALID');
  });

  it('rejects oversized regular files before allocating or parsing their contents', async () => {
    const directory = await copy();
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- test-owned temporary file
    await writeFile(join(directory, 'cash.json'), Buffer.alloc(256 * 1024 + 1, 32));
    await fails(directory, 'DEMO_BUNDLE_FILE_INVALID');
  });
});
