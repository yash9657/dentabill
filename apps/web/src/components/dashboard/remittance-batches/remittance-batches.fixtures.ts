import type {
  BatchEvidence,
  BatchList,
  BatchPreview,
} from '../../../lib/remittance-batches/use-remittance-batches.js';

export function batchEvidenceFixture(overrides: Partial<BatchEvidence> = {}): BatchEvidence {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-10-13T13:00:00.000Z',
    contentHash: 'a'.repeat(64),
    provenance: 'MANUAL_UPLOAD',
    cashReceipt: 'UNVERIFIED',
    posting: 'UNVERIFIED',
    settlement: 'UNVERIFIED',
    review: null,
    payload: {
      schemaVersion: 1,
      evidenceBasis: 'PAYER_REMITTANCE_BATCH',
      sourceNamespace: 'synthetic-payer',
      sourceBatchId: 'synthetic-batch-a',
      sourceRecordId: 'synthetic-batch-record',
      sourceDocumentId: 'synthetic-document',
      sourceVersion: 'v1',
      payerName: 'Synthetic Payer',
      payerIdentifier: 'fake-payer',
      payerIdentifierSystem: 'synthetic',
      payeeIdentifier: 'fake-practice',
      payeeIdentifierSystem: 'synthetic',
      currency: 'USD',
      paymentTrace: 'fake-trace',
      paymentTraceType: 'synthetic-trace',
      paymentTraceIssuer: 'Synthetic Payer',
      reportedDate: '2026-10-13',
      sourceStatus: 'source-status-as-supplied',
      detailCompleteness: 'COMPLETE',
      reportedClaimAmount: '180.00',
      reportedAdjustmentAmount: '-30.00',
      reportedNetAmount: '150.00',
      claimRemittances: [
        {
          sourceNamespace: 'synthetic-payer',
          sourceRecordId: 'synthetic-claim-remittance-a',
          reportedAmount: '100.00',
        },
        {
          sourceNamespace: 'synthetic-payer',
          sourceRecordId: 'synthetic-claim-remittance-b',
          reportedAmount: '80.00',
        },
      ],
      providerAdjustments: [
        {
          sourceAdjustmentId: 'synthetic-adjustment',
          codeSystem: 'RAW-SYNTHETIC',
          reasonCode: 'RAW-30',
          sourceReference: 'fake-adjustment-reference',
          providerIdentifier: 'fake-provider',
          fiscalPeriodEnd: '2026-09-30',
          amount: '-30.00',
          sourceAmount: '30.00',
          sourceSignConvention: 'REDUCTION_POSITIVE',
        },
      ],
    },
    ...overrides,
  };
}
export function batchListFixture(items: BatchEvidence[] = []): BatchList {
  return { items, nextCursor: null, hasMore: false };
}
export function batchPreviewFixture(evidence = batchEvidenceFixture()): BatchPreview {
  return {
    evidence,
    reviewToken: 'b'.repeat(64),
    ledgerVersion: '0',
    blockers: [],
    listedClaimAmount: '180.00',
    listedAdjustmentAmount: '-30.00',
    calculatedNetAmount: '150.00',
    cashReceipt: 'UNVERIFIED',
    posting: 'UNVERIFIED',
    settlement: 'UNVERIFIED',
    members: evidence.payload.claimRemittances.map((item, index) => ({
      ...item,
      evidenceId: '22222222-2222-4222-8222-222222222222',
      claimId: `synthetic-claim-${String(index + 1)}`,
      reviewId: '33333333-3333-4333-8333-333333333333',
      evidenceHash: 'c'.repeat(64),
      payerName: 'Synthetic Payer',
      status: 'MATCHED',
    })),
  };
}
export function batchReviewedFixture(
  evidence: BatchEvidence,
  decision: 'ACCEPT' | 'REJECT' = 'ACCEPT',
): BatchEvidence {
  return {
    ...evidence,
    review: {
      id: '44444444-4444-4444-8444-444444444444',
      decision,
      createdAt: '2026-10-13T14:00:00.000Z',
      reviewedByUserId: 'synthetic-reviewer',
      reviewedByRole: 'BILLING_STAFF',
      claimReportedAmount: decision === 'ACCEPT' ? '180.00' : null,
      providerAdjustmentAmount: decision === 'ACCEPT' ? '-30.00' : null,
      netAmount: decision === 'ACCEPT' ? '150.00' : null,
      members:
        decision === 'ACCEPT'
          ? evidence.payload.claimRemittances.map((item, index) => ({
              sourceIndex: index,
              claimId: `synthetic-claim-${String(index + 1)}`,
              remittanceEvidenceId: '22222222-2222-4222-8222-222222222222',
              remittanceReviewId: '33333333-3333-4333-8333-333333333333',
              amount: item.reportedAmount,
            }))
          : [],
    },
  };
}
