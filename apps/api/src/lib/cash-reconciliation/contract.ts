import { z } from 'zod';

import { SignedMoneySchema, TotalMoneySchema } from '../remittances/contract.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const actorRole = z.enum(['OWNER', 'ADMIN', 'BILLING_STAFF']);
export const MatchCandidateSchema = z.strictObject({
  cashEvidenceId: z.uuid(),
  batchEvidenceId: z.uuid(),
  amount: SignedMoneySchema.refine((value) => value !== '0.00'),
});
export type MatchCandidate = z.infer<typeof MatchCandidateSchema>;
export const MatchDecisionSchema = MatchCandidateSchema.extend({
  reviewToken: hash,
  idempotencyKey: z.uuid(),
});
export type MatchDecision = z.infer<typeof MatchDecisionSchema>;
export const ReleaseReasonSchema = z.enum([
  'WRONG_MATCH',
  'SOURCE_CHANGED',
  'OTHER_REVIEWED_ERROR',
]);
export const ReleaseCandidateSchema = z.strictObject({ reason: ReleaseReasonSchema });
export const ReleaseDecisionSchema = ReleaseCandidateSchema.extend({
  reviewToken: hash,
  idempotencyKey: z.uuid(),
});
export type ReleaseDecision = z.infer<typeof ReleaseDecisionSchema>;
export const MatchBlockerSchema = z.enum([
  'CASH_NOT_ACCEPTED',
  'CASH_NOT_CURRENT',
  'CASH_NOT_POSTED',
  'CASH_ZERO_AMOUNT',
  'BATCH_NOT_ACCEPTED',
  'BATCH_ZERO_NET',
  'DIRECTION_MISMATCH',
  'CASH_CAPACITY_EXCEEDED',
  'BATCH_CAPACITY_EXCEEDED',
  'STALE_CASH_RESERVATION',
  'SOURCE_LINK_LIMIT',
  'CASH_IDENTITY_CONFLICT',
]);
export type MatchBlocker = z.infer<typeof MatchBlockerSchema>;
export const CashBindingSchema = z.strictObject({
  transactionId: z.uuid(),
  evidenceId: z.uuid(),
  reviewId: z.uuid().nullable(),
  reviewDecision: z.enum(['ACCEPT', 'REJECT']).nullable(),
  contentHash: hash,
  sourceSystem: z.string(),
  sourceProduct: z.string(),
  sourceNamespace: z.string(),
  sourceAccountId: z.string(),
  sourceTransactionId: z.string(),
  sourceRecordId: z.string(),
  sourceSequence: z.number().int().positive(),
  sourceDocumentId: z.string(),
  latestEvidenceId: z.uuid(),
  latestSourceSequence: z.number().int().positive(),
  currentAcceptedEvidenceId: z.uuid().nullable(),
  status: z.enum(['PENDING', 'POSTED', 'REMOVED', 'UNKNOWN']),
  amount: SignedMoneySchema.nullable(),
  sourceAmount: SignedMoneySchema.nullable(),
  sourceSignConvention: z.enum(['CREDIT_POSITIVE', 'DEBIT_POSITIVE']),
  currency: z.literal('USD'),
  postingDate: z.string().nullable(),
  paymentTrace: z.string().nullable(),
  pendingSourceTransactionId: z.string().nullable(),
});
export type CashBinding = z.infer<typeof CashBindingSchema>;
export const BatchBindingSchema = z.strictObject({
  evidenceId: z.uuid(),
  reviewId: z.uuid().nullable(),
  reviewDecision: z.enum(['ACCEPT', 'REJECT']).nullable(),
  contentHash: hash,
  sourceNamespace: z.string(),
  sourceBatchId: z.string(),
  sourceRecordId: z.string(),
  sourceDocumentId: z.string(),
  payerName: z.string(),
  claimReportedAmount: SignedMoneySchema.nullable(),
  providerAdjustmentAmount: SignedMoneySchema.nullable(),
  netAmount: SignedMoneySchema.nullable(),
  currency: z.literal('USD'),
  paymentTrace: z.string().nullable(),
});
export type BatchBinding = z.infer<typeof BatchBindingSchema>;
export const CapacitySchema = z.strictObject({
  // Capacities are nonnegative magnitudes. The source and proposed amounts retain their sign.
  cashReservedMagnitude: TotalMoneySchema,
  cashAvailableMagnitude: TotalMoneySchema.nullable(),
  batchReservedMagnitude: TotalMoneySchema,
  batchAvailableMagnitude: TotalMoneySchema.nullable(),
});
const financialState = {
  provenance: z.literal('MANUAL_REVIEW'),
  bankVerification: z.literal('UNVERIFIED'),
  posting: z.literal('UNVERIFIED'),
  settlement: z.literal('UNVERIFIED'),
  claimCashAllocation: z.literal('UNALLOCATED'),
};
export const MatchPreviewSchema = z.strictObject({
  candidate: MatchCandidateSchema,
  cash: CashBindingSchema,
  batch: BatchBindingSchema,
  capacity: CapacitySchema,
  blockers: z.array(MatchBlockerSchema),
  reviewToken: hash,
  ledgerVersion: z.string(),
  ...financialState,
});
export type MatchPreview = z.infer<typeof MatchPreviewSchema>;
export const ReleaseSchema = z.strictObject({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  reviewedByUserId: z.string(),
  reviewedByRole: actorRole,
  reason: ReleaseReasonSchema,
});
export const CashMatchSchema = z.strictObject({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  reviewedByUserId: z.string(),
  reviewedByRole: actorRole,
  amount: SignedMoneySchema,
  cash: CashBindingSchema,
  batch: BatchBindingSchema,
  status: z.enum(['CURRENT', 'STALE', 'RELEASED']),
  blockers: z.array(MatchBlockerSchema),
  release: ReleaseSchema.nullable(),
  ...financialState,
});
export type CashMatchResponse = z.infer<typeof CashMatchSchema>;
// Mutation receipts remain immutable on exact retry; list/preview carries live source currentness.
export const CashMatchReceiptSchema = z.strictObject({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  reviewedByUserId: z.string(),
  reviewedByRole: actorRole,
  cashTransactionId: z.uuid(),
  cashEvidenceId: z.uuid(),
  cashReviewId: z.uuid(),
  batchEvidenceId: z.uuid(),
  batchReviewId: z.uuid(),
  amount: SignedMoneySchema,
  ...financialState,
});
export type CashMatchReceipt = z.infer<typeof CashMatchReceiptSchema>;
export const ReleaseReceiptSchema = ReleaseSchema.extend({ matchId: z.uuid() });
export type ReleaseReceipt = z.infer<typeof ReleaseReceiptSchema>;
export const ReleasePreviewSchema = z.strictObject({
  match: CashMatchReceiptSchema,
  release: ReleaseSchema.nullable(),
  reason: ReleaseReasonSchema,
  canRelease: z.boolean(),
  reviewToken: hash,
  ledgerVersion: z.string(),
});
export type ReleasePreview = z.infer<typeof ReleasePreviewSchema>;
export const CashMatchListSchema = z.strictObject({
  items: z.array(CashMatchSchema),
  hasMore: z.boolean(),
  nextCursor: z.string().nullable(),
});
