import { createHash, createHmac } from 'node:crypto';

import {
  audit,
  prisma,
  type Prisma,
  type PostingSourceReceipt,
  type UserRole,
} from '@dentabill/db';
import { ApiError } from '@dentabill/types';
import { z } from 'zod';

import type { PostingBlockerSchema } from './contract.js';
import {
  PostingEvidenceSchema,
  PostingHistorySchema,
  PostingInputSchema,
  PostingListSchema,
  PostingPreviewSchema,
  PostingReviewInputSchema,
  PostingReceiptSchema,
  postingTotals,
  type PostingEvidenceResponse,
  type PostingPreviewResponse,
  type PostingReviewInput,
  type PostingReceiptResponse,
} from './contract.js';

export interface PostingScope {
  readonly organizationId: string;
  readonly userId: string;
}
type Db = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type Evidence = Prisma.PostingSourceEvidenceGetPayload<{ include: { review: true } }>;
const evidenceInclude = { review: true } as const;
const transactionOptions = { maxWait: 5000, timeout: 30000 } as const;
const pageLimit = 20;
const pageByteLimit = 2 * 1024 * 1024;

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function conflict(message: string): never {
  throw new ApiError('CONFLICT', message);
}
export function safePostingError(error: unknown): never {
  if (ApiError.isApiError(error)) throw error;
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error.code === 'P2002' || error.code === 'P2034')
  ) {
    conflict('Another request changed this source evidence. Refresh the current preview.');
  }
  throw new ApiError(
    'INTERNAL_ERROR',
    'Posting evidence work could not be completed. Retry the same request or refresh the evidence.',
  );
}
async function authorize(db: Db, scope: PostingScope): Promise<UserRole> {
  const user = await db.user.findFirst({
    where: { id: scope.userId, organizationId: scope.organizationId },
    select: { role: true },
  });
  if (!user || !['OWNER', 'ADMIN', 'BILLING_STAFF'].includes(user.role))
    throw new ApiError('FORBIDDEN', 'Your stored practice role cannot access posting evidence.');
  return user.role;
}
async function lockOrganization(db: Db, scope: PostingScope): Promise<void> {
  // A tuple write fences stale RepeatableRead writers without changing updatedAt.
  const count =
    await db.$executeRaw`UPDATE "Organization" SET id=id WHERE id=${scope.organizationId}`;
  if (!count) throw new ApiError('NOT_FOUND', 'Practice not found.');
}
async function recordAccess(
  db: Db,
  scope: PostingScope,
  resourceId: string,
  accessKind: string,
  resultCount = 1,
): Promise<void> {
  await audit(
    {
      ...scope,
      action: 'posting.read',
      resourceType:
        accessKind === 'LIST'
          ? 'Organization'
          : accessKind === 'HISTORY'
            ? 'PostingSourceReceipt'
            : 'PostingSourceEvidence',
      resourceId,
      metadata: { accessKind, resultCount },
    },
    db,
  );
}
async function findEvidence(db: Db, scope: PostingScope, id: string): Promise<Evidence> {
  const row = await db.postingSourceEvidence.findFirst({
    where: { id, organizationId: scope.organizationId },
    include: evidenceInclude,
  });
  if (!row) throw new ApiError('NOT_FOUND', 'Posting evidence not found in your practice.');
  return row;
}
async function findReceipt(db: Db, scope: PostingScope, id: string): Promise<PostingSourceReceipt> {
  const row = await db.postingSourceReceipt.findFirst({
    where: { id, organizationId: scope.organizationId },
  });
  if (!row) throw new ApiError('NOT_FOUND', 'Source receipt not found in your practice.');
  return row;
}
function response(row: Evidence): PostingEvidenceResponse {
  return PostingEvidenceSchema.parse({
    id: row.id,
    receiptId: row.receiptId,
    createdAt: row.createdAt.toISOString(),
    contentHash: row.contentHash,
    provenance: 'MANUAL_UPLOAD',
    sourceVerification: 'UNVERIFIED',
    claimLinkage: 'UNLINKED',
    bankVerification: 'UNVERIFIED',
    settlement: 'UNVERIFIED',
    payload: PostingInputSchema.parse(row.payload),
    totals: postingTotals(PostingInputSchema.parse(row.payload)),
    review: row.review
      ? {
          id: row.review.id,
          decision: row.review.decision,
          createdAt: row.review.createdAt.toISOString(),
          reviewedByUserId: row.review.reviewedByUserId,
          reviewedByRole: row.review.reviewedByRole,
          previousAcceptedEvidenceId: row.review.previousAcceptedEvidenceId,
        }
      : null,
  });
}
async function context(
  db: Db,
  scope: PostingScope,
  row: PostingSourceReceipt,
): Promise<PostingReceiptResponse> {
  const where = { organizationId: scope.organizationId, receiptId: row.id };
  const latest = await db.postingSourceEvidence.findFirst({
    where,
    orderBy: { sourceSequence: 'desc' },
    include: evidenceInclude,
  });
  const accepted = await db.postingSourceEvidence.findFirst({
    where: { ...where, review: { decision: 'ACCEPT' } },
    orderBy: { sourceSequence: 'desc' },
    include: evidenceInclude,
  });
  if (!latest) throw new ApiError('INTERNAL_ERROR', 'Source receipt has no evidence.');
  return PostingReceiptSchema.parse({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    latestSourceSequence: latest.sourceSequence,
    latestEvidence: response(latest),
    currentAcceptedEvidence: accepted ? response(accepted) : null,
    freshness: !accepted
      ? 'UNREVIEWED'
      : accepted.sourceSequence === latest.sourceSequence
        ? 'CURRENT'
        : 'STALE',
  });
}

