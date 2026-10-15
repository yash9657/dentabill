import { createHash, createHmac } from 'node:crypto';

import { audit, prisma, type Prisma } from '@dentabill/db';
import { ApiError } from '@dentabill/types';
import { z } from 'zod';

import {
  EvidenceResponseSchema,
  ListResponseSchema,
  PreviewResponseSchema,
  RemittanceInputSchema,
  ReviewInputSchema,
  magnitude,
  moneyCents,
  moneyString,
  type RemittanceBlocker,
  type RemittanceInput,
  type ReviewInput,
} from './contract.js';

export interface RemittanceScope {
  readonly organizationId: string;
  readonly claimId: string;
  readonly userId: string;
}
type Db = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type Evidence = Prisma.ClaimRemittanceEvidenceGetPayload<{ include: { review: true } }>;
const EvidenceInclude = { review: true } as const;
const transactionOptions = { maxWait: 5000, timeout: 30000 } as const;

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function conflict(message: string): never {
  throw new ApiError('CONFLICT', message);
}
export function safeRemittanceError(error: unknown): never {
  if (ApiError.isApiError(error)) throw error;
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === 'P2002' || error.code === 'P2034')
  ) {
    conflict('Another review used this evidence or idempotency key. Refresh the current preview.');
  }
  // Prisma errors can contain member references and JSON. Never pass them to the global logger.
  throw new ApiError(
    'INTERNAL_ERROR',
    'Remittance work could not be completed. Retry the same request or refresh the evidence.',
  );
}
async function authorize(db: Db, scope: RemittanceScope): Promise<void> {
  const user = await db.user.findFirst({
    where: { id: scope.userId, organizationId: scope.organizationId },
    select: { role: true },
  });
  if (!user || !['OWNER', 'ADMIN', 'BILLING_STAFF'].includes(user.role))
    throw new ApiError('FORBIDDEN', 'Your stored practice role cannot access remittance evidence.');
}
async function lockClaim(db: Db, scope: RemittanceScope): Promise<{ id: string; updatedAt: Date }> {
  const rows = await db.$queryRaw<
    { id: string; updatedAt: Date }[]
  >`SELECT id, "updatedAt" FROM "Claim" WHERE id = ${scope.claimId} AND "organizationId" = ${scope.organizationId} FOR NO KEY UPDATE`;
  const claim = rows[0];
  if (!claim) throw new ApiError('NOT_FOUND', 'Claim not found in your practice.');
  return claim;
}
async function findEvidence(db: Db, scope: RemittanceScope, id: string): Promise<Evidence> {
  const row = await db.claimRemittanceEvidence.findFirst({
    where: { id, organizationId: scope.organizationId, claimId: scope.claimId },
    include: EvidenceInclude,
  });
  if (!row) throw new ApiError('NOT_FOUND', 'Remittance evidence not found in your practice.');
  return row;
}
function response(row: Evidence): z.infer<typeof EvidenceResponseSchema> {
  return EvidenceResponseSchema.parse({
    id: row.id,
    claimId: row.claimId,
    createdAt: row.createdAt.toISOString(),
    contentHash: row.contentHash,
    payload: RemittanceInputSchema.parse(row.payload),
    review: row.review
      ? {
          id: row.review.id,
          decision: row.review.decision,
          createdAt: row.review.createdAt.toISOString(),
          reviewedByUserId: row.review.reviewedByUserId,
          reportedAmount: row.review.reportedAmount.toFixed(2),
          reversedEvidenceId: row.review.reversedEvidenceId,
        }
      : null,
  });
}

