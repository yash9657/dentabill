import type {
  ClaimSourceCoverage,
  ClaimSourceDetails,
  ClaimSourceLine,
  DetailClaim,
} from '../../../lib/claims/types.js';

export function sourceLineFixture(overrides: Partial<ClaimSourceLine> = {}): ClaimSourceLine {
  return {
    id: 'line-one',
    sourceLineId: 'source-line-1',
    sourceProcedureId: 'procedure-1',
    procedureCode: 'D2391',
    codeVersion: '2026',
    serviceDate: '2026-10-01',
    billedAmount: '210.00',
    quantity: null,
    treatmentArea: 'Tooth',
    tooth: '14',
    surface: 'O',
    quadrant: null,
    toothRange: null,
    toothNumberingSystem: 'Universal',
    position: 0,
    ...overrides,
  };
}
export function sourceCoverageFixture(
  overrides: Partial<ClaimSourceCoverage> = {},
): ClaimSourceCoverage {
  return {
    id: 'coverage-one',
    sourceCoverageId: 'source-coverage-1',
    sequence: 1,
    payerName: 'Synthetic primary payer',
    payerIdentifier: 'payer-1',
    payerIdentifierSystem: 'source-carrier',
    isClaimCoverage: false,
    sourcePlanId: 'plan-1',
    sourceSubscriptionId: 'subscription-1',
    subscriberId: null,
    patientMemberId: null,
    groupNumber: null,
    relationship: null,
    effectiveDate: null,
    terminationDate: null,
    ...overrides,
  };
}
export function sourceDetailsFixture(
  overrides: Partial<ClaimSourceDetails> = {},
): ClaimSourceDetails {
  return {
    schemaVersion: 1,
    importedClaimAmount: '420.00',
    sourceSystem: 'OPEN_DENTAL',
    sourceNamespace: 'synthetic-office',
    sourceClaimId: 'source-claim-17',
    sourceVersion: 'export-v2',
    createdAt: '2026-10-02T23:00:00.000Z',
    lines: [
      sourceLineFixture(),
      sourceLineFixture({
        id: 'line-two',
        sourceLineId: 'source-line-2',
        sourceProcedureId: 'procedure-2',
        tooth: '15',
        surface: 'MO',
        quantity: '1.250',
        position: 1,
      }),
    ],
    coverages: [
      sourceCoverageFixture(),
      sourceCoverageFixture({
        id: 'coverage-two',
        sourceCoverageId: 'source-coverage-2',
        sequence: 2,
        payerName: 'Synthetic secondary payer',
        isClaimCoverage: true,
        subscriberId: 'synthetic-subscriber',
        patientMemberId: 'synthetic-member',
        groupNumber: 'synthetic-group',
        relationship: 'Dependent',
        effectiveDate: '2026-01-01',
        terminationDate: '2026-12-31',
      }),
    ],
    ...overrides,
  };
}
export function detailClaimFixture(overrides: Partial<DetailClaim> = {}): DetailClaim {
  return {
    id: 'claim_a',
    organizationId: 'org_a',
    patientDOBHash: 'synthetic-hash',
    patientDOBLast4: '1990',
    claimNumber: 'SYNTHETIC-DETAIL-99',
    cdtCodes: ['D2391'],
    claimAmount: '420.00',
    payerCode: 'CIGNA_DENTAL',
    serviceDate: '2026-10-01T00:00:00.000Z',
    submittedDate: null,
    status: 'PENDING',
    priority: 75,
    retryCount: 0,
    maxRetries: 3,
    createdAt: '2026-10-02T23:00:00.000Z',
    updatedAt: '2026-10-02T23:00:00.000Z',
    sourceDetails: sourceDetailsFixture(),
    ...overrides,
  };
}
