import { createHash, createHmac } from 'node:crypto';

import { audit, prisma, type Prisma, type UserRole } from '@dentabill/db';
import { ApiError } from '@dentabill/types';
import { z } from 'zod';

import {
  BatchEvidenceSchema,
  BatchInputSchema,
  BatchListSchema,
  BatchPreviewSchema,
  BatchReviewInputSchema,
  batchTotals,
  type BatchBlocker,
  type BatchEvidenceResponse,
  type BatchMemberMatch,
  type BatchPreviewResponse,
  type BatchReviewInput,
} from './contract.js';

export interface BatchScope {
  readonly organizationId: string;
  readonly userId: string;
}
type Db = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
const evidenceInclude = {
  review: { include: { members: { orderBy: { sourceIndex: 'asc' as const } } } },
} as const;
type Evidence = Prisma.RemittanceBatchEvidenceGetPayload<{ include: typeof evidenceInclude }>;
const transactionOptions = { maxWait: 5000, timeout: 30000 } as const;

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function conflict(message: string): never {
  throw new ApiError('CONFLICT', message);
}
export function safeBatchError(error: unknown): never {
  if (ApiError.isApiError(error)) throw error;
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === 'P2002' || error.code === 'P2034')
  )
    conflict(
      'Another request changed the batch evidence or used a claim report. Refresh its preview.',
    );
  throw new ApiError(
    'INTERNAL_ERROR',
    'Batch evidence work could not be completed. Retry the same request or refresh the evidence.',
  );
}
async function authorize(db: Db, scope: BatchScope): Promise<UserRole> {
  const user = await db.user.findFirst({
    where: { id: scope.userId, organizationId: scope.organizationId },
    select: { role: true },
  });
  if (!user || !['OWNER', 'ADMIN', 'BILLING_STAFF'].includes(user.role))
    throw new ApiError('FORBIDDEN', 'Your stored practice role cannot access remittance batches.');
  return user.role;
}
async function lockOrganization(db: Db, scope: BatchScope): Promise<void> {
  const count =
    await db.$executeRaw`UPDATE "Organization" SET id=id WHERE id=${scope.organizationId}`;
  if (!count) throw new ApiError('NOT_FOUND', 'Practice not found.');
}
async function recordAccess(
  db: Db,
  scope: BatchScope,
  resourceId: string,
  accessKind: string,
  resultCount = 1,
): Promise<void> {
  await audit(
    {
      ...scope,
      action: 'batch.read',
      resourceType: accessKind === 'LIST' ? 'Organization' : 'RemittanceBatchEvidence',
      resourceId,
      metadata: { accessKind, resultCount },
    },
    db,
  );
}
async function findEvidence(db: Db, scope: BatchScope, id: string): Promise<Evidence> {
  const row = await db.remittanceBatchEvidence.findFirst({
    where: { organizationId: scope.organizationId, id },
    include: evidenceInclude,
  });
  if (!row) throw new ApiError('NOT_FOUND', 'Remittance batch not found in your practice.');
  return row;
}
function response(row: Evidence): BatchEvidenceResponse {
  return BatchEvidenceSchema.parse({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    contentHash: row.contentHash,
    payload: row.payload,
    provenance: 'MANUAL_UPLOAD',
    cashReceipt: 'UNVERIFIED',
    posting: 'UNVERIFIED',
    settlement: 'UNVERIFIED',
    review: row.review
      ? {
          id: row.review.id,
          decision: row.review.decision,
          createdAt: row.review.createdAt.toISOString(),
          reviewedByUserId: row.review.reviewedByUserId,
          reviewedByRole: row.review.reviewedByRole,
          claimReportedAmount: row.review.claimReportedAmount?.toFixed(2) ?? null,
          providerAdjustmentAmount: row.review.providerAdjustmentAmount?.toFixed(2) ?? null,
          netAmount: row.review.netAmount?.toFixed(2) ?? null,
          members: row.review.members.map((member) => ({
            sourceIndex: member.sourceIndex,
            claimId: member.claimId,
            remittanceEvidenceId: member.remittanceEvidenceId,
            remittanceReviewId: member.remittanceReviewId,
            amount: member.amount.toFixed(2),
          })),
        }
      : null,
  });
}