export async function importRemittance(
  scope: RemittanceScope,
  input: unknown,
  secret: string,
): Promise<{ created: boolean; evidence: z.infer<typeof EvidenceResponseSchema> }> {
  const parsed = RemittanceInputSchema.safeParse(input);
  if (!parsed.success)
    throw new ApiError(
      'VALIDATION_ERROR',
      'Check the version 1 remittance fields, signs, line totals and source references.',
    );
  const payload = parsed.data;
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 1024 * 1024)
    throw new ApiError(
      'VALIDATION_ERROR',
      'The normalized remittance record must fit within 1 MiB.',
    );
  const contentHash = createHmac('sha256', secret)
    .update(JSON.stringify(['claim-remittance-v1', scope.organizationId, scope.claimId, payload]))
    .digest('hex');
  return prisma.$transaction(async (db) => {
    // Source record uniqueness spans claims. Keep admission ordering deterministic across upload paths.
    await db.$queryRaw`SELECT id FROM "Organization" WHERE id = ${scope.organizationId} FOR NO KEY UPDATE`;
    await authorize(db, scope);
    await lockClaim(db, scope);
    const existing = await db.claimRemittanceEvidence.findFirst({
      where: {
        organizationId: scope.organizationId,
        sourceNamespace: payload.sourceNamespace,
        sourceRecordId: payload.sourceRecordId,
      },
      include: EvidenceInclude,
    });
    if (existing) {
      if (existing.claimId !== scope.claimId || existing.contentHash !== contentHash)
        conflict(
          'This source record already has different evidence. Existing records are never overwritten.',
        );
      await audit(
        {
          organizationId: scope.organizationId,
          userId: scope.userId,
          action: 'remittance.read',
          resourceType: 'ClaimRemittanceEvidence',
          resourceId: existing.id,
          metadata: { claimId: scope.claimId, accessKind: 'IMPORT_REPLAY' },
        },
        db,
      );
      return { created: false, evidence: response(existing) };
    }
    const row = await db.claimRemittanceEvidence.create({
      data: {
        organizationId: scope.organizationId,
        claimId: scope.claimId,
        sourceNamespace: payload.sourceNamespace,
        sourceRecordId: payload.sourceRecordId,
        sourceDocumentId: payload.sourceDocumentId,
        sourceVersion: payload.sourceVersion,
        kind: payload.kind,
        reversesSourceRecordId: payload.reversesSourceRecordId,
        reportedAmount: payload.reportedAmount,
        currency: payload.currency,
        payload,
        contentHash,
      },
      include: EvidenceInclude,
    });
    await audit(
      {
        organizationId: scope.organizationId,
        userId: scope.userId,
        action: 'remittance.import',
        resourceType: 'ClaimRemittanceEvidence',
        resourceId: row.id,
        metadata: {
          claimId: scope.claimId,
          kind: payload.kind,
          allocationCount: payload.allocations.length,
          adjustmentCount: payload.adjustments.length,
        },
      },
      db,
    );
    return { created: true, evidence: response(row) };
  }, transactionOptions);
}

async function ledgerVersion(db: Db, scope: RemittanceScope): Promise<string> {
  const where = { organizationId: scope.organizationId, claimId: scope.claimId };
  const evidenceCount = await db.claimRemittanceEvidence.count({ where });
  const reviewCount = await db.claimRemittanceReview.count({ where });
  return `${String(evidenceCount)}:${String(reviewCount)}`;
}
function oppositeWithin(value: bigint, remaining: bigint): boolean {
  return (
    value === 0n || (value < 0n !== remaining < 0n && magnitude(value) <= magnitude(remaining))
  );
}

