import { z } from 'zod';

import { PostingEntryInputSchema } from '../posting-evidence/contract.js';
import { SignedMoneySchema } from '../remittances/contract.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const actorRole = z.enum(['OWNER', 'ADMIN', 'BILLING_STAFF']);
const identity = z.string().min(1).max(200);
export const RelationshipCandidateSchema = z.strictObject({
  evidenceId: z.uuid(),
  sourceEntryId: identity,
  claimId: identity,
  claimSourceLineId: z.uuid().nullable(),
});
export type RelationshipCandidate = z.infer<typeof RelationshipCandidateSchema>;
export const RelationshipDecisionSchema = RelationshipCandidateSchema.extend({
  reviewToken: hash,
  idempotencyKey: z.uuid(),
});
export type RelationshipDecision = z.infer<typeof RelationshipDecisionSchema>;
export const RelationshipReleaseReasonSchema = z.enum([
  'WRONG_LINK',
  'SOURCE_CHANGED',
  'OTHER_REVIEWED_ERROR',
]);
export const RelationshipReleaseCandidateSchema = z.strictObject({
  reason: RelationshipReleaseReasonSchema,
});
export const RelationshipReleaseDecisionSchema = RelationshipReleaseCandidateSchema.extend({
  reviewToken: hash,
  idempotencyKey: z.uuid(),
});
export type RelationshipReleaseDecision = z.infer<typeof RelationshipReleaseDecisionSchema>;
export const RelationshipBlockerSchema = z.enum([
  'SOURCE_NOT_ACCEPTED',
  'SOURCE_NOT_CURRENT',
  'SOURCE_SYSTEM_UNSUPPORTED',
  'SOURCE_CLAIM_ID_MISSING',
  'CLAIM_SOURCE_IDENTITY_MISMATCH',
  'SOURCE_LINE_ID_MISSING',
  'SOURCE_LINE_NOT_FOUND',
  'SOURCE_PROCEDURE_MISMATCH',
  'ENTRY_ALREADY_LINKED',
  'CLAIM_CHANGED',
]);
export type RelationshipBlocker = z.infer<typeof RelationshipBlockerSchema>;
export const RelationshipSourceSchema = z.strictObject({
  receiptId: z.uuid(),
  evidenceId: z.uuid(),
  reviewId: z.uuid().nullable(),
  reviewDecision: z.enum(['ACCEPT', 'REJECT']).nullable(),
  contentHash: hash,
  sourceSystem: z.string(),
  sourceProduct: z.string(),
  sourceNamespace: z.string(),
  sourceReceiptId: z.string(),
  sourceRecordId: z.string(),
  sourceDocumentId: z.string(),
  sourceSequence: z.number().int().positive(),
  latestEvidenceId: z.uuid(),
  latestSourceSequence: z.number().int().positive(),
  currentAcceptedEvidenceId: z.uuid().nullable(),
  status: z.enum(['POSTED', 'PARTIAL', 'REMOVED', 'UNKNOWN']),
  detailCompleteness: z.enum(['COMPLETE', 'PARTIAL', 'ABSENT']),
  headerAmount: SignedMoneySchema.nullable(),
  headerSourceAmount: SignedMoneySchema.nullable(),
  sourceSignConvention: z.enum(['CREDIT_POSITIVE', 'DEBIT_POSITIVE']),
  entryId: z.uuid().nullable(),
  entry: PostingEntryInputSchema,
});
export type RelationshipSource = z.infer<typeof RelationshipSourceSchema>;
export const RelationshipClaimSchema = z.strictObject({
  id: z.string(),
  claimNumber: z.string(),
  version: z.iso.datetime(),
  sourceSystem: z.string().nullable(),
  sourceNamespace: z.string().nullable(),
  sourceClaimId: z.string().nullable(),
  sourceVersion: z.string().nullable(),
  sourceContentHash: hash.nullable(),
  line: z
    .strictObject({
      id: z.uuid(),
      sourceLineId: z.string(),
      sourceProcedureId: z.string().nullable(),
      procedureCode: z.string(),
      serviceDate: z.string(),
      billedAmount: SignedMoneySchema,
    })
    .nullable(),
});
export type RelationshipClaim = z.infer<typeof RelationshipClaimSchema>;
const financialState = {
  provenance: z.literal('MANUAL_REVIEW'),
  relationshipBasis: z.literal('EXACT_SOURCE_IDENTITY'),
  sourceVerification: z.literal('UNVERIFIED'),
  bankVerification: z.literal('UNVERIFIED'),
  settlement: z.literal('UNVERIFIED'),
  claimCashAllocation: z.literal('UNALLOCATED'),
};
export const RelationshipPreviewSchema = z.strictObject({
  candidate: RelationshipCandidateSchema,
  source: RelationshipSourceSchema,
  claim: RelationshipClaimSchema,
  blockers: z.array(RelationshipBlockerSchema),
  reviewToken: hash,
  ledgerVersion: z.string(),
  ...financialState,
});
export type RelationshipPreview = z.infer<typeof RelationshipPreviewSchema>;
export const RelationshipReceiptSchema = z.strictObject({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  reviewedByUserId: z.string(),
  reviewedByRole: actorRole,
  receiptId: z.uuid(),
  evidenceId: z.uuid(),
  reviewId: z.uuid(),
  entryId: z.uuid(),
  sourceEntryId: z.string(),
  claimId: z.string(),
  claimSourceLineId: z.uuid().nullable(),
  claimVersion: z.iso.datetime(),
  ...financialState,
});
export type RelationshipReceipt = z.infer<typeof RelationshipReceiptSchema>;
export const RelationshipReleaseSchema = z.strictObject({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  reviewedByUserId: z.string(),
  reviewedByRole: actorRole,
  reason: RelationshipReleaseReasonSchema,
});
export const RelationshipReleaseReceiptSchema = RelationshipReleaseSchema.extend({
  relationshipId: z.uuid(),
});
export type RelationshipReleaseReceipt = z.infer<typeof RelationshipReleaseReceiptSchema>;
export const RelationshipSchema = RelationshipReceiptSchema.extend({
  source: RelationshipSourceSchema,
  claim: RelationshipClaimSchema,
  status: z.enum(['CURRENT', 'STALE', 'RELEASED']),
  blockers: z.array(RelationshipBlockerSchema),
  release: RelationshipReleaseSchema.nullable(),
});
export type RelationshipResponse = z.infer<typeof RelationshipSchema>;
export const RelationshipReleasePreviewSchema = z.strictObject({
  relationship: RelationshipReceiptSchema,
  release: RelationshipReleaseSchema.nullable(),
  reason: RelationshipReleaseReasonSchema,
  canRelease: z.boolean(),
  reviewToken: hash,
  ledgerVersion: z.string(),
});
export type RelationshipReleasePreview = z.infer<typeof RelationshipReleasePreviewSchema>;
export const RelationshipListSchema = z.strictObject({
  items: z.array(RelationshipSchema),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
});
export const RelationshipTargetsSchema = z.strictObject({
  evidenceId: z.uuid(),
  items: z
    .array(
      z.strictObject({
        source: RelationshipSourceSchema,
        candidate: RelationshipCandidateSchema.nullable(),
        claim: RelationshipClaimSchema.nullable(),
        blockers: z.array(RelationshipBlockerSchema),
      }),
    )
    .max(100),
  ...financialState,
});
