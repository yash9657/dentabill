import type {
  CashEvidence,
  CashHistory,
  CashList,
  CashPreview,
  CashTransaction,
} from '../../../lib/cash-evidence/use-cash-evidence.js';

export function cashEvidenceFixture(overrides: Partial<CashEvidence> = {}): CashEvidence {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    transactionId: '22222222-2222-4222-8222-222222222222',
    createdAt: '2026-10-13T13:00:00.000Z',
    contentHash: 'a'.repeat(64),
    provenance: 'MANUAL_UPLOAD',
    bankVerification: 'UNVERIFIED',
    settlement: 'UNVERIFIED',
    review: null,
    payload: {
      schemaVersion: 1,
      evidenceBasis: 'BANK_ACCOUNT_TRANSACTION',
      sourceSystem: 'synthetic-bank',
      sourceProduct: 'transactions',
      sourceNamespace: 'synthetic-office',
      sourceAccountId: 'opaque-account-a',
      sourceTransactionId: 'source-transaction-a',
      sourceRecordId: 'source-record-2',
      sourceSequence: 2,
      sourceVersion: 'v2',
      sourceDocumentId: 'synthetic-document',
      observedAt: '2026-10-13T12:00:00.000Z',
      status: 'POSTED',
      currency: 'USD',
      amount: '100.00',
      sourceAmount: '-100.00',
      sourceSignConvention: 'DEBIT_POSITIVE',
      transactionDate: '2026-10-12',
      postingDate: '2026-10-13',
      counterpartyName: null,
      paymentTrace: null,
      sourceStatus: 'posted-as-supplied',
      sourceDescription: null,
      pendingSourceTransactionId: null,
    },
    ...overrides,
  };
}
export function cashReviewedFixture(
  evidence: CashEvidence,
  decision: 'ACCEPT' | 'REJECT' = 'ACCEPT',
): CashEvidence {
  return {
    ...evidence,
    review: {
      id: '33333333-3333-4333-8333-333333333333',
      decision,
      createdAt: '2026-10-13T14:00:00.000Z',
      reviewedByUserId: 'synthetic-reviewer',
      reviewedByRole: 'BILLING_STAFF',
      previousAcceptedEvidenceId: null,
    },
  };
}
export function cashTransactionFixture(
  evidence = cashEvidenceFixture(),
  overrides: Partial<CashTransaction> = {},
): CashTransaction {
  return {
    id: evidence.transactionId,
    createdAt: evidence.createdAt,
    latestSourceSequence: evidence.payload.sourceSequence,
    latestEvidence: evidence,
    currentAcceptedEvidence: null,
    freshness: 'UNREVIEWED',
    ...overrides,
  };
}
export function cashListFixture(items: CashTransaction[] = []): CashList {
  return {
    items,
    nextCursor: null,
    hasMore: false,
    accounts: items.length
      ? [
          {
            sourceSystem: 'synthetic-bank',
            sourceProduct: 'transactions',
            sourceNamespace: 'synthetic-office',
            sourceAccountId: 'opaque-account-a',
            postedCreditAmount: '0.00',
            postedDebitAmount: '0.00',
            postedNetAmount: '0.00',
            transactionCount: 1,
            postedCount: 0,
            pendingCount: 0,
            removedCount: 0,
            unknownCount: 0,
            unreviewedCount: 1,
            staleCount: 0,
            reviewNeededCount: 1,
            bankVerification: 'UNVERIFIED',
            settlement: 'UNVERIFIED',
          },
        ]
      : [],
  };
}
export function cashHistoryFixture(
  transaction = cashTransactionFixture(),
  items = [transaction.latestEvidence],
): CashHistory {
  return { transaction, items, nextCursor: null, hasMore: false };
}
export function cashPreviewFixture(evidence = cashEvidenceFixture()): CashPreview {
  return {
    evidence,
    currentAcceptedEvidence: null,
    latestSourceSequence: evidence.payload.sourceSequence,
    reviewToken: 'b'.repeat(64),
    ledgerVersion: '0',
    blockers: [],
    priorIncludedAmount: null,
    nextIncludedAmount: evidence.payload.status === 'POSTED' ? evidence.payload.amount : null,
    bankVerification: 'UNVERIFIED',
    settlement: 'UNVERIFIED',
  };
}