async function buildPreview(
  db: Db,
  scope: RemittanceScope,
  row: Evidence,
  claimUpdatedAt: Date,
): Promise<z.infer<typeof PreviewResponseSchema>> {
  const payload = RemittanceInputSchema.parse(row.payload);
  const version = await ledgerVersion(db, scope);
  const blockerSet = new Set<RemittanceBlocker>();
  if (row.review) blockerSet.add('ALREADY_REVIEWED');
  const sourceIds = [
    ...new Set([
      ...payload.allocations.map((item) => item.sourceLineId),
      ...payload.adjustments.flatMap((item) =>
        item.sourceLineId === null ? [] : [item.sourceLineId],
      ),
    ]),
  ];
  const lines = await db.claimSourceLine.findMany({
    where: {
      organizationId: scope.organizationId,
      claimId: scope.claimId,
      sourceLineId: { in: sourceIds },
    },
    select: { id: true, sourceLineId: true, procedureCode: true, tooth: true },
  });
  const bySourceLine = new Map(lines.map((line) => [line.sourceLineId, line]));
  if (sourceIds.some((id) => !bySourceLine.has(id))) blockerSet.add('SOURCE_LINE_MISSING');
  if (
    payload.sourceCoverageId !== null &&
    !(await db.claimSourceCoverage.findFirst({
      where: {
        organizationId: scope.organizationId,
        claimId: scope.claimId,
        sourceCoverageId: payload.sourceCoverageId,
      },
      select: { id: true },
    }))
  )
    blockerSet.add('SOURCE_COVERAGE_MISSING');
  let original: Evidence | null = null;
  let remainingOriginalAmount: string | null = null;
  const unallocated =
    moneyCents(payload.reportedAmount) -
    payload.allocations.reduce((sum, item) => sum + moneyCents(item.amount), 0n);
  if (payload.kind === 'REVERSAL') {
    original = await db.claimRemittanceEvidence.findFirst({
      where: {
        organizationId: scope.organizationId,
        claimId: scope.claimId,
        sourceNamespace: payload.sourceNamespace,
        sourceRecordId: payload.reversesSourceRecordId ?? '',
      },
      include: EvidenceInclude,
    });
    if (!original) blockerSet.add('ORIGINAL_MISSING');
    else if (original.kind !== 'PAYMENT') blockerSet.add('REVERSAL_TARGET_MISMATCH');
    else if (original.review?.decision !== 'ACCEPT') blockerSet.add('ORIGINAL_NOT_ACCEPTED');
    else {
      const originalInput = RemittanceInputSchema.parse(original.payload);
      if (
        ['payerName', 'payerIdentifier', 'payerIdentifierSystem', 'sourceCoverageId'].some(
          (key) =>
            payload[key as keyof RemittanceInput] !== originalInput[key as keyof RemittanceInput],
        )
      )
        blockerSet.add('REVERSAL_TARGET_MISMATCH');
      const reversalWhere = {
        organizationId: scope.organizationId,
        claimId: scope.claimId,
        decision: 'ACCEPT',
        reversedEvidenceId: original.id,
      };
      const priorPaid = await db.claimRemittanceReview.aggregate({
        where: reversalWhere,
        _sum: { reportedAmount: true },
      });
      const remaining =
        moneyCents(original.reportedAmount.toFixed(2)) +
        moneyCents(priorPaid._sum.reportedAmount?.toFixed(2) ?? '0.00');
      remainingOriginalAmount = moneyString(remaining);
      if (!oppositeWithin(moneyCents(payload.reportedAmount), remaining))
        blockerSet.add('REVERSAL_EXCEEDS_REMAINING');
      const priorLines = await db.claimRemittanceAllocation.groupBy({
        by: ['lineId'],
        where: {
          organizationId: scope.organizationId,
          claimId: scope.claimId,
          review: reversalWhere,
        },
        _sum: { amount: true },
      });
      const originalLines = await db.claimRemittanceAllocation.findMany({
        where: {
          organizationId: scope.organizationId,
          claimId: scope.claimId,
          reviewId: original.review.id,
        },
        select: { lineId: true, amount: true },
      });
      const remainingLines = new Map(
        originalLines.map((item) => [item.lineId, moneyCents(item.amount.toFixed(2))]),
      );
      for (const item of priorLines)
        remainingLines.set(
          item.lineId,
          (remainingLines.get(item.lineId) ?? 0n) +
            moneyCents(item._sum.amount?.toFixed(2) ?? '0.00'),
        );
      const originalUnallocated =
        moneyCents(original.reportedAmount.toFixed(2)) -
        originalLines.reduce((sum, item) => sum + moneyCents(item.amount.toFixed(2)), 0n);
      const priorUnallocated =
        moneyCents(priorPaid._sum.reportedAmount?.toFixed(2) ?? '0.00') -
        priorLines.reduce(
          (sum, item) => sum + moneyCents(item._sum.amount?.toFixed(2) ?? '0.00'),
          0n,
        );
      if (!oppositeWithin(unallocated, originalUnallocated + priorUnallocated))
        blockerSet.add('REVERSAL_EXCEEDS_REMAINING');
      for (const item of payload.allocations) {
        const line = bySourceLine.get(item.sourceLineId);
        if (
          line &&
          (!remainingLines.has(line.id) ||
            !oppositeWithin(moneyCents(item.amount), remainingLines.get(line.id) ?? 0n))
        )
          blockerSet.add('REVERSAL_EXCEEDS_REMAINING');
      }
      const originalAdjustments = new Map(
        originalInput.adjustments.map((item) => [item.sourceAdjustmentId, item]),
      );
      const priorAdjustments = await db.claimRemittanceAdjustment.groupBy({
        by: ['sourceAdjustmentId'],
        where: {
          organizationId: scope.organizationId,
          claimId: scope.claimId,
          review: reversalWhere,
        },
        _sum: { amount: true },
      });
      const priorByAdjustment = new Map(
        priorAdjustments.map((item) => [
          item.sourceAdjustmentId,
          moneyCents(item._sum.amount?.toFixed(2) ?? '0.00'),
        ]),
      );
      for (const item of payload.adjustments) {
        const base = originalAdjustments.get(item.sourceAdjustmentId);
        if (
          !base ||
          ['sourceLineId', 'codeSystem', 'groupCode', 'reasonCode'].some(
            (key) => item[key as keyof typeof item] !== base[key as keyof typeof base],
          )
        )
          blockerSet.add('REVERSAL_ADJUSTMENT_MISMATCH');
        else if (
          !oppositeWithin(
            moneyCents(item.amount),
            moneyCents(base.amount) + (priorByAdjustment.get(item.sourceAdjustmentId) ?? 0n),
          )
        )
          blockerSet.add('REVERSAL_EXCEEDS_REMAINING');
      }
    }
  }
  return PreviewResponseSchema.parse({
    evidence: response(row),
    reviewToken: digest([
      'claim-remittance-review-v1',
      scope.organizationId,
      scope.claimId,
      row.id,
      row.contentHash,
      claimUpdatedAt.toISOString(),
      version,
    ]),
    ledgerVersion: version,
    claimUpdatedAt: claimUpdatedAt.toISOString(),
    blockers: [...blockerSet],
    unallocatedAmount: moneyString(unallocated),
    originalEvidenceId: original?.id ?? null,
    remainingOriginalAmount,
    allocations: payload.allocations.map((item) => {
      const line = bySourceLine.get(item.sourceLineId);
      return {
        sourceLineId: item.sourceLineId,
        lineId: line?.id ?? null,
        procedureCode: line?.procedureCode ?? null,
        tooth: line?.tooth ?? null,
        amount: item.amount,
      };
    }),
  });
}

