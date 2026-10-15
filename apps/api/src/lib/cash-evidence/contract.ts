import { z } from 'zod';

import { normaliseDate } from '../csv/normalisers.js';
import { moneyCents, SignedMoneySchema, TotalMoneySchema } from '../remittances/contract.js';

const token = (maximum: number): z.ZodString =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine((value) => value.trim() === value && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value));
const optionalToken = (maximum: number) => token(maximum).nullable().default(null);
const SourceDate = z
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
export const CashStatusSchema = z.enum(['PENDING', 'POSTED', 'REMOVED', 'UNKNOWN']);

/** Bank-account observations only. A PMS deposit or transfer instruction is a different evidence basis. */
export const CashInputSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    evidenceBasis: z.literal('BANK_ACCOUNT_TRANSACTION'),
    sourceSystem: token(80),
    sourceProduct: token(80),
    sourceNamespace: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
    sourceAccountId: token(200),
    sourceTransactionId: token(200),
    sourceRecordId: token(200),
    // Source ordering must come from an ordered source history, never arrival time or opaque version sorting.
    sourceSequence: z.number().int().min(1).max(2_147_483_647),
    sourceVersion: optionalToken(200),
    sourceDocumentId: token(200),
    observedAt: z.iso
      .datetime()
      .max(64)
      .refine((value) => {
        try {
          return normaliseDate(value.slice(0, 10), 'observedAt') === value.slice(0, 10);
        } catch {
          return false;
        }
      }),
    status: CashStatusSchema,
    currency: z.literal('USD'),
    amount: SignedMoneySchema.nullable(),
    sourceAmount: SignedMoneySchema.nullable(),
    sourceSignConvention: z.enum(['CREDIT_POSITIVE', 'DEBIT_POSITIVE']),
    transactionDate: SourceDate,
    postingDate: SourceDate,
    counterpartyName: optionalToken(200),
    paymentTrace: optionalToken(200),
    sourceStatus: optionalToken(80),
    sourceDescription: optionalToken(500),
    pendingSourceTransactionId: optionalToken(200),
  })
  .superRefine((value, context) => {
    const invalid = (): void => {
      context.addIssue({
        code: 'custom',
        message: 'Check source status, amount signs and pending references.',
      });
    };
    if (value.pendingSourceTransactionId === value.sourceTransactionId) invalid();
    if (value.status === 'POSTED' && value.amount === null) invalid();
    if (value.status === 'REMOVED' && (value.amount !== null || value.sourceAmount !== null))
      invalid();
    if ((value.amount === null) !== (value.sourceAmount === null)) invalid();
    if (
      value.amount !== null &&
      value.sourceAmount !== null &&
      SignedMoneySchema.safeParse(value.amount).success &&
      SignedMoneySchema.safeParse(value.sourceAmount).success
    ) {
      const source = moneyCents(value.sourceAmount);
      if (
        moneyCents(value.amount) !==
        (value.sourceSignConvention === 'CREDIT_POSITIVE' ? source : -source)
      )
        invalid();
    }
  });
export type CashInput = z.infer<typeof CashInputSchema>;
export const CashReviewInputSchema = z.strictObject({
  decision: z.enum(['ACCEPT', 'REJECT']),
  reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.uuid(),
});
export type CashReviewInput = z.infer<typeof CashReviewInputSchema>;
export const CashReviewSchema = z.strictObject({
  id: z.uuid(),
  decision: z.enum(['ACCEPT', 'REJECT']),
  createdAt: z.iso.datetime(),
  reviewedByUserId: z.string(),
  reviewedByRole: z.enum(['OWNER', 'ADMIN', 'BILLING_STAFF']),
  previousAcceptedEvidenceId: z.uuid().nullable(),
});
export const CashEvidenceSchema = z.strictObject({
  id: z.uuid(),
  transactionId: z.uuid(),
  createdAt: z.iso.datetime(),
  contentHash: z.string(),
  provenance: z.literal('MANUAL_UPLOAD'),
  bankVerification: z.literal('UNVERIFIED'),
  settlement: z.literal('UNVERIFIED'),
  payload: CashInputSchema,
  review: CashReviewSchema.nullable(),
});
export type CashEvidenceResponse = z.infer<typeof CashEvidenceSchema>;
export const CashTransactionSchema = z.strictObject({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  latestSourceSequence: z.number().int().positive(),
  latestEvidence: CashEvidenceSchema,
  currentAcceptedEvidence: CashEvidenceSchema.nullable(),
  freshness: z.enum(['CURRENT', 'STALE', 'UNREVIEWED']),
});
export type CashTransactionResponse = z.infer<typeof CashTransactionSchema>;
export const CashBlockerSchema = z.enum([
  'ALREADY_REVIEWED',
  'NEWER_SOURCE_EVIDENCE',
  'POSTED_REPLACEMENT_OVERLAP',
  'PENDING_LINK_CHANGED',
  'SOURCE_LINK_LIMIT',
]);
export const CashPreviewSchema = z.strictObject({
  evidence: CashEvidenceSchema,
  currentAcceptedEvidence: CashEvidenceSchema.nullable(),
  latestSourceSequence: z.number().int().positive(),
  reviewToken: z.string(),
  ledgerVersion: z.string(),
  blockers: z.array(CashBlockerSchema),
  priorIncludedAmount: TotalMoneySchema.nullable(),
  nextIncludedAmount: TotalMoneySchema.nullable(),
  bankVerification: z.literal('UNVERIFIED'),
  settlement: z.literal('UNVERIFIED'),
});
export type CashPreviewResponse = z.infer<typeof CashPreviewSchema>;
export const CashAccountSchema = z.strictObject({
  sourceSystem: z.string(),
  sourceProduct: z.string(),
  sourceNamespace: z.string(),
  sourceAccountId: z.string(),
  postedCreditAmount: TotalMoneySchema,
  postedDebitAmount: TotalMoneySchema,
  postedNetAmount: TotalMoneySchema,
  transactionCount: z.number().int().nonnegative(),
  postedCount: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  removedCount: z.number().int().nonnegative(),
  unknownCount: z.number().int().nonnegative(),
  unreviewedCount: z.number().int().nonnegative(),
  staleCount: z.number().int().nonnegative(),
  reviewNeededCount: z.number().int().nonnegative(),
  bankVerification: z.literal('UNVERIFIED'),
  settlement: z.literal('UNVERIFIED'),
});
export type CashAccountResponse = z.infer<typeof CashAccountSchema>;
export const CashListSchema = z.strictObject({
  items: z.array(CashTransactionSchema),
  accounts: z.array(CashAccountSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export const CashHistorySchema = z.strictObject({
  transaction: CashTransactionSchema,
  items: z.array(CashEvidenceSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});
