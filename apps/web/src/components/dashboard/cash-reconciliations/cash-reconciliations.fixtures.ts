import type { CashList } from '../../../lib/cash-evidence/use-cash-evidence.js';
import type {
  CashMatch,
  MatchCandidate,
  MatchList,
  MatchPreview,
  MatchReceipt,
  ReleasePreview,
  ReleaseReceipt,
} from '../../../lib/cash-reconciliations/use-cash-reconciliations.js';
import type { BatchList } from '../../../lib/remittance-batches/use-remittance-batches.js';
import {
  cashEvidenceFixture,
  cashListFixture,
  cashReviewedFixture,
  cashTransactionFixture,
} from '../cash-evidence/cash-evidence.fixtures.js';
import {
  batchEvidenceFixture,
  batchListFixture,
  batchReviewedFixture,
} from '../remittance-batches/remittance-batches.fixtures.js';

const financialState = {
  provenance: 'MANUAL_REVIEW',
  bankVerification: 'UNVERIFIED',
  posting: 'UNVERIFIED',
  settlement: 'UNVERIFIED',
  claimCashAllocation: 'UNALLOCATED',
} as const;
export function reconciliationCashFixture(): CashList {
  const source = cashEvidenceFixture();
  source.payload.amount = '150.00';
  source.payload.sourceAmount = '-150.00';
  const accepted = cashReviewedFixture(source);
  return cashListFixture([
    cashTransactionFixture(accepted, { currentAcceptedEvidence: accepted, freshness: 'CURRENT' }),
  ]);
}
export function reconciliationBatchesFixture(): BatchList {
  const batch = batchEvidenceFixture({ id: '55555555-5555-4555-8555-555555555555' });
  return batchListFixture([batchReviewedFixture(batch)]);
}
export function matchPreviewFixture(overrides: Partial<MatchPreview> = {}): MatchPreview {
  const source = fixtureValue(reconciliationCashFixture().items[0]).latestEvidence;
  const batch = fixtureValue(reconciliationBatchesFixture().items[0]);
  return {
    candidate: { cashEvidenceId: source.id, batchEvidenceId: batch.id, amount: '150.00' },
    cash: {
      transactionId: source.transactionId,
      evidenceId: source.id,
      reviewId: fixtureValue(source.review).id,
      reviewDecision: 'ACCEPT',
      contentHash: source.contentHash,
      sourceSystem: source.payload.sourceSystem,
      sourceProduct: source.payload.sourceProduct,
      sourceNamespace: source.payload.sourceNamespace,
      sourceAccountId: source.payload.sourceAccountId,
      sourceTransactionId: source.payload.sourceTransactionId,
      sourceRecordId: source.payload.sourceRecordId,
      sourceSequence: source.payload.sourceSequence,
      sourceDocumentId: source.payload.sourceDocumentId,
      latestEvidenceId: source.id,
      latestSourceSequence: source.payload.sourceSequence,
      currentAcceptedEvidenceId: source.id,
      status: 'POSTED',
      amount: '150.00',
      sourceAmount: '-150.00',
      sourceSignConvention: 'DEBIT_POSITIVE',
      currency: 'USD',
      postingDate: source.payload.postingDate,
      paymentTrace: source.payload.paymentTrace,
      pendingSourceTransactionId: null,
    },
    batch: {
      evidenceId: batch.id,
      reviewId: fixtureValue(batch.review).id,
      reviewDecision: 'ACCEPT',
      contentHash: batch.contentHash,
      sourceNamespace: batch.payload.sourceNamespace,
      sourceBatchId: batch.payload.sourceBatchId,
      sourceRecordId: batch.payload.sourceRecordId,
      sourceDocumentId: batch.payload.sourceDocumentId,
      payerName: batch.payload.payerName,
      claimReportedAmount: '180.00',
      providerAdjustmentAmount: '-30.00',
      netAmount: '150.00',
      currency: 'USD',
      paymentTrace: batch.payload.paymentTrace,
    },
    capacity: {
      cashReservedMagnitude: '0.00',
      cashAvailableMagnitude: '150.00',
      batchReservedMagnitude: '0.00',
      batchAvailableMagnitude: '150.00',
    },
    blockers: [],
    reviewToken: 'a'.repeat(64),
    ledgerVersion: '0',
    ...financialState,
    ...overrides,
  };
}
export function cashMatchFixture(overrides: Partial<CashMatch> = {}): CashMatch {
  const preview = matchPreviewFixture();
  return {
    id: '66666666-6666-4666-8666-666666666666',
    createdAt: '2026-10-14T12:00:00.000Z',
    reviewedByUserId: 'synthetic-reviewer',
    reviewedByRole: 'BILLING_STAFF',
    amount: '150.00',
    cash: preview.cash,
    batch: preview.batch,
    status: 'CURRENT',
    blockers: [],
    release: null,
    ...financialState,
    ...overrides,
  };
}
export function matchListFixture(items: CashMatch[] = []): MatchList {
  return { items, hasMore: false, nextCursor: null };
}
export function matchReceiptFixture(candidate?: MatchCandidate): MatchReceipt {
  const item = cashMatchFixture();
  return {
    id: item.id,
    createdAt: item.createdAt,
    reviewedByUserId: item.reviewedByUserId,
    reviewedByRole: item.reviewedByRole,
    cashTransactionId: item.cash.transactionId,
    cashEvidenceId: candidate?.cashEvidenceId ?? item.cash.evidenceId,
    cashReviewId: fixtureValue(item.cash.reviewId),
    batchEvidenceId: candidate?.batchEvidenceId ?? item.batch.evidenceId,
    batchReviewId: fixtureValue(item.batch.reviewId),
    amount: candidate?.amount ?? item.amount,
    ...financialState,
  };
}
export function releaseReceiptFixture(
  reason: ReleaseReceipt['reason'] = 'WRONG_MATCH',
): ReleaseReceipt {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    matchId: cashMatchFixture().id,
    createdAt: '2026-10-14T13:00:00.000Z',
    reviewedByUserId: 'synthetic-reviewer',
    reviewedByRole: 'BILLING_STAFF',
    reason,
  };
}
export function releasePreviewFixture(): ReleasePreview {
  return {
    match: matchReceiptFixture(),
    release: null,
    reason: 'WRONG_MATCH',
    canRelease: true,
    reviewToken: 'b'.repeat(64),
    ledgerVersion: '1',
  };
}

function fixtureValue<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) throw new Error('Synthetic fixture is incomplete.');
  return value;
}