export async function importPostingEvidence(
  scope: PostingScope,
  input: unknown,
  secret: string,
): Promise<{ created: boolean; evidence: PostingEvidenceResponse }> {
  const parsed = PostingInputSchema.safeParse(input);
  if (!parsed.success)
    throw new ApiError(
      'VALIDATION_ERROR',
      'Check the version 1 posting source fields, status, amount signs and references.',
    );
  const payload = parsed.data;
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 256 * 1024)
    throw new ApiError('VALIDATION_ERROR', 'The normalized source record must fit within 256 KiB.');
  const contentHash = createHmac('sha256', secret)
    .update(JSON.stringify(['posting-source-v1', scope.organizationId, payload]))
    .digest('hex');
  return prisma.$transaction(async (db) => {
    await lockOrganization(db, scope);
    await authorize(db, scope);
    const storedSize = await db.$queryRaw<
      { bytes: number }[]
    >`SELECT octet_length(${JSON.stringify(payload)}::jsonb::text) AS bytes`;
    if (!storedSize[0] || storedSize[0].bytes > 256 * 1024)
      throw new ApiError('VALIDATION_ERROR', 'The stored source record must fit within 256 KiB.');
    const identity = {
      organizationId: scope.organizationId,
      sourceNamespace: payload.sourceNamespace,
      sourceSystem: payload.sourceSystem,
    };
    const existing = await db.postingSourceEvidence.findFirst({
      where: { ...identity, sourceRecordId: payload.sourceRecordId },
      include: evidenceInclude,
    });
    if (existing) {
      if (existing.contentHash !== contentHash)
        conflict(
          'This source record already has different evidence. Existing records are never overwritten.',
        );
      await recordAccess(db, scope, existing.id, 'IMPORT_REPLAY');
      return { created: false, evidence: response(existing) };
    }
    const sourceIdentity = await db.postingSourceReceipt.findFirst({
      where: identity,
      select: { sourceSystem: true, sourceProduct: true },
    });
    if (sourceIdentity && sourceIdentity.sourceProduct !== payload.sourceProduct)
      conflict('This source namespace already identifies a different product.');
    let parent = await db.postingSourceReceipt.findFirst({
      where: { ...identity, sourceReceiptId: payload.sourceReceiptId },
    });
    if (
      parent &&
      (await db.postingSourceEvidence.findFirst({
        where: {
          organizationId: scope.organizationId,
          receiptId: parent.id,
          sourceSequence: payload.sourceSequence,
        },
        select: { id: true },
      }))
    )
      conflict(
        'This source sequence already has an observation. Use its exact original source record or a new source revision.',
      );
    parent ??= await db.postingSourceReceipt.create({
      data: {
        ...identity,
        sourceReceiptId: payload.sourceReceiptId,
        sourceProduct: payload.sourceProduct,
      },
    });
    const row = await db.postingSourceEvidence.create({
      data: {
        ...identity,
        receiptId: parent.id,
        sourceRecordId: payload.sourceRecordId,
        sourceSequence: payload.sourceSequence,
        sourceVersion: payload.sourceVersion,
        sourceDocumentId: payload.sourceDocumentId,
        status: payload.status,
        detailCompleteness: payload.detailCompleteness,
        amount: payload.amount,
        payload,
        contentHash,
      },
      include: evidenceInclude,
    });
    await audit(
      {
        ...scope,
        action: 'posting.import',
        resourceType: 'PostingSourceEvidence',
        resourceId: row.id,
        metadata: {
          receiptId: parent.id,
          status: payload.status,
          sourceSequence: payload.sourceSequence,
        },
      },
      db,
    );
    return { created: true, evidence: response(row) };
  }, transactionOptions);
}

