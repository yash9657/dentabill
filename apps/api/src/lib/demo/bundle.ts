import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { z } from 'zod';

import { CashInputSchema, type CashInput } from '../cash-evidence/contract.js';
import { parseClaimsCSV } from '../csv/parser.js';
import type { CanonicalClaimRow } from '../csv/types.js';
import { PostingInputSchema, type PostingInput } from '../posting-evidence/contract.js';
import { BatchInputSchema, type BatchInput } from '../remittance-batches/contract.js';
import {
  moneyCents,
  RemittanceInputSchema,
  type RemittanceInput,
} from '../remittances/contract.js';

const filename = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}\.(?:csv|json)$/);
const identity = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,79}$/);
const FileSchema = z.strictObject({
  name: filename,
  kind: z.enum([
    'CLAIMS_CSV',
    'CLAIM_REMITTANCE',
    'REMITTANCE_BATCH',
    'CASH_EVIDENCE',
    'POSTING_EVIDENCE',
    'BATCH_CORRECTION',
  ]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export const DemoManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  scenarioId: z.literal('financial-review-v1'),
  synthetic: z.literal(true),
  sourceSystem: z.literal('OPEN_DENTAL'),
  sourceNamespace: z.literal('synthetic-demo-office'),
  payerNamespace: z.literal('synthetic-demo-payer'),
  files: z.array(FileSchema).min(6).max(7),
  claims: z
    .array(
      z.strictObject({
        sourceClaimId: identity,
        claimNumber: identity,
        remittanceFile: filename,
      }),
    )
    .length(2),
  expected: z.strictObject({
    claimReported: z.literal('180.00'),
    providerAdjustment: z.literal('-30.00'),
    batchNet: z.literal('150.00'),
    cash: z.literal('150.00'),
    postingHeader: z.literal('150.00'),
    postingEntries: z.literal('180.00'),
    postingDifference: z.literal('-30.00'),
    partialMatches: z.tuple([z.literal('100.00'), z.literal('50.00')]),
    correctedBatchNet: z.literal('140.00'),
  }),
});
export type DemoManifest = z.infer<typeof DemoManifestSchema>;
type DemoFileKind = z.infer<typeof FileSchema>['kind'];
export interface DemoBundle {
  readonly manifest: DemoManifest;
  readonly manifestSha256: string;
  /** Transient synthetic parser output; callers must not log raw source cells or demographics. */
  readonly claims: readonly CanonicalClaimRow[];
  readonly remittances: readonly {
    readonly file: string;
    readonly sourceClaimId: string;
    readonly input: RemittanceInput;
  }[];
  readonly batch: BatchInput;
  readonly cash: CashInput;
  readonly posting: PostingInput;
  readonly batchCorrection: BatchInput | null;
}
export type DemoBundleErrorCode =
  | 'DEMO_BUNDLE_DIRECTORY_INVALID'
  | 'DEMO_BUNDLE_FILE_INVALID'
  | 'DEMO_BUNDLE_MANIFEST_INVALID'
  | 'DEMO_BUNDLE_HASH_MISMATCH'
  | 'DEMO_BUNDLE_CONTRACT_INVALID'
  | 'DEMO_BUNDLE_IDENTITY_MISMATCH'
  | 'DEMO_BUNDLE_FINANCIAL_MISMATCH';
export class DemoBundleError extends Error {
  public constructor(public readonly code: DemoBundleErrorCode) {
    super(code);
    this.name = 'DemoBundleError';
  }
}
function requireInvariant(condition: unknown, code: DemoBundleErrorCode): asserts condition {
  if (!condition) throw new DemoBundleError(code);
}
function hash(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
async function readBounded(directory: string, name: string, maxBytes: number): Promise<Buffer> {
  try {
    requireInvariant(filename.safeParse(name).success, 'DEMO_BUNDLE_FILE_INVALID');
    // Names have no path separators; O_NOFOLLOW rejects file symlinks, including swaps after stat.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const file = await open(
      join(directory, name),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    try {
      const stat = await file.stat();
      requireInvariant(
        stat.isFile() && stat.size > 0 && stat.size <= maxBytes,
        'DEMO_BUNDLE_FILE_INVALID',
      );
      const bytes = Buffer.alloc(maxBytes + 1);
      let offset = 0;
      while (offset <= maxBytes) {
        const read = await file.read(bytes, offset, maxBytes + 1 - offset, offset);
        if (!read.bytesRead) break;
        offset += read.bytesRead;
      }
      requireInvariant(offset > 0 && offset <= maxBytes, 'DEMO_BUNDLE_FILE_INVALID');
      return bytes.subarray(0, offset);
    } finally {
      await file.close();
    }
  } catch {
    throw new DemoBundleError('DEMO_BUNDLE_FILE_INVALID');
  }
}
function json(bytes: Uint8Array, code: DemoBundleErrorCode): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new DemoBundleError(code);
  }
}
function contract<T>(schema: z.ZodType<T>, bytes: Uint8Array): T {
  const parsed = schema.safeParse(json(bytes, 'DEMO_BUNDLE_CONTRACT_INVALID'));
  requireInvariant(parsed.success, 'DEMO_BUNDLE_CONTRACT_INVALID');
  return parsed.data;
}
function validateFacts(bundle: DemoBundle): void {
  const { manifest, claims, remittances, batch, cash, posting, batchCorrection } = bundle;
  const identityValid = (condition: unknown): void => {
    requireInvariant(condition, 'DEMO_BUNDLE_IDENTITY_MISMATCH');
  };
  const moneyValid = (condition: unknown): void => {
    requireInvariant(condition, 'DEMO_BUNDLE_FINANCIAL_MISMATCH');
  };
  const sum = (values: readonly string[]): bigint =>
    values.reduce((total, amount) => total + moneyCents(amount), 0n);
  identityValid(
    new Set(manifest.claims.map((claim) => claim.sourceClaimId)).size === 2 &&
      new Set(manifest.claims.map((claim) => claim.claimNumber)).size === 2 &&
      new Set(manifest.claims.map((claim) => claim.remittanceFile)).size === 2,
  );
  for (const [index, expected] of manifest.claims.entries()) {
    const claim = claims.find((row) => row.sourceClaimId === expected.sourceClaimId);
    const remit = remittances.find((row) => row.sourceClaimId === expected.sourceClaimId)?.input;
    requireInvariant(claim && remit, 'DEMO_BUNDLE_IDENTITY_MISMATCH');
    identityValid(
      claim.claimNumber === expected.claimNumber &&
        claim.claimNumber.startsWith('DEMO-') &&
        claim.sourcePatientId?.startsWith('synthetic-demo-patient-') &&
        claim.subscriberId?.startsWith('SYNTHETIC-DEMO-SUBSCRIBER-') &&
        claim.payerCode === 'DELTA_DENTAL_PPO' &&
        claim.sourceVersion &&
        claim.sourceDetails?.lines.length === 1,
    );
    const line = claim.sourceDetails?.lines[0];
    identityValid(
      remit.sourceNamespace === manifest.payerNamespace &&
        remit.kind === 'PAYMENT' &&
        remit.lineDetailCompleteness === 'COMPLETE' &&
        remit.allocations.length === 1 &&
        remit.allocations[0]?.sourceLineId === line?.sourceLineId &&
        remit.sourceCoverageId === null &&
        remit.adjustments.length === 0 &&
        remit.payerName === batch.payerName &&
        remit.payerIdentifier === batch.payerIdentifier &&
        remit.payerIdentifierSystem === batch.payerIdentifierSystem,
    );
    moneyValid(
      claim.claimAmount === (index === 0 ? '200.00' : '160.00') &&
        line?.billedAmount === claim.claimAmount &&
        remit.reportedAmount === (index === 0 ? '100.00' : '80.00'),
    );
  }
  identityValid(new Set(remittances.map((row) => row.input.sourceRecordId)).size === 2);
  const membershipValid = (candidate: BatchInput): boolean =>
    candidate.claimRemittances.length === 2 &&
    candidate.claimRemittances.every((member) =>
      remittances.some(
        ({ input }) =>
          input.sourceNamespace === member.sourceNamespace &&
          input.sourceRecordId === member.sourceRecordId &&
          input.reportedAmount === member.reportedAmount,
      ),
    );
  identityValid(
    batch.schemaVersion === 1 &&
      batch.sourceNamespace === manifest.payerNamespace &&
      batch.detailCompleteness === 'COMPLETE' &&
      membershipValid(batch),
  );
  moneyValid(
    sum(remittances.map((row) => row.input.reportedAmount)) ===
      moneyCents(manifest.expected.claimReported) &&
      batch.reportedClaimAmount === manifest.expected.claimReported &&
      batch.reportedAdjustmentAmount === manifest.expected.providerAdjustment &&
      batch.reportedNetAmount === manifest.expected.batchNet &&
      batch.providerAdjustments.length === 1 &&
      batch.providerAdjustments[0]?.amount === '-30.00' &&
      batch.providerAdjustments[0].sourceAmount === '30.00' &&
      batch.providerAdjustments[0].sourceSignConvention === 'REDUCTION_POSITIVE',
  );
  identityValid(
    cash.status === 'POSTED' &&
      cash.sourceSystem === 'synthetic-bank-export' &&
      cash.sourceNamespace === 'synthetic-demo-bank' &&
      cash.pendingSourceTransactionId === null,
  );
  moneyValid(
    cash.amount === manifest.expected.cash &&
      cash.sourceAmount === '-150.00' &&
      cash.sourceSignConvention === 'DEBIT_POSITIVE' &&
      sum(manifest.expected.partialMatches) === moneyCents(manifest.expected.cash),
  );
  identityValid(
    posting.sourceSystem === manifest.sourceSystem &&
      posting.sourceNamespace === manifest.sourceNamespace &&
      posting.status === 'POSTED' &&
      posting.detailCompleteness === 'COMPLETE' &&
      posting.entries.length === 2,
  );
  const [first, second] = posting.entries;
  const firstClaim = claims.find((row) => row.sourceClaimId === manifest.claims[0]?.sourceClaimId);
  const secondClaim = claims.find((row) => row.sourceClaimId === manifest.claims[1]?.sourceClaimId);
  requireInvariant(first && second && firstClaim && secondClaim, 'DEMO_BUNDLE_IDENTITY_MISMATCH');
  const firstLine = firstClaim.sourceDetails?.lines[0];
  requireInvariant(firstLine, 'DEMO_BUNDLE_IDENTITY_MISMATCH');
  identityValid(
    first.sourceClaimId === firstClaim.sourceClaimId &&
      first.sourceLineId === firstLine.sourceLineId &&
      first.sourceProcedureId === firstLine.sourceProcedureId &&
      first.entryKind === 'PAYMENT' &&
      first.sourceIsTransfer === false &&
      second.sourceClaimId === secondClaim.sourceClaimId &&
      second.sourceLineId === null &&
      second.sourceProcedureId !== null &&
      !(secondClaim.sourceDetails?.lines ?? []).some(
        (line) => line.sourceProcedureId === second.sourceProcedureId,
      ) &&
      second.entryKind === 'TRANSFER' &&
      second.sourceIsTransfer === true,
  );
  moneyValid(
    posting.amount === manifest.expected.postingHeader &&
      first.amount === '100.00' &&
      second.amount === '80.00' &&
      sum(posting.entries.map((entry) => entry.amount ?? '0.00')) ===
        moneyCents(manifest.expected.postingEntries) &&
      moneyCents(manifest.expected.postingHeader) - moneyCents(manifest.expected.postingEntries) ===
        moneyCents(manifest.expected.postingDifference),
  );
  if (batchCorrection) {
    identityValid(
      batchCorrection.schemaVersion === 2 &&
        batchCorrection.sourceSequence === 1 &&
        batchCorrection.sourceNamespace === batch.sourceNamespace &&
        batchCorrection.sourceBatchId === batch.sourceBatchId &&
        batchCorrection.sourceRecordId !== batch.sourceRecordId &&
        batchCorrection.payerName === batch.payerName &&
        batchCorrection.payerIdentifier === batch.payerIdentifier &&
        batchCorrection.payerIdentifierSystem === batch.payerIdentifierSystem &&
        batchCorrection.providerAdjustments[0]?.sourceAdjustmentId ===
          batch.providerAdjustments[0]?.sourceAdjustmentId &&
        batchCorrection.detailCompleteness === 'COMPLETE' &&
        membershipValid(batchCorrection),
    );
    moneyValid(
      batchCorrection.reportedClaimAmount === manifest.expected.claimReported &&
        batchCorrection.reportedNetAmount === manifest.expected.correctedBatchNet &&
        batchCorrection.reportedAdjustmentAmount === '-40.00' &&
        batchCorrection.providerAdjustments.length === 1 &&
        batchCorrection.providerAdjustments[0]?.amount === '-40.00' &&
        batchCorrection.providerAdjustments[0].sourceAmount === '40.00' &&
        batchCorrection.providerAdjustments[0].sourceSignConvention === 'REDUCTION_POSITIVE',
    );
  }
}

