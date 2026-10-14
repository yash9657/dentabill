import { z } from 'zod';

import { normaliseDate } from '../csv/normalisers.js';
import {
  moneyCents,
  moneyString,
  SignedMoneySchema,
  TotalMoneySchema,
} from '../remittances/contract.js';

const token = (maximum: number): z.ZodString =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim() === value && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value));
const optionalToken = (maximum: number) => token(maximum).nullable().default(null);
const sourceDate = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)
  .refine((value) => {
    try {
      return normaliseDate(value, 'date') === value;
    } catch {
      return false;
    }
  })
  .nullable()
  .default(null);
const signConvention = z.enum(['CREDIT_POSITIVE', 'DEBIT_POSITIVE']);
const moneyPair = {
  amount: SignedMoneySchema.nullable(),
  sourceAmount: SignedMoneySchema.nullable(),
  sourceSignConvention: signConvention,
};
function signsAgree(value: {
  amount: string | null;
  sourceAmount: string | null;
  sourceSignConvention: string;
}): boolean {
  if (value.amount === null || value.sourceAmount === null)
    return value.amount === value.sourceAmount;
  if (
    !SignedMoneySchema.safeParse(value.amount).success ||
    !SignedMoneySchema.safeParse(value.sourceAmount).success
  )
    return false;
  return (
    moneyCents(value.amount) ===
    (value.sourceSignConvention === 'CREDIT_POSITIVE'
      ? moneyCents(value.sourceAmount)
      : -moneyCents(value.sourceAmount))
  );
}
export const PostingEntryInputSchema = z
  .strictObject({
    sourceEntryId: token(200),
    sourceClaimId: optionalToken(200),
    sourceLineId: optionalToken(200),
    sourceProcedureId: optionalToken(200),
    entryKind: z.enum(['PAYMENT', 'TRANSFER', 'ADJUSTMENT', 'UNKNOWN']),
    sourceStatus: optionalToken(80),
    sourceVersion: optionalToken(200),
    sourceIsTransfer: z.boolean().nullable().default(null),
    ...moneyPair,
  })
  .refine(signsAgree, 'Check the entry amount signs.');

/** Independent manual source facts, not a payment instruction or a local claim allocation. */
export const PostingInputSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    evidenceBasis: z.literal('PMS_PAYMENT_RECEIPT'),
    sourceSystem: token(32),
    sourceProduct: token(80),
    sourceNamespace: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
    sourceReceiptId: token(200),
    sourceRecordId: token(200),
    sourceSequence: z.number().int().min(1).max(2_147_483_647),
    sourceVersion: optionalToken(200),
    sourceDocumentId: token(200),
    observedAt: z.iso
      .datetime()
      .max(64)
      .refine((value) => {
        try {
          return normaliseDate(value.slice(0, 10), 'date') === value.slice(0, 10);
        } catch {
          return false;
        }
      }),
    status: z.enum(['POSTED', 'PARTIAL', 'REMOVED', 'UNKNOWN']),
    sourceStatus: optionalToken(80),
    sourceIsPartial: z.boolean().nullable().default(null),
    currency: z.literal('USD'),
    ...moneyPair,
    sourceEntryDate: sourceDate,
    sourceIssuedDate: sourceDate,
    paymentTrace: optionalToken(200),
    sourceDepositId: optionalToken(200),
    detailCompleteness: z.enum(['COMPLETE', 'PARTIAL', 'ABSENT']),
    entries: z.array(PostingEntryInputSchema).max(100),
  })
  .superRefine((value, context) => {
    if (
      !signsAgree(value) ||
      new Set(value.entries.map((entry) => entry.sourceEntryId)).size !== value.entries.length ||
      (value.detailCompleteness === 'ABSENT' && value.entries.length > 0) ||
      (value.status === 'REMOVED' &&
        (value.amount !== null || value.sourceAmount !== null || value.entries.length > 0))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Check source amount signs, unique entry IDs, detail presence and removal facts.',
      });
    }
  });
export type PostingInput = z.infer<typeof PostingInputSchema>;
export const PostingReviewInputSchema = z.strictObject({
  decision: z.enum(['ACCEPT', 'REJECT']),
  reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.uuid(),
});
export type PostingReviewInput = z.infer<typeof PostingReviewInputSchema>;
export const PostingReviewSchema = z.strictObject({
  id: z.uuid(),
  decision: z.enum(['ACCEPT', 'REJECT']),
  createdAt: z.iso.datetime(),
  reviewedByUserId: z.string(),
  reviewedByRole: z.enum(['OWNER', 'ADMIN', 'BILLING_STAFF']),
  previousAcceptedEvidenceId: z.uuid().nullable(),
});
export const PostingTotalsSchema = z.strictObject({
  knownListedEntryAmount: TotalMoneySchema,
  unknownEntryCount: z.number().int().nonnegative(),
  completeEntryAmount: TotalMoneySchema.nullable(),
  headerDifference: TotalMoneySchema.nullable(),
});
export function postingTotals(payload: PostingInput): z.infer<typeof PostingTotalsSchema> {
  const known = payload.entries.reduce(
    (sum, entry) => sum + (entry.amount === null ? 0n : moneyCents(entry.amount)),
    0n,
  );
  const unknown = payload.entries.filter((entry) => entry.amount === null).length;
  const complete =
    payload.detailCompleteness === 'COMPLETE' && unknown === 0 && payload.status !== 'REMOVED';
  return {
    knownListedEntryAmount: moneyString(known),
    unknownEntryCount: unknown,
    completeEntryAmount: complete ? moneyString(known) : null,
    headerDifference:
      complete && payload.amount !== null ? moneyString(moneyCents(payload.amount) - known) : null,
  };
}
const financialState = {
  provenance: z.literal('MANUAL_UPLOAD'),
  sourceVerification: z.literal('UNVERIFIED'),
  claimLinkage: z.literal('UNLINKED'),
  bankVerification: z.literal('UNVERIFIED'),
  settlement: z.literal('UNVERIFIED'),
};
export const PostingEvidenceSchema = z.strictObject({
  id: z.uuid(),
  receiptId: z.uuid(),
  createdAt: z.iso.datetime(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  payload: PostingInputSchema,
  review: PostingReviewSchema.nullable(),
  totals: PostingTotalsSchema,
  ...financialState,
});
export type PostingEvidenceResponse = z.infer<typeof PostingEvidenceSchema>;
export const PostingReceiptSchema = z.strictObject({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  latestSourceSequence: z.number().int().positive(),
  latestEvidence: PostingEvidenceSchema,
  currentAcceptedEvidence: PostingEvidenceSchema.nullable(),
  freshness: z.enum(['CURRENT', 'STALE', 'UNREVIEWED']),
});
export type PostingReceiptResponse = z.infer<typeof PostingReceiptSchema>;
export const PostingBlockerSchema = z.enum([
  'ALREADY_REVIEWED',
  'NEWER_SOURCE_EVIDENCE',
  'SOURCE_ENTRY_OVERLAP',
]);
export const PostingPreviewSchema = z.strictObject({
  evidence: PostingEvidenceSchema,
  currentAcceptedEvidence: PostingEvidenceSchema.nullable(),
  latestSourceSequence: z.number().int().positive(),
  reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
  ledgerVersion: z.string(),
  blockers: z.array(PostingBlockerSchema),
  ...financialState,
});
export type PostingPreviewResponse = z.infer<typeof PostingPreviewSchema>;
export const PostingListSchema = z.strictObject({
  items: z.array(PostingReceiptSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export const PostingHistorySchema = z.strictObject({
  receipt: PostingReceiptSchema,
  items: z.array(PostingEvidenceSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