async function buildPreview(
  db: Db,
  scope: PostingScope,
  row: Evidence,
): Promise<PostingPreviewResponse> {
  const current = await context(db, scope, await findReceipt(db, scope, row.receiptId));
  const where = { organizationId: scope.organizationId };
  const version = `${String(await db.postingSourceEvidence.count({ where }))}:${String(await db.postingSourceReview.count({ where }))}`;
  const blockers: z.infer<typeof PostingBlockerSchema>[] = [];
  if (row.review) blockers.push('ALREADY_REVIEWED');
  if (row.sourceSequence !== current.latestSourceSequence) blockers.push('NEWER_SOURCE_EVIDENCE');
  const conflicts = await db.$queryRaw<
    { conflict: boolean }[]
  >`SELECT dentabill_posting_entry_conflict(${scope.organizationId}::text, ${row.id}::uuid) AS conflict`;
  if (conflicts[0]?.conflict) blockers.push('SOURCE_ENTRY_OVERLAP');
  return PostingPreviewSchema.parse({
    evidence: response(row),
    currentAcceptedEvidence: current.currentAcceptedEvidence,
    latestSourceSequence: current.latestSourceSequence,
    ledgerVersion: version,
    reviewToken: digest([
      'posting-source-review-v1',
      scope.organizationId,
      row.id,
      row.contentHash,
      current.currentAcceptedEvidence?.id ?? null,
      current.latestSourceSequence,
      version,
    ]),
    blockers,
    provenance: 'MANUAL_UPLOAD',
    sourceVerification: 'UNVERIFIED',
    claimLinkage: 'UNLINKED',
    bankVerification: 'UNVERIFIED',
    settlement: 'UNVERIFIED',
  });
}
export async function previewPostingEvidence(
  scope: PostingScope,
  id: string,
): Promise<PostingPreviewResponse> {
  return prisma.$transaction(async (db) => {
    await lockOrganization(db, scope);
    await authorize(db, scope);
    const preview = await buildPreview(db, scope, await findEvidence(db, scope, id));
    await recordAccess(db, scope, id, 'PREVIEW');
    return preview;
  }, transactionOptions);
}
export async function reviewPostingEvidence(
  scope: PostingScope,
  id: string,
  input: PostingReviewInput,
): Promise<PostingEvidenceResponse> {
  const parsed = PostingReviewInputSchema.safeParse(input);
  if (!parsed.success)
    throw new ApiError('VALIDATION_ERROR', 'Check the review token, decision and idempotency key.');
  const body = parsed.data;
  const requestHash = digest([scope.organizationId, scope.userId, id, body]);
  return prisma.$transaction(async (db) => {
    await lockOrganization(db, scope);
    const role = await authorize(db, scope);
    const row = await findEvidence(db, scope, id);
    const replay = await db.postingSourceReview.findFirst({
      where: { organizationId: scope.organizationId, idempotencyKey: body.idempotencyKey },
    });
    if (replay) {
      if (replay.requestHash !== requestHash)
        conflict('This idempotency key was used for a different review.');
      await recordAccess(db, scope, id, 'REVIEW_REPLAY');
      return response(row);
    }
    const preview = await buildPreview(db, scope, row);
    if (row.review || preview.reviewToken !== body.reviewToken)
      conflict('Source evidence has changed. Refresh and review the current preview.');
    if (body.decision === 'ACCEPT' && preview.blockers.length)
      conflict(
        'This source observation has unresolved revision or source-entry identity issues. Refresh the preview.',
      );
    const review = await db.postingSourceReview.create({
      data: {
        organizationId: scope.organizationId,
        receiptId: row.receiptId,
        evidenceId: id,
        decision: body.decision,
        reviewedByUserId: scope.userId,
        reviewedByRole: role,
        idempotencyKey: body.idempotencyKey,
        requestHash,
        reviewToken: body.reviewToken,
        evidenceHash: row.contentHash,
        ledgerVersion: preview.ledgerVersion,
        previousAcceptedEvidenceId: preview.currentAcceptedEvidence?.id ?? null,
        sourceSequence: row.sourceSequence,
      },
    });
    if (body.decision === 'ACCEPT') {
      const payload = PostingInputSchema.parse(row.payload);
      if (payload.entries.length)
        await db.postingSourceEntry.createMany({
          data: payload.entries.map((entry, sourceIndex) => ({
            ...entry,
            sourceIndex,
            reviewId: review.id,
            organizationId: scope.organizationId,
            receiptId: row.receiptId,
            evidenceId: row.id,
          })),
        });
    }
    await audit(
      {
        ...scope,
        action: 'posting.review',
        resourceType: 'PostingSourceEvidence',
        resourceId: id,
        metadata: {
          receiptId: row.receiptId,
          decision: body.decision,
          reviewId: review.id,
        },
      },
      db,
    );
    return response(await findEvidence(db, scope, id));
  }, transactionOptions);
}