/** Verifies local synthetic files only. Does not connect to a database, authenticate or approve evidence. */
export async function verifyDemoBundle(directory: string): Promise<DemoBundle> {
  let root: string;
  try {
    requireInvariant(directory.trim().length > 0, 'DEMO_BUNDLE_DIRECTORY_INVALID');
    const selected = resolve(directory);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caller-selected local directory, never an API input
    const stat = await lstat(selected);
    requireInvariant(stat.isDirectory() && !stat.isSymbolicLink(), 'DEMO_BUNDLE_DIRECTORY_INVALID');
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    root = await realpath(selected);
  } catch {
    throw new DemoBundleError('DEMO_BUNDLE_DIRECTORY_INVALID');
  }
  const manifestBytes = await readBounded(root, 'manifest.json', 16 * 1024);
  const parsed = DemoManifestSchema.safeParse(json(manifestBytes, 'DEMO_BUNDLE_MANIFEST_INVALID'));
  requireInvariant(parsed.success, 'DEMO_BUNDLE_MANIFEST_INVALID');
  const manifest = parsed.data;
  requireInvariant(
    new Set(manifest.files.map((file) => file.name)).size === manifest.files.length &&
      manifest.files.every(
        (file) =>
          file.name !== 'manifest.json' &&
          file.name.endsWith(file.kind === 'CLAIMS_CSV' ? '.csv' : '.json'),
      ),
    'DEMO_BUNDLE_MANIFEST_INVALID',
  );
  const files = new Map<string, Buffer>();
  for (const file of manifest.files) {
    const bytes = await readBounded(
      root,
      file.name,
      file.kind === 'CLAIMS_CSV' ? 64 * 1024 : 256 * 1024,
    );
    requireInvariant(hash(bytes) === file.sha256, 'DEMO_BUNDLE_HASH_MISMATCH');
    files.set(file.name, bytes);
  }
  const one = (kind: DemoFileKind, optional = false): Buffer | null => {
    const entries = manifest.files.filter((file) => file.kind === kind);
    requireInvariant(
      entries.length === 1 || (optional && entries.length === 0),
      'DEMO_BUNDLE_MANIFEST_INVALID',
    );
    return entries[0] ? (files.get(entries[0].name) ?? null) : null;
  };
  const required = (kind: DemoFileKind): Buffer => {
    const bytes = one(kind);
    requireInvariant(bytes !== null, 'DEMO_BUNDLE_MANIFEST_INVALID');
    return bytes;
  };
  const csv = required('CLAIMS_CSV');
  let claims: readonly CanonicalClaimRow[];
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(csv);
    const result = parseClaimsCSV(csv);
    requireInvariant(
      result.source === manifest.sourceSystem && !result.errors.length && result.rows.length === 2,
      'DEMO_BUNDLE_CONTRACT_INVALID',
    );
    claims = result.rows;
  } catch {
    throw new DemoBundleError('DEMO_BUNDLE_CONTRACT_INVALID');
  }
  requireInvariant(
    manifest.files.filter((file) => file.kind === 'CLAIM_REMITTANCE').length === 2,
    'DEMO_BUNDLE_MANIFEST_INVALID',
  );
  const remittances = manifest.claims.map((claim) => {
    requireInvariant(
      manifest.files.some(
        (file) => file.kind === 'CLAIM_REMITTANCE' && file.name === claim.remittanceFile,
      ),
      'DEMO_BUNDLE_MANIFEST_INVALID',
    );
    const bytes = files.get(claim.remittanceFile);
    requireInvariant(bytes !== undefined, 'DEMO_BUNDLE_MANIFEST_INVALID');
    return {
      file: claim.remittanceFile,
      sourceClaimId: claim.sourceClaimId,
      input: contract(RemittanceInputSchema, bytes),
    };
  });
  const correction = one('BATCH_CORRECTION', true);
  const bundle: DemoBundle = {
    manifest,
    manifestSha256: hash(manifestBytes),
    claims,
    remittances,
    batch: contract(BatchInputSchema, required('REMITTANCE_BATCH')),
    cash: contract(CashInputSchema, required('CASH_EVIDENCE')),
    posting: contract(PostingInputSchema, required('POSTING_EVIDENCE')),
    batchCorrection: correction ? contract(BatchInputSchema, correction) : null,
  };
  validateFacts(bundle);
  return bundle;
}
