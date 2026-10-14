import type {
  RemittanceEvidence,
  RemittanceList,
  RemittancePreview,
} from '../../../lib/claims/use-remittances.js';

export function remittanceFixture(overrides: Partial<RemittanceEvidence> = {}): RemittanceEvidence {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    claimId: 'claim_a',
    createdAt: '2026-10-13T12:00:00.000Z',
    contentHash: 'a'.repeat(64),
    review: null,
    payload: {
      schemaVersion: 1,
      sourceNamespace: 'synthetic-remittance',
      sourceRecordId: 'report-1',
      sourceDocumentId: 'document-1',
      sourceVersion: null,
      kind: 'PAYMENT',
      reversesSourceRecordId: null,
      currency: 'USD',
      reportedAmount: '75.00',
      payerName: 'Synthetic payer',
      payerIdentifier: null,
      payerIdentifierSystem: null,
      payerClaimControlNumber: null,
      sourceCoverageId: 'secondary-source-coverage',
      paymentTrace: 'synthetic-trace',
      paymentTraceType: 'source-type',
      paymentTraceIssuer: null,
      reportedDate: '2026-10-12',
      sourceStatus: 'PARTIAL AS REPORTED',
      lineDetailCompleteness: 'PARTIAL',
      allocations: [
        { sourceLineId: 'source-line-1', amount: '25.00', sourceStatus: 'source-status' },
        { sourceLineId: 'source-line-2', amount: '15.00', sourceStatus: null },
      ],
      adjustments: [
        {
          sourceAdjustmentId: 'adjustment-1',
          sourceLineId: 'source-line-1',
          codeSystem: 'UNKNOWN',
          groupCode: 'ZZ',
          reasonCode: 'raw-code-9',
          amount: '-5.00',
          sourceReference: null,
        },
      ],
    },
    ...overrides,
  };
}
export function remittanceListFixture(items: RemittanceEvidence[] = []): RemittanceList {
  return {
    items,
    nextCursor: null,
    hasMore: false,
    summary: {
      reviewedReportedAmount: '0.00',
      allocatedAmount: '0.00',
      unallocatedAmount: '0.00',
      pendingCount: items.filter((item) => !item.review).length,
      acceptedCount: 0,
      rejectedCount: 0,
      cashReceipt: 'UNVERIFIED',
      posting: 'UNVERIFIED',
      settlement: 'UNVERIFIED',
      lines: [],
    },
  };
}
export function remittancePreviewFixture(evidence = remittanceFixture()): RemittancePreview {
  return {
    evidence,
    reviewToken: 'b'.repeat(64),
    ledgerVersion: '0',
    claimUpdatedAt: '2026-10-13T00:00:00.000Z',
    blockers: [],
    unallocatedAmount: '35.00',
    originalEvidenceId: null,
    remainingOriginalAmount: null,
    allocations: [
      {
        sourceLineId: 'source-line-1',
        lineId: '22222222-2222-4222-8222-222222222222',
        procedureCode: 'D2391',
        tooth: '14',
        amount: '25.00',
      },
      {
        sourceLineId: 'source-line-2',
        lineId: '33333333-3333-4333-8333-333333333333',
        procedureCode: 'D2391',
        tooth: '15',
        amount: '15.00',
      },
    ],
  };
}
export function reviewedRemittanceFixture(
  evidence: RemittanceEvidence,
  decision: 'ACCEPT' | 'REJECT',
): RemittanceEvidence {
  return {
    ...evidence,
    review: {
      id: '44444444-4444-4444-8444-444444444444',
      decision,
      createdAt: '2026-10-13T12:01:00.000Z',
      reviewedByUserId: 'synthetic-reviewer',
      reportedAmount: evidence.payload.reportedAmount,
      reversedEvidenceId: null,
    },
  };
}