export async function importBatchEvidence(
  scope: BatchScope,
  input: unknown,
  secret: string,
): Promise<{ created: boolean; evidence: BatchEvidenceResponse }> {
  const parsed = BatchInputSchema.safeParse(input);
  if (!parsed.success)
    throw new ApiError(
      'VALIDATION_ERROR',
      'Check the batch source fields, amounts, adjustment signs and unique member references.',
    );
  const payload = parsed.data;
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 256 * 1024)
    throw new ApiError('VALIDATION_ERROR', 'The normalized batch record must fit within 256 KiB.');
  const contentHash = createHmac('sha256', secret)
    .update(JSON.stringify(['remittance-batch-v1', scope.organizationId, payload]))
    .digest('hex');
  return prisma.$transaction(async (db) => {
    await lockOrganization(db, scope);
    await authorize(db, scope);
    // PostgreSQL's JSONB representation includes spacing not present in JSON.stringify.
    // Apply the storage bound before insertion so oversized source records stay a 400.
    const [storedSize] = await db.$queryRaw<{ bytes: number }[]>`
      SELECT octet_length(${JSON.stringify(payload)}::jsonb::text) AS bytes
    `;
    if (!storedSize || storedSize.bytes > 256 * 1024)
      throw new ApiError('VALIDATION_ERROR', 'The stored batch record must fit within 256 KiB.');
    const existing = await db.remittanceBatchEvidence.findFirst({
      where: {
        organizationId: scope.organizationId,
        sourceNamespace: payload.sourceNamespace,
        OR: [{ sourceBatchId: payload.sourceBatchId }, { sourceRecordId: payload.sourceRecordId }],
      },
      include: evidenceInclude,
    });
    if (existing) {
      if (existing.contentHash !== contentHash)
        conflict(
          'This batch or source record already has different evidence. Batch corrections are not supported yet; retained evidence was not changed.',
        );
      await recordAccess(db, scope, existing.id, 'IMPORT_REPLAY');
      return { created: false, evidence: response(existing) };
    }
    const row = await db.remittanceBatchEvidence.create({
      data: {
        organizationId: scope.organizationId,
        sourceNamespace: payload.sourceNamespace,
        sourceBatchId: payload.sourceBatchId,
        sourceRecordId: payload.sourceRecordId,
        sourceDocumentId: payload.sourceDocumentId,
        sourceVersion: payload.sourceVersion,
        detailCompleteness: payload.detailCompleteness,
        reportedClaimAmount: payload.reportedClaimAmount,
        reportedAdjustmentAmount: payload.reportedAdjustmentAmount,
        reportedNetAmount: payload.reportedNetAmount,
        payload,
        contentHash,
      },
      include: evidenceInclude,
    });
    await audit(
      {
        ...scope,
        action: 'batch.import',
        resourceType: 'RemittanceBatchEvidence',
        resourceId: row.id,
        metadata: {
          claimCount: payload.claimRemittances.length,
          adjustmentCount: payload.providerAdjustments.length,
          detailCompleteness: payload.detailCompleteness,
        },
      },
      db,
    );
    return { created: true, evidence: response(row) };
  }, transactionOptions);
}