export async function previewRemittance(
  scope: RemittanceScope,
  evidenceId: string,
): Promise<z.infer<typeof PreviewResponseSchema>> {
  return prisma.$transaction(async (db) => {
    await authorize(db, scope);
    const claim = await lockClaim(db, scope);
    const preview = await buildPreview(
      db,
      scope,
      await findEvidence(db, scope, evidenceId),
      claim.updatedAt,
    );
    await audit(
      {
        organizationId: scope.organizationId,
        userId: scope.userId,
        action: 'remittance.read',
        resourceType: 'ClaimRemittanceEvidence',
        resourceId: evidenceId,
        metadata: { claimId: scope.claimId, accessKind: 'PREVIEW' },
      },
      db,
    );
    return preview;
  }, transactionOptions);
}

export async function reviewRemittance(
  scope: RemittanceScope,
  evidenceId: string,
  input: ReviewInput,
): Promise<z.infer<typeof EvidenceResponseSchema>> {
  const parsed = ReviewInputSchema.safeParse(input);
  if (!parsed.success)
    throw new ApiError('VALIDATION_ERROR', 'Check the review token, decision and idempotency key.');
  const body = parsed.data;
  const requestHash = digest([scope.organizationId, scope.userId, scope.claimId, evidenceId, body]);
  return prisma.$transaction(async (db) => {
    await authorize(db, scope);
    const claim = await lockClaim(db, scope);
    const row = await findEvidence(db, scope, evidenceId);
    const replay = await db.claimRemittanceReview.findFirst({
      where: { organizationId: scope.organizationId, idempotencyKey: body.idempotencyKey },
    });
    if (replay) {
      if (replay.requestHash !== requestHash)
        conflict('This idempotency key was used for a different review.');
      await audit(
        {
          organizationId: scope.organizationId,
          userId: scope.userId,
          action: 'remittance.read',
          resourceType: 'ClaimRemittanceEvidence',
          resourceId: row.id,
          metadata: { claimId: scope.claimId, accessKind: 'REVIEW_REPLAY' },
        },
        db,
      );
      return response(row);
    }
    const preview = await buildPreview(db, scope, row, claim.updatedAt);
    if (row.review || preview.reviewToken !== body.reviewToken)
      conflict('The evidence or claim has changed. Refresh and review the current preview.');
    if (body.decision === 'ACCEPT' && preview.blockers.length)
      conflict('This evidence has unresolved matching or reversal issues. Refresh the preview.');
    const payload = RemittanceInputSchema.parse(row.payload);
    const accepted = body.decision === 'ACCEPT';
    const review = await db.claimRemittanceReview.create({
      data: {
        organizationId: scope.organizationId,
        claimId: scope.claimId,
        evidenceId,
        decision: body.decision,
        reviewedByUserId: scope.userId,
        idempotencyKey: body.idempotencyKey,
        requestHash,
        reviewToken: body.reviewToken,
        evidenceHash: row.contentHash,
        claimUpdatedAt: claim.updatedAt,
        ledgerVersion: preview.ledgerVersion,
        reversedEvidenceId:
          accepted && payload.kind === 'REVERSAL' ? preview.originalEvidenceId : null,
        reportedAmount: accepted ? payload.reportedAmount : '0.00',
        allocationCount: accepted ? payload.allocations.length : 0,
        adjustmentCount: accepted ? payload.adjustments.length : 0,
      },
    });
    if (accepted) {
      const sourceIds = [
        ...new Set([
          ...payload.allocations.map((item) => item.sourceLineId),
          ...payload.adjustments.flatMap((item) =>
            item.sourceLineId === null ? [] : [item.sourceLineId],
          ),
        ]),
      ];
      const lines = await db.claimSourceLine.findMany({
        where: {
          organizationId: scope.organizationId,
          claimId: scope.claimId,
          sourceLineId: { in: sourceIds },
        },
        select: { id: true, sourceLineId: true },
      });
      const ids = new Map(lines.map((line) => [line.sourceLineId, line.id]));
      const lineId = (sourceId: string): string => {
        const id = ids.get(sourceId);
        if (!id)
          throw new ApiError(
            'CONFLICT',
            'A source procedure is unavailable. Refresh the evidence.',
          );
        return id;
      };
      if (payload.allocations.length)
        await db.claimRemittanceAllocation.createMany({
          data: payload.allocations.map((item, sourceIndex) => ({
            organizationId: scope.organizationId,
            claimId: scope.claimId,
            reviewId: review.id,
            sourceIndex,
            lineId: lineId(item.sourceLineId),
            amount: item.amount,
          })),
        });
      if (payload.adjustments.length)
        await db.claimRemittanceAdjustment.createMany({
          data: payload.adjustments.map((item, sourceIndex) => ({
            organizationId: scope.organizationId,
            claimId: scope.claimId,
            reviewId: review.id,
            sourceIndex,
            sourceAdjustmentId: item.sourceAdjustmentId,
            lineId: item.sourceLineId === null ? null : lineId(item.sourceLineId),
            codeSystem: item.codeSystem,
            groupCode: item.groupCode,
            reasonCode: item.reasonCode,
            amount: item.amount,
          })),
        });
    }
    await audit(
      {
        organizationId: scope.organizationId,
        userId: scope.userId,
        action: 'remittance.review',
        resourceType: 'ClaimRemittanceEvidence',
        resourceId: evidenceId,
        metadata: { claimId: scope.claimId, decision: body.decision, reviewId: review.id },
      },
      db,
    );
    return response(await findEvidence(db, scope, evidenceId));
  }, transactionOptions);
}

