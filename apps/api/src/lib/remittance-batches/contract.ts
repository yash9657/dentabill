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
const namespace = token(80).regex(/^[a-z0-9][a-z0-9_-]{0,79}$/);
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

const ClaimMemberSchema = z.strictObject({
  sourceNamespace: namespace,
  sourceRecordId: token(200),
  reportedAmount: SignedMoneySchema,
});
const ProviderAdjustmentSchema = z.strictObject({
  sourceAdjustmentId: token(200),
  codeSystem: token(32),
  reasonCode: token(32),
  sourceReference: optionalToken(200),
  providerIdentifier: optionalToken(200),
  fiscalPeriodEnd: sourceDate,
  amount: SignedMoneySchema,
  sourceAmount: SignedMoneySchema,
  sourceSignConvention: z.enum(['REDUCTION_POSITIVE', 'NET_EFFECT_POSITIVE']),
});

/** Manual source snapshots, not an 835 parser or an external payment instruction. */
export const BatchInputSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    evidenceBasis: z.literal('PAYER_REMITTANCE_BATCH'),
    sourceNamespace: namespace,
    sourceBatchId: token(200),
    sourceRecordId: token(200),
    sourceDocumentId: token(200),
    sourceVersion: optionalToken(200),
    payerName: token(200),
    payerIdentifier: optionalToken(200),
    payerIdentifierSystem: optionalToken(80),
    payeeIdentifier: optionalToken(200),
    payeeIdentifierSystem: optionalToken(80),
    currency: z.literal('USD'),
    paymentTrace: optionalToken(200),
    paymentTraceType: optionalToken(80),
    paymentTraceIssuer: optionalToken(200),
    reportedDate: sourceDate,
    sourceStatus: optionalToken(80),
    detailCompleteness: z.enum(['COMPLETE', 'PARTIAL', 'ABSENT']),
    reportedClaimAmount: SignedMoneySchema.nullable(),
    reportedAdjustmentAmount: SignedMoneySchema.nullable(),
    reportedNetAmount: SignedMoneySchema.nullable(),
    claimRemittances: z.array(ClaimMemberSchema).max(100),
    providerAdjustments: z.array(ProviderAdjustmentSchema).max(100),
  })
  .superRefine((value, context) => {
    const invalid = (): void => {
      context.addIssue({
        code: 'custom',
        message: 'Check unique source references, detail presence and adjustment signs.',
      });
    };
    if (
      new Set(
        value.claimRemittances.map((item) =>
          JSON.stringify([item.sourceNamespace, item.sourceRecordId]),
        ),
      ).size !== value.claimRemittances.length
    )
      invalid();
    if (
      new Set(value.providerAdjustments.map((item) => item.sourceAdjustmentId)).size !==
      value.providerAdjustments.length
    )
      invalid();
    if (
      value.detailCompleteness === 'ABSENT' &&
      (value.claimRemittances.length || value.providerAdjustments.length)
    )
      invalid();
    for (const adjustment of value.providerAdjustments) {
      if (
        !SignedMoneySchema.safeParse(adjustment.amount).success ||
        !SignedMoneySchema.safeParse(adjustment.sourceAmount).success
      )
        continue;
      const source = moneyCents(adjustment.sourceAmount);
      if (
        moneyCents(adjustment.amount) !==
        (adjustment.sourceSignConvention === 'REDUCTION_POSITIVE' ? -source : source)
      )
        invalid();
    }
  });
