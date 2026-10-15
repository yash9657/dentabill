import { z } from 'zod';

import { normaliseDate } from '../csv/normalisers.js';

const token = (max: number): z.ZodString =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim() === value && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value));
const optionalToken = (max: number) => token(max).nullable().default(null);
export const SignedMoneySchema = z
  .string()
  .max(13)
  .regex(/^-?(?:0|[1-9][0-9]{0,7})\.[0-9]{2}$/)
  .refine((value) => value !== '-0.00');
export const TotalMoneySchema = z.string().regex(/^-?[0-9]+\.[0-9]{2}$/);
const DateSchema = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)
  .refine((value) => {
    try {
      return normaliseDate(value, 'date') === value;
    } catch {
      return false;
    }
  });

export function moneyCents(value: string): bigint {
  return BigInt(value.replace('.', ''));
}
export function moneyString(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? '-' : ''}${String(absolute / 100n)}.${String(absolute % 100n).padStart(2, '0')}`;
}
export function magnitude(value: bigint): bigint {
  return value < 0n ? -value : value;
}

const AllocationSchema = z.strictObject({
  sourceLineId: token(200),
  amount: SignedMoneySchema,
  sourceStatus: optionalToken(80),
});
const AdjustmentSchema = z.strictObject({
  sourceAdjustmentId: token(200),
  sourceLineId: optionalToken(200),
  codeSystem: token(32),
  groupCode: optionalToken(32),
  reasonCode: token(32),
  amount: SignedMoneySchema,
  sourceReference: optionalToken(200),
});

/** Custom claim-level evidence contract, not native 835 or bank evidence. */
export const RemittanceInputSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    sourceNamespace: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
    sourceRecordId: token(200),
    sourceDocumentId: token(200),
    sourceVersion: optionalToken(200),
    kind: z.enum(['PAYMENT', 'REVERSAL']),
    reversesSourceRecordId: optionalToken(200),
    currency: z.literal('USD'),
    reportedAmount: SignedMoneySchema,
    payerName: token(200),
    payerIdentifier: optionalToken(200),
    payerIdentifierSystem: optionalToken(80),
    payerClaimControlNumber: optionalToken(200),
    sourceCoverageId: optionalToken(200),
    paymentTrace: optionalToken(200),
    paymentTraceType: optionalToken(80),
    paymentTraceIssuer: optionalToken(200),
    reportedDate: DateSchema.nullable().default(null),
    sourceStatus: optionalToken(80),
    lineDetailCompleteness: z.enum(['COMPLETE', 'PARTIAL', 'ABSENT']),
    allocations: z.array(AllocationSchema).max(500),
    adjustments: z.array(AdjustmentSchema).max(500),
  })
  .superRefine((value, ctx) => {
    const invalid = (message: string): void => {
      ctx.addIssue({ code: 'custom', message });
    };
    if (
      ![
        value.reportedAmount,
        ...value.allocations.map((item) => item.amount),
        ...value.adjustments.map((item) => item.amount),
      ].every((amount) => SignedMoneySchema.safeParse(amount).success)
    )
      return;
    const amount = moneyCents(value.reportedAmount);
    const sum = value.allocations.reduce((total, item) => total + moneyCents(item.amount), 0n);
    if (
      value.kind === 'PAYMENT'
        ? amount < 0n || value.reversesSourceRecordId !== null
        : amount > 0n ||
          !value.reversesSourceRecordId ||
          value.reversesSourceRecordId === value.sourceRecordId
    )
      invalid('Payment/reversal direction and reference must agree.');
    if (
      value.allocations.some((item) =>
        value.kind === 'PAYMENT' ? moneyCents(item.amount) < 0n : moneyCents(item.amount) > 0n,
      ) ||
      magnitude(sum) > magnitude(amount)
    )
      invalid('Line amounts must decompose the claim reported amount.');
    if (value.lineDetailCompleteness === 'COMPLETE' && sum !== amount)
      invalid('Complete line detail must account for the full reported amount.');
    if (value.lineDetailCompleteness === 'ABSENT' && value.allocations.length)
      invalid('Absent line detail cannot contain procedure allocations.');
    if (
      new Set(value.allocations.map((item) => item.sourceLineId)).size !== value.allocations.length
    )
      invalid('Source line IDs must be unique within this evidence record.');
    if (
      new Set(value.adjustments.map((item) => item.sourceAdjustmentId)).size !==
      value.adjustments.length
    )
      invalid('Source adjustment IDs must be unique within this evidence record.');
  });
export type RemittanceInput = z.infer<typeof RemittanceInputSchema>;

export const ReviewInputSchema = z.strictObject({
  decision: z.enum(['ACCEPT', 'REJECT']),
  reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.uuid(),
});
export type ReviewInput = z.infer<typeof ReviewInputSchema>;
export const BlockerSchema = z.enum([
  'ALREADY_REVIEWED',
  'SOURCE_LINE_MISSING',
  'SOURCE_COVERAGE_MISSING',
  'ORIGINAL_MISSING',
  'ORIGINAL_NOT_ACCEPTED',
  'REVERSAL_TARGET_MISMATCH',
  'REVERSAL_EXCEEDS_REMAINING',
  'REVERSAL_ADJUSTMENT_MISMATCH',
]);
export type RemittanceBlocker = z.infer<typeof BlockerSchema>;
export const ReviewResponseSchema = z.strictObject({
  id: z.uuid(),
  decision: z.enum(['ACCEPT', 'REJECT']),
  createdAt: z.iso.datetime(),
  reviewedByUserId: z.string(),
  reportedAmount: TotalMoneySchema,
  reversedEvidenceId: z.uuid().nullable(),
});
export const EvidenceResponseSchema = z.strictObject({
  id: z.uuid(),
  claimId: z.string(),
  createdAt: z.iso.datetime(),
  contentHash: z.string(),
  payload: RemittanceInputSchema,
  review: ReviewResponseSchema.nullable(),
});
export const PreviewResponseSchema = z.strictObject({
  evidence: EvidenceResponseSchema,
  reviewToken: z.string(),
  ledgerVersion: z.string(),
  claimUpdatedAt: z.iso.datetime(),
  blockers: z.array(BlockerSchema),
  unallocatedAmount: TotalMoneySchema,
  originalEvidenceId: z.uuid().nullable(),
  remainingOriginalAmount: TotalMoneySchema.nullable(),
  allocations: z.array(
    z.strictObject({
      sourceLineId: z.string(),
      lineId: z.uuid().nullable(),
      procedureCode: z.string().nullable(),
      tooth: z.string().nullable(),
      amount: SignedMoneySchema,
    }),
  ),
});
export const ListResponseSchema = z.strictObject({
  items: z.array(EvidenceResponseSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
  summary: z.strictObject({
    reviewedReportedAmount: TotalMoneySchema,
    allocatedAmount: TotalMoneySchema,
    unallocatedAmount: TotalMoneySchema,
    pendingCount: z.number().int().nonnegative(),
    acceptedCount: z.number().int().nonnegative(),
    rejectedCount: z.number().int().nonnegative(),
    cashReceipt: z.literal('UNVERIFIED'),
    posting: z.literal('UNVERIFIED'),
    settlement: z.literal('UNVERIFIED'),
    lines: z.array(
      z.strictObject({
        lineId: z.uuid(),
        sourceLineId: z.string(),
        procedureCode: z.string(),
        tooth: z.string().nullable(),
        amount: TotalMoneySchema,
      }),
    ),
  }),
});