const CursorSchema = z.strictObject({
  organizationId: z.string(),
  claimId: z.string(),
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});
export async function listRemittances(
  scope: RemittanceScope,
  limit: number,
  cursor?: string,
): Promise<z.infer<typeof ListResponseSchema>> {
  let page: z.infer<typeof CursorSchema> | undefined;
  if (cursor) {
    try {
      page = CursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    } catch {
      throw new ApiError('VALIDATION_ERROR', 'Invalid remittance cursor.');
    }
    if (page.organizationId !== scope.organizationId || page.claimId !== scope.claimId)
      throw new ApiError('VALIDATION_ERROR', 'Invalid remittance cursor.');
  }
  return prisma.$transaction(
    async (db) => {
      await authorize(db, scope);
      const claim = await db.claim.findFirst({
        where: { id: scope.claimId, organizationId: scope.organizationId },
        select: { id: true },
      });
      if (!claim) throw new ApiError('NOT_FOUND', 'Claim not found in your practice.');
      const where = { organizationId: scope.organizationId, claimId: scope.claimId };
      const evidence = await db.claimRemittanceEvidence.findMany({
        where: {
          ...where,
          ...(page
            ? {
                OR: [
                  { createdAt: { lt: new Date(page.createdAt) } },
                  { createdAt: new Date(page.createdAt), id: { lt: page.id } },
                ],
              }
            : {}),
        },
        include: EvidenceInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: Math.min(limit, 10) + 1,
      });
      const reviews = await db.claimRemittanceReview.groupBy({
        by: ['decision'],
        where,
        _sum: { reportedAmount: true },
        _count: { _all: true },
      });
      const allocated = await db.claimRemittanceAllocation.groupBy({
        by: ['lineId'],
        where,
        _sum: { amount: true },
      });
      const sourceLines = await db.claimSourceLine.findMany({
        where: { ...where, id: { in: allocated.map((item) => item.lineId) } },
        select: { id: true, sourceLineId: true, procedureCode: true, tooth: true },
        orderBy: { position: 'asc' },
      });
      const amountsByLine = new Map(
        allocated.map((item) => [item.lineId, item._sum.amount?.toFixed(2) ?? '0.00']),
      );
      const accepted = reviews.find((item) => item.decision === 'ACCEPT');
      const rejected = reviews.find((item) => item.decision === 'REJECT');
      const total = moneyCents(accepted?._sum.reportedAmount?.toFixed(2) ?? '0.00');
      const allocatedTotal = allocated.reduce(
        (sum, item) => sum + moneyCents(item._sum.amount?.toFixed(2) ?? '0.00'),
        0n,
      );
      const pendingCount = await db.claimRemittanceEvidence.count({
        where: { ...where, review: null },
      });
      const summary: z.infer<typeof ListResponseSchema>['summary'] = {
        reviewedReportedAmount: moneyString(total),
        allocatedAmount: moneyString(allocatedTotal),
        unallocatedAmount: moneyString(total - allocatedTotal),
        pendingCount,
        acceptedCount: accepted?._count._all ?? 0,
        rejectedCount: rejected?._count._all ?? 0,
        cashReceipt: 'UNVERIFIED',
        posting: 'UNVERIFIED',
        settlement: 'UNVERIFIED',
        lines: sourceLines.map((line) => ({
          lineId: line.id,
          sourceLineId: line.sourceLineId,
          procedureCode: line.procedureCode,
          tooth: line.tooth,
          amount: amountsByLine.get(line.id) ?? '0.00',
        })),
      };
      const items: z.infer<typeof EvidenceResponseSchema>[] = [];
      // Leave room for cursor/envelope and the Lambda proxy's JSON string escaping.
      let pageBytes = Buffer.byteLength(JSON.stringify(summary), 'utf8') + 4096;
      for (const row of evidence.slice(0, Math.min(limit, 10))) {
        const item = response(row);
        const bytes = Buffer.byteLength(JSON.stringify(item), 'utf8') + 1;
        if (pageBytes + bytes > 2 * 1024 * 1024) {
          if (!items.length)
            throw new ApiError('INTERNAL_ERROR', 'This evidence exceeds the supported page size.');
          break;
        }
        items.push(item);
        pageBytes += bytes;
      }
      const last = items.at(-1);
      const hasMore = evidence.length > items.length;
      await audit(
        {
          organizationId: scope.organizationId,
          userId: scope.userId,
          action: 'remittance.read',
          resourceType: 'Claim',
          resourceId: scope.claimId,
          metadata: { accessKind: 'LIST', resultCount: items.length },
        },
        db,
      );
      return ListResponseSchema.parse({
        items,
        hasMore,
        nextCursor:
          hasMore && last
            ? Buffer.from(
                JSON.stringify({
                  organizationId: scope.organizationId,
                  claimId: scope.claimId,
                  createdAt: last.createdAt,
                  id: last.id,
                }),
              ).toString('base64url')
            : null,
        summary,
      });
    },
    { ...transactionOptions, isolationLevel: 'RepeatableRead' },
  );
}
