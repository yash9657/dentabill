import type {
  PostingEvidence,
  PostingHistory,
  PostingList,
  PostingPreview,
  PostingReceipt,
} from '../../../lib/posting-evidence/use-posting-evidence.js';

export function postingEvidenceFixture(overrides: Partial<PostingEvidence> = {}): PostingEvidence {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    receiptId: '22222222-2222-4222-8222-222222222222',
    createdAt: '2026-10-14T12:00:00.000Z',
    contentHash: 'a'.repeat(64),
    provenance: 'MANUAL_UPLOAD',
    sourceVerification: 'UNVERIFIED',
    claimLinkage: 'UNLINKED',
    bankVerification: 'UNVERIFIED',
    settlement: 'UNVERIFIED',
    review: null,
    payload: {
      schemaVersion: 1,
      evidenceBasis: 'PMS_PAYMENT_RECEIPT',
      sourceSystem: 'synthetic-pms',
      sourceProduct: 'receipt-export',
      sourceNamespace: 'synthetic-office',
      sourceReceiptId: 'fake-receipt-a',
      sourceRecordId: 'fake-receipt-record-2',
      sourceSequence: 2,
      sourceVersion: 'v2',
      sourceDocumentId: 'fake-document',
      observedAt: '2026-10-14T11:00:00.000Z',
      status: 'POSTED',
      sourceStatus: 'posted-as-supplied',
      sourceIsPartial: false,
      currency: 'USD',
      amount: '150.00',
      sourceAmount: '-150.00',
      sourceSignConvention: 'DEBIT_POSITIVE',
      sourceEntryDate: '2026-10-12',
      sourceIssuedDate: '2026-10-13',
      paymentTrace: 'fake-trace',
      sourceDepositId: 'fake-deposit',
      detailCompleteness: 'COMPLETE',
      entries: [
        {
          sourceEntryId: 'fake-payment-entry',
          sourceClaimId: 'fake-source-claim-a',
          sourceLineId: 'fake-source-line-a',
          sourceProcedureId: 'fake-source-procedure-a',
          entryKind: 'PAYMENT',
          sourceStatus: 'payment-as-supplied',
          sourceVersion: 'entry-v3',
          sourceIsTransfer: false,
          amount: '100.00',
          sourceAmount: '-100.00',
          sourceSignConvention: 'DEBIT_POSITIVE',
        },
        {
          sourceEntryId: 'fake-transfer-entry',
          sourceClaimId: 'fake-source-claim-b',
          sourceLineId: null,
          sourceProcedureId: null,
          entryKind: 'TRANSFER',
          sourceStatus: 'transfer-as-supplied',
          sourceVersion: 'entry-v1',
          sourceIsTransfer: true,
          amount: '80.00',
          sourceAmount: '80.00',
          sourceSignConvention: 'CREDIT_POSITIVE',
        },
        {
          sourceEntryId: 'fake-adjustment-entry',
          sourceClaimId: null,
          sourceLineId: null,
          sourceProcedureId: null,
          entryKind: 'ADJUSTMENT',
          sourceStatus: null,
          sourceVersion: null,
          sourceIsTransfer: null,
          amount: '-30.00',
          sourceAmount: '-30.00',
          sourceSignConvention: 'CREDIT_POSITIVE',
        },
      ],
    },
    totals: {
      knownListedEntryAmount: '150.00',
      unknownEntryCount: 0,
      completeEntryAmount: '150.00',
      headerDifference: '0.00',
    },
    ...overrides,
  };
}
export function postingReviewedFixture(
  evidence: PostingEvidence,
  decision: 'ACCEPT' | 'REJECT' = 'ACCEPT',
): PostingEvidence {
  return {
    ...evidence,
    review: {
      id: '33333333-3333-4333-8333-333333333333',
      decision,
      createdAt: '2026-10-14T13:00:00.000Z',
      reviewedByUserId: 'synthetic-reviewer',
      reviewedByRole: 'BILLING_STAFF',
      previousAcceptedEvidenceId: null,
    },
  };
}
export function postingReceiptFixture(
  evidence = postingEvidenceFixture(),
  overrides: Partial<PostingReceipt> = {},
): PostingReceipt {
  return {
    id: evidence.receiptId,
    createdAt: evidence.createdAt,
    latestSourceSequence: evidence.payload.sourceSequence,
    latestEvidence: evidence,
    currentAcceptedEvidence: null,
    freshness: 'UNREVIEWED',
    ...overrides,
  };
}
export function postingListFixture(items: PostingReceipt[] = []): PostingList {
  return { items, nextCursor: null, hasMore: false };
}
export function postingHistoryFixture(
  receipt = postingReceiptFixture(),
  items = [receipt.latestEvidence],
): PostingHistory {
  return { receipt, items, nextCursor: null, hasMore: false };
}
export function postingPreviewFixture(evidence = postingEvidenceFixture()): PostingPreview {
  return {
    evidence,
    currentAcceptedEvidence: null,
    latestSourceSequence: evidence.payload.sourceSequence,
    reviewToken: 'b'.repeat(64),
    ledgerVersion: '0',
    blockers: [],
    provenance: 'MANUAL_UPLOAD',
    sourceVerification: 'UNVERIFIED',
    claimLinkage: 'UNLINKED',
    bankVerification: 'UNVERIFIED',
    settlement: 'UNVERIFIED',
  };
}