export type BatchInput = z.infer<typeof BatchInputSchema>;
export const BatchReviewInputSchema = z.strictObject({
  decision: z.enum(['ACCEPT', 'REJECT']),
  reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.uuid(),
});
export type BatchReviewInput = z.infer<typeof BatchReviewInputSchema>;
export const BatchBlockerSchema = z.enum([
  'ALREADY_REVIEWED',
  'INCOMPLETE_DETAIL',
  'UNKNOWN_TOTALS',
  'TOTAL_MISMATCH',
  'MEMBER_MISSING',
  'MEMBER_NOT_ACCEPTED',
  'MEMBER_AMOUNT_MISMATCH',
  'MEMBER_ALREADY_BATCHED',
]);
export type BatchBlocker = z.infer<typeof BatchBlockerSchema>;
export const BatchMemberMatchSchema = z.strictObject({
  sourceNamespace: z.string(),
  sourceRecordId: z.string(),
  reportedAmount: SignedMoneySchema,
  evidenceId: z.uuid().nullable(),
  claimId: z.string().nullable(),
  reviewId: z.uuid().nullable(),
  evidenceHash: z.string().nullable(),
  payerName: z.string().nullable(),
  status: z.enum([
    'MISSING',
    'UNREVIEWED',
    'REJECTED',
    'AMOUNT_MISMATCH',
    'ALREADY_BATCHED',
    'MATCHED',
  ]),
});
export type BatchMemberMatch = z.infer<typeof BatchMemberMatchSchema>;
export const BatchReviewSchema = z.strictObject({
  id: z.uuid(),
  decision: z.enum(['ACCEPT', 'REJECT']),
  createdAt: z.iso.datetime(),
  reviewedByUserId: z.string(),
  reviewedByRole: z.enum(['OWNER', 'ADMIN', 'BILLING_STAFF']),
  claimReportedAmount: TotalMoneySchema.nullable(),
  providerAdjustmentAmount: TotalMoneySchema.nullable(),
  netAmount: TotalMoneySchema.nullable(),
  members: z.array(
    z.strictObject({
      sourceIndex: z.number().int().nonnegative(),
      claimId: z.string(),
      remittanceEvidenceId: z.uuid(),
      remittanceReviewId: z.uuid(),
      amount: SignedMoneySchema,
    }),
  ),
});
export const BatchEvidenceSchema = z.strictObject({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  contentHash: z.string(),
  payload: BatchInputSchema,
  provenance: z.literal('MANUAL_UPLOAD'),
  cashReceipt: z.literal('UNVERIFIED'),
  posting: z.literal('UNVERIFIED'),
  settlement: z.literal('UNVERIFIED'),
  review: BatchReviewSchema.nullable(),
});
export type BatchEvidenceResponse = z.infer<typeof BatchEvidenceSchema>;
export const BatchPreviewSchema = z.strictObject({
  evidence: BatchEvidenceSchema,
  reviewToken: z.string(),
  ledgerVersion: z.string(),
  blockers: z.array(BatchBlockerSchema),
  members: z.array(BatchMemberMatchSchema),
  listedClaimAmount: TotalMoneySchema,
  listedAdjustmentAmount: TotalMoneySchema,
  calculatedNetAmount: TotalMoneySchema,
  cashReceipt: z.literal('UNVERIFIED'),
  posting: z.literal('UNVERIFIED'),
  settlement: z.literal('UNVERIFIED'),
});
export type BatchPreviewResponse = z.infer<typeof BatchPreviewSchema>;
export const BatchListSchema = z.strictObject({
  items: z.array(BatchEvidenceSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

export function batchTotals(payload: BatchInput): {
  listedClaimAmount: string;
  listedAdjustmentAmount: string;
  calculatedNetAmount: string;
  blockers: BatchBlocker[];
} {
  const claims = payload.claimRemittances.reduce(
    (sum, item) => sum + moneyCents(item.reportedAmount),
    0n,
  );
  const adjustments = payload.providerAdjustments.reduce(
    (sum, item) => sum + moneyCents(item.amount),
    0n,
  );
  const blockers: BatchBlocker[] = [];
  if (payload.detailCompleteness !== 'COMPLETE') blockers.push('INCOMPLETE_DETAIL');
  if (
    payload.reportedClaimAmount === null ||
    payload.reportedAdjustmentAmount === null ||
    payload.reportedNetAmount === null
  )
    blockers.push('UNKNOWN_TOTALS');
  else if (
    claims !== moneyCents(payload.reportedClaimAmount) ||
    adjustments !== moneyCents(payload.reportedAdjustmentAmount) ||
    claims + adjustments !== moneyCents(payload.reportedNetAmount)
  )
    blockers.push('TOTAL_MISMATCH');
  return {
    listedClaimAmount: moneyString(claims),
    listedAdjustmentAmount: moneyString(adjustments),
    calculatedNetAmount: moneyString(claims + adjustments),
    blockers,
  };
}