const ListCursorSchema = z.strictObject({
  organizationId: z.string(),
  kind: z.literal('RECEIPTS'),
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});
const HistoryCursorSchema = z.strictObject({
  organizationId: z.string(),
  kind: z.literal('HISTORY'),
  receiptId: z.uuid(),
  sourceSequence: z.number().int().positive(),
});
function decodeCursor<T>(schema: z.ZodType<T>, cursor: string | undefined): T | undefined {
  if (!cursor) return undefined;
  try {
    return schema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'Invalid posting evidence cursor.');
  }
}
function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
export async function listPostingEvidence(
  scope: PostingScope,
  limit: number,
  cursor?: string,
): Promise<z.infer<typeof PostingListSchema>> {
  const page = decodeCursor(ListCursorSchema, cursor);
  if (page && page.organizationId !== scope.organizationId)
    throw new ApiError('VALIDATION_ERROR', 'Invalid posting evidence cursor.');
  return prisma.$transaction(
    async (db) => {
      await authorize(db, scope);
      const rows = await db.postingSourceReceipt.findMany({
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
        take: Math.min(limit, pageLimit) + 1,
      });
      const items: PostingReceiptResponse[] = [];
      let bytes = 4096;
      for (const row of rows.slice(0, Math.min(limit, pageLimit))) {
        const item = await context(db, scope, row);
        const size = Buffer.byteLength(JSON.stringify(item), 'utf8') + 1;
        if (bytes + size > pageByteLimit) break;
        items.push(item);
        bytes += size;
      }
      if (rows.length && !items.length)
        throw new ApiError('INTERNAL_ERROR', 'This evidence exceeds the supported page size.');
      const last = items.at(-1);
      const hasMore = rows.length > items.length;
      const result = PostingListSchema.parse({
        items,
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({
                organizationId: scope.organizationId,
                kind: 'RECEIPTS',
                createdAt: last.createdAt,
                id: last.id,
              })
            : null,
      });
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > pageByteLimit)
        throw new ApiError('INTERNAL_ERROR', 'This evidence exceeds the supported page size.');
      await recordAccess(db, scope, scope.organizationId, 'LIST', items.length);
      return result;
    },
    { ...transactionOptions, isolationLevel: 'RepeatableRead' },
  );
}
export async function postingEvidenceHistory(
  scope: PostingScope,
  receiptId: string,
  limit: number,
  cursor?: string,
): Promise<z.infer<typeof PostingHistorySchema>> {
  const page = decodeCursor(HistoryCursorSchema, cursor);
  if (page && (page.organizationId !== scope.organizationId || page.receiptId !== receiptId))
    throw new ApiError('VALIDATION_ERROR', 'Invalid posting evidence cursor.');
  return prisma.$transaction(
    async (db) => {
      await authorize(db, scope);
      const receipt = await context(db, scope, await findReceipt(db, scope, receiptId));
      const rows = await db.postingSourceEvidence.findMany({
        where: {
          organizationId: scope.organizationId,
          receiptId,
          ...(page ? { sourceSequence: { lt: page.sourceSequence } } : {}),
        },
        orderBy: { sourceSequence: 'desc' },
        include: evidenceInclude,
        take: Math.min(limit, pageLimit) + 1,
      });
      const items: PostingEvidenceResponse[] = [];
      let bytes = Buffer.byteLength(JSON.stringify(receipt), 'utf8') + 4096;
      for (const row of rows.slice(0, Math.min(limit, pageLimit))) {
        const item = response(row);
        const size = Buffer.byteLength(JSON.stringify(item), 'utf8') + 1;
        if (bytes + size > pageByteLimit) break;
        items.push(item);
        bytes += size;
      }
      if (rows.length && !items.length)
        throw new ApiError('INTERNAL_ERROR', 'This evidence exceeds the supported page size.');
      const last = items.at(-1);
      const hasMore = rows.length > items.length;
      await recordAccess(db, scope, receiptId, 'HISTORY', items.length);
      return PostingHistorySchema.parse({
        receipt,
        items,
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({
                organizationId: scope.organizationId,
                kind: 'HISTORY',
                receiptId,
                sourceSequence: last.payload.sourceSequence,
              })
            : null,
      });
    },
    { ...transactionOptions, isolationLevel: 'RepeatableRead' },
  );
}
