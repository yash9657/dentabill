import type {
  BatchEvidence,
  BatchList,
  BatchHistory,
  BatchPreview,
} from '../../../lib/remittance-batches/use-remittance-batches.js';

export function batchEvidenceFixture(overrides: Partial<BatchEvidence> = {}): BatchEvidence {
  const evidence: Omit<BatchEvidence, 'revision'> = {
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
  return {
    ...evidence,
    revision: overrides.revision ?? {
      batchId: '99999999-9999-4999-8999-999999999999',
      schemaVersion: evidence.payload.schemaVersion,
      sourceSequence: evidence.payload.schemaVersion === 2 ? evidence.payload.sourceSequence : null,
      latestEvidenceId: evidence.id,
      latestSourceSequence:
        evidence.payload.schemaVersion === 2 ? evidence.payload.sourceSequence : null,
      latestAcceptedEvidenceId: evidence.review?.decision === 'ACCEPT' ? evidence.id : null,
      isLatest: true,
      isCurrentAccepted: evidence.review?.decision === 'ACCEPT',
    },
  };
}
export function batchV2Fixture(sourceSequence = 1): BatchEvidence {
  const baseline = batchEvidenceFixture();
  return batchEvidenceFixture({
    id: '88888888-8888-4888-8888-' + String(sourceSequence).padStart(12, '0'),
    payload: {
      ...baseline.payload,
      schemaVersion: 2,
      sourceSequence,
      sourceRecordId: `synthetic-batch-record-sequence-${String(sourceSequence)}`,
      sourceVersion: `correction-${String(sourceSequence)}`,
      reportedAdjustmentAmount: '-40.00',
      reportedNetAmount: '140.00',
      providerAdjustments: baseline.payload.providerAdjustments.map((item) => ({
        ...item,
        amount: '-40.00',
        sourceAmount: '40.00',
        reasonCode: 'RAW-40',
      })),
    },
  });
}
export function batchHistoryFixture(items: BatchEvidence[]): BatchHistory {
  return {
    batchId: '99999999-9999-4999-8999-999999999999',
    items,
    nextCursor: null,
    hasMore: false,
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
    membershipChanges: {
      previousAcceptedEvidenceId: null,
      ownershipPolicy: 'RETAINED_ACROSS_REVISIONS',
      added: evidence.payload.claimRemittances.map((member, index) => ({
        ...member,
        evidenceId: '22222222-2222-4222-8222-222222222222',
        claimId: `synthetic-claim-${String(index + 1)}`,
      })),
      retained: [],
      omitted: [],
    },
    listedClaimAmount: '180.00',
    listedAdjustmentAmount: evidence.payload.reportedAdjustmentAmount ?? '0.00',
    calculatedNetAmount: evidence.payload.reportedNetAmount ?? '0.00',
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
    revision: {
      ...evidence.revision,
      latestAcceptedEvidenceId:
        decision === 'ACCEPT' ? evidence.id : evidence.revision.latestAcceptedEvidenceId,
      isCurrentAccepted: decision === 'ACCEPT' && evidence.revision.isLatest,
    },
    review: {
      id: '44444444-4444-4444-8444-444444444444',
      decision,
      createdAt: '2026-10-13T14:00:00.000Z',
      reviewedByUserId: 'synthetic-reviewer',
      reviewedByRole: 'BILLING_STAFF',
      claimReportedAmount: decision === 'ACCEPT' ? '180.00' : null,
      providerAdjustmentAmount:
        decision === 'ACCEPT' ? evidence.payload.reportedAdjustmentAmount : null,
      netAmount: decision === 'ACCEPT' ? evidence.payload.reportedNetAmount : null,
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