async function buildPreview(
  db: Db,
  scope: BatchScope,
  row: Evidence,
): Promise<BatchPreviewResponse> {
  const payload = BatchInputSchema.parse(row.payload);
  const totals = batchTotals(payload);
  const blockers: BatchBlocker[] = [...totals.blockers];
  if (row.review) blockers.unshift('ALREADY_REVIEWED');
  const sources = payload.claimRemittances.length
    ? await db.claimRemittanceEvidence.findMany({
        where: {
          organizationId: scope.organizationId,
          OR: payload.claimRemittances.map((member) => ({
            sourceNamespace: member.sourceNamespace,
            sourceRecordId: member.sourceRecordId,
          })),
        },
        include: { review: true },
      })
    : [];
  const used = sources.length
    ? await db.remittanceBatchClaim.findMany({
        where: {
          organizationId: scope.organizationId,
          remittanceEvidenceId: { in: sources.map((source) => source.id) },
        },
        select: { remittanceEvidenceId: true, batchEvidenceId: true },
      })
    : [];
  const members: BatchMemberMatch[] = payload.claimRemittances.map((member) => {
    const source = sources.find(
      (candidate) =>
        candidate.sourceNamespace === member.sourceNamespace &&
        candidate.sourceRecordId === member.sourceRecordId,
    );
    let status: BatchMemberMatch['status'] = 'MATCHED';
    if (!source) status = 'MISSING';
    else if (!source.review) status = 'UNREVIEWED';
    else if (source.review.decision !== 'ACCEPT') status = 'REJECTED';
    else if (source.reportedAmount.toFixed(2) !== member.reportedAmount) status = 'AMOUNT_MISMATCH';
    else if (
      used.some(
        (link) => link.remittanceEvidenceId === source.id && link.batchEvidenceId !== row.id,
      )
    )
      status = 'ALREADY_BATCHED';
    if (status === 'MISSING') blockers.push('MEMBER_MISSING');
    else if (status === 'UNREVIEWED' || status === 'REJECTED') blockers.push('MEMBER_NOT_ACCEPTED');
    else if (status === 'AMOUNT_MISMATCH') blockers.push('MEMBER_AMOUNT_MISMATCH');
    else if (status === 'ALREADY_BATCHED') blockers.push('MEMBER_ALREADY_BATCHED');
    const sourcePayload = source?.payload;
    const payerName =
      sourcePayload &&
      typeof sourcePayload === 'object' &&
      !Array.isArray(sourcePayload) &&
      typeof sourcePayload.payerName === 'string'
        ? sourcePayload.payerName
        : null;
    return {
      ...member,
      evidenceId: source?.id ?? null,
      claimId: source?.claimId ?? null,
      reviewId: source?.review?.id ?? null,
      evidenceHash: source?.contentHash ?? null,
      payerName,
      status,
    };
  });
  const where = { organizationId: scope.organizationId };
  const ledgerVersion = `${String(await db.remittanceBatchEvidence.count({ where }))}:${String(await db.remittanceBatchReview.count({ where }))}`;
  return BatchPreviewSchema.parse({
    evidence: response(row),
    reviewToken: digest([
      'remittance-batch-review-v1',
      scope.organizationId,
      row.id,
      row.contentHash,
      ledgerVersion,
      members,
    ]),
    ledgerVersion,
    blockers: [...new Set(blockers)],
    members,
    listedClaimAmount: totals.listedClaimAmount,
    listedAdjustmentAmount: totals.listedAdjustmentAmount,
    calculatedNetAmount: totals.calculatedNetAmount,
    cashReceipt: 'UNVERIFIED',
    posting: 'UNVERIFIED',
    settlement: 'UNVERIFIED',
  });
}

