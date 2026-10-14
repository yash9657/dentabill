import type { PostingEvidence } from '../../../lib/posting-evidence/use-posting-evidence.js';
import type {
  PostingRelationship,
  RelationshipCandidate,
  RelationshipList,
  RelationshipPreview,
  RelationshipReceipt,
  RelationshipReleasePreview,
  RelationshipReleaseReceipt,
  RelationshipTargets,
} from '../../../lib/posting-evidence/use-posting-relationships.js';

import { postingEvidenceFixture, postingReviewedFixture } from './posting-evidence.fixtures.js';

export const relationshipFinancialState = {
  provenance: 'MANUAL_REVIEW',
  relationshipBasis: 'EXACT_SOURCE_IDENTITY',
  sourceVerification: 'UNVERIFIED',
  bankVerification: 'UNVERIFIED',
  settlement: 'UNVERIFIED',
  claimCashAllocation: 'UNALLOCATED',
} as const;

export function relationshipEvidenceFixture(): PostingEvidence {
  const evidence = postingEvidenceFixture();
  evidence.payload.sourceSystem = 'OPEN_DENTAL';
  return postingReviewedFixture(evidence);
}

export function relationshipSourceFixture(): RelationshipPreview['source'] {
  const e = relationshipEvidenceFixture();
  const p = e.payload;
  const entry = p.entries[0];
  if (!e.review || !entry) throw new Error('Expected accepted synthetic entry');
  return {
    receiptId: e.receiptId,
    evidenceId: e.id,
    reviewId: e.review.id,
    reviewDecision: 'ACCEPT',
    contentHash: e.contentHash,
    sourceSystem: p.sourceSystem,
    sourceProduct: p.sourceProduct,
    sourceNamespace: p.sourceNamespace,
    sourceReceiptId: p.sourceReceiptId,
    sourceRecordId: p.sourceRecordId,
    sourceDocumentId: p.sourceDocumentId,
    sourceSequence: p.sourceSequence,
    latestEvidenceId: e.id,
    latestSourceSequence: p.sourceSequence,
    currentAcceptedEvidenceId: e.id,
    status: p.status,
    detailCompleteness: p.detailCompleteness,
    headerAmount: p.amount,
    headerSourceAmount: p.sourceAmount,
    sourceSignConvention: p.sourceSignConvention,
    entryId: '44444444-4444-4444-8444-444444444444',
    entry,
  };
}

export function relationshipClaimFixture(): RelationshipPreview['claim'] {
  return {
    id: 'fake-local-claim-a',
    claimNumber: 'FAKE-CLAIM-100',
    version: '2026-10-14T13:00:00.000Z',
    sourceSystem: 'OPEN_DENTAL',
    sourceNamespace: 'synthetic-office',
    sourceClaimId: 'fake-source-claim-a',
    sourceVersion: 'claim-v1',
    sourceContentHash: 'e'.repeat(64),
    line: {
      id: '55555555-5555-4555-8555-555555555555',
      sourceLineId: 'fake-source-line-a',
      sourceProcedureId: 'fake-source-procedure-a',
      procedureCode: 'D0120',
      serviceDate: '2026-10-01',
      billedAmount: '125.00',
    },
  };
}

export function relationshipCandidateFixture(): RelationshipCandidate {
  const source = relationshipSourceFixture();
  const claim = relationshipClaimFixture();
  if (!claim.line) throw new Error('Expected synthetic line');
  return {
    evidenceId: source.evidenceId,
    sourceEntryId: source.entry.sourceEntryId,
    claimId: claim.id,
    claimSourceLineId: claim.line.id,
  };
}

export function relationshipTargetsFixture(): RelationshipTargets {
  return {
    evidenceId: relationshipSourceFixture().evidenceId,
    items: [
      {
        source: relationshipSourceFixture(),
        candidate: relationshipCandidateFixture(),
        claim: relationshipClaimFixture(),
        blockers: [],
      },
    ],
    ...relationshipFinancialState,
  };
}

export function relationshipPreviewFixture(
  overrides: Partial<RelationshipPreview> = {},
): RelationshipPreview {
  return {
    candidate: relationshipCandidateFixture(),
    source: relationshipSourceFixture(),
    claim: relationshipClaimFixture(),
    blockers: [],
    reviewToken: 'a'.repeat(64),
    ledgerVersion: '1',
    ...relationshipFinancialState,
    ...overrides,
  };
}

export function relationshipReceiptFixture(): RelationshipReceipt {
  const source = relationshipSourceFixture();
  const claim = relationshipClaimFixture();
  if (!claim.line) throw new Error('Expected synthetic line');
  return {
    id: '66666666-6666-4666-8666-666666666666',
    createdAt: '2026-10-14T14:00:00.000Z',
    reviewedByUserId: 'fake-user',
    reviewedByRole: 'BILLING_STAFF',
    receiptId: source.receiptId,
    evidenceId: source.evidenceId,
    reviewId: source.reviewId ?? '33333333-3333-4333-8333-333333333333',
    entryId: source.entryId ?? '44444444-4444-4444-8444-444444444444',
    sourceEntryId: source.entry.sourceEntryId,
    claimId: claim.id,
    claimSourceLineId: claim.line.id,
    claimVersion: claim.version,
    ...relationshipFinancialState,
  };
}

export function relationshipFixture(
  overrides: Partial<PostingRelationship> = {},
): PostingRelationship {
  return {
    ...relationshipReceiptFixture(),
    source: relationshipSourceFixture(),
    claim: relationshipClaimFixture(),
    status: 'CURRENT',
    blockers: [],
    release: null,
    ...overrides,
  };
}

export function relationshipListFixture(items: PostingRelationship[] = []): RelationshipList {
  return { items, hasMore: false, nextCursor: null };
}

export function relationshipReleaseFixture(): RelationshipReleaseReceipt {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    createdAt: '2026-10-14T15:00:00.000Z',
    reviewedByUserId: 'fake-user',
    reviewedByRole: 'BILLING_STAFF',
    reason: 'SOURCE_CHANGED',
    relationshipId: relationshipReceiptFixture().id,
  };
}

export function relationshipReleasePreviewFixture(
  overrides: Partial<RelationshipReleasePreview> = {},
): RelationshipReleasePreview {
  return {
    relationship: relationshipReceiptFixture(),
    reason: 'SOURCE_CHANGED',
    release: null,
    canRelease: true,
    reviewToken: 'b'.repeat(64),
    ledgerVersion: '2',
    ...overrides,
  };
}