export async function previewBatchEvidence(
  scope: BatchScope,
  id: string,
): Promise<BatchPreviewResponse> {
  return prisma.$transaction(async (db) => {
    await lockOrganization(db, scope);
    await authorize(db, scope);
    const result = await buildPreview(db, scope, await findEvidence(db, scope, id));
    await recordAccess(db, scope, id, 'PREVIEW');
    return result;
  }, transactionOptions);
}
export async function reviewBatchEvidence(
  scope: BatchScope,
  id: string,
  input: BatchReviewInput,
): Promise<BatchEvidenceResponse> {
  const parsed = BatchReviewInputSchema.safeParse(input);
  if (!parsed.success)
    throw new ApiError('VALIDATION_ERROR', 'Check the review decision, token and idempotency key.');
  const body = parsed.data;
  const requestHash = digest([scope.organizationId, scope.userId, id, body]);
  return prisma.$transaction(async (db) => {
    await lockOrganization(db, scope);
    const role = await authorize(db, scope);
    const row = await findEvidence(db, scope, id);
    const replay = await db.remittanceBatchReview.findFirst({
      where: { organizationId: scope.organizationId, idempotencyKey: body.idempotencyKey },
    });
    if (replay) {
      if (replay.requestHash !== requestHash)
        conflict('This idempotency key was used for a different batch review.');
      await recordAccess(db, scope, id, 'REVIEW_REPLAY');
      return response(row);
    }
    const preview = await buildPreview(db, scope, row);
    if (row.review || preview.reviewToken !== body.reviewToken)
      conflict(
        'Batch evidence or its claim review bindings changed. Refresh and review the current preview.',
      );
    if (body.decision === 'ACCEPT' && preview.blockers.length)
      conflict(
        'This batch has incomplete, unbalanced or unresolved source evidence. Review the blockers first.',
      );
    const payload = BatchInputSchema.parse(row.payload);
    const accepting = body.decision === 'ACCEPT';
    const review = await db.remittanceBatchReview.create({
      data: {
        organizationId: scope.organizationId,
        evidenceId: id,
        decision: body.decision,
        reviewedByUserId: scope.userId,
        reviewedByRole: role,
        idempotencyKey: body.idempotencyKey,
        requestHash,
        reviewToken: body.reviewToken,
        evidenceHash: row.contentHash,
        ledgerVersion: preview.ledgerVersion,
        claimReportedAmount: accepting ? payload.reportedClaimAmount : null,
        providerAdjustmentAmount: accepting ? payload.reportedAdjustmentAmount : null,
        netAmount: accepting ? payload.reportedNetAmount : null,
        claimCount: accepting ? payload.claimRemittances.length : 0,
        adjustmentCount: accepting ? payload.providerAdjustments.length : 0,
      },
    });
    if (accepting) {
      for (const [sourceIndex, member] of preview.members.entries()) {
        if (!member.evidenceId || !member.reviewId || !member.claimId)
          conflict('A claim source report is unavailable. Refresh the preview.');
        await db.remittanceBatchClaim.create({
          data: {
            reviewId: review.id,
            organizationId: scope.organizationId,
            batchEvidenceId: id,
            sourceIndex,
            claimId: member.claimId,
            remittanceEvidenceId: member.evidenceId,
            remittanceReviewId: member.reviewId,
            amount: member.reportedAmount,
          },
        });
      }
      for (const [sourceIndex, adjustment] of payload.providerAdjustments.entries()) {
        await db.remittanceBatchAdjustment.create({
          data: {
            ...adjustment,
            reviewId: review.id,
            organizationId: scope.organizationId,
            sourceIndex,
            fiscalPeriodEnd: adjustment.fiscalPeriodEnd
              ? new Date(`${adjustment.fiscalPeriodEnd}T00:00:00.000Z`)
              : null,
          },
        });
      }
    }
    await audit(
      {
        ...scope,
        action: 'batch.review',
        resourceType: 'RemittanceBatchEvidence',
        resourceId: id,
        metadata: { reviewId: review.id, decision: body.decision },
      },
      db,
    );
    return response(await findEvidence(db, scope, id));
  }, transactionOptions);
}

const CursorSchema = z.strictObject({
  organizationId: z.string(),
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});
export async function listBatchEvidence(
  scope: BatchScope,
  limit: number,
  cursor?: string,
): Promise<z.infer<typeof BatchListSchema>> {
  let page: z.infer<typeof CursorSchema> | undefined;
  if (cursor) {
    try {
      page = CursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    } catch {
      throw new ApiError('VALIDATION_ERROR', 'Invalid remittance batch cursor.');
    }
    if (page.organizationId !== scope.organizationId)
      throw new ApiError('VALIDATION_ERROR', 'Invalid remittance batch cursor.');
  }
  return prisma.$transaction(
    async (db) => {
      await authorize(db, scope);
      const rows = await db.remittanceBatchEvidence.findMany({
        where: {
          organizationId: scope.organizationId,
          ...(page
            ? {
                OR: [
                  { createdAt: { lt: new Date(page.createdAt) } },
                  { createdAt: new Date(page.createdAt), id: { lt: page.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: Math.min(limit, 20) + 1,
        include: evidenceInclude,
      });
      const items: BatchEvidenceResponse[] = [];
      let bytes = 4096;
      for (const row of rows.slice(0, Math.min(limit, 20))) {
        const item = response(row);
        const size = Buffer.byteLength(JSON.stringify(item), 'utf8') + 1;
        if (bytes + size > 2 * 1024 * 1024) break;
        items.push(item);
        bytes += size;
      }
      if (rows.length && !items.length)
        throw new ApiError('INTERNAL_ERROR', 'This batch exceeds the supported page size.');
      const last = items.at(-1);
      const hasMore = rows.length > items.length;
      const result = BatchListSchema.parse({
        items,
        hasMore,
        nextCursor:
          hasMore && last
            ? Buffer.from(
                JSON.stringify({
                  organizationId: scope.organizationId,
                  createdAt: last.createdAt,
                  id: last.id,
                }),
              ).toString('base64url')
            : null,
      });
      await recordAccess(db, scope, scope.organizationId, 'LIST', items.length);
      return result;
    },
    { ...transactionOptions, isolationLevel: 'RepeatableRead' },
  );
}
