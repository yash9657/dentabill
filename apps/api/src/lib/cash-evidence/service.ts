import { createHash, createHmac } from 'node:crypto';

import { audit, prisma, Prisma, type CashSourceTransaction, type UserRole } from '@dentabill/db';
import { ApiError } from '@dentabill/types';
import { z } from 'zod';

import { moneyCents, moneyString } from '../remittances/contract.js';

import {
  CashAccountSchema,
  CashBlockerSchema,
  CashEvidenceSchema,
  CashHistorySchema,
  CashInputSchema,
  CashListSchema,
  CashPreviewSchema,
  CashReviewInputSchema,
  CashTransactionSchema,
  type CashAccountResponse,
  type CashEvidenceResponse,
  type CashPreviewResponse,
  type CashReviewInput,
  type CashTransactionResponse,
} from './contract.js';

export interface CashScope {
  readonly organizationId: string;
  readonly userId: string;
}
type Db = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type Evidence = Prisma.CashSourceEvidenceGetPayload<{ include: { review: true } }>;
const evidenceInclude = { review: true } as const;
const transactionOptions = { maxWait: 5000, timeout: 30000 } as const;
const pageLimit = 100;
const pageByteLimit = 2 * 1024 * 1024;

function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function conflict(message: string): never {
  throw new ApiError('CONFLICT', message);
}
export function safeCashError(error: unknown): never {
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
    'Cash evidence work could not be completed. Retry the same request or refresh the evidence.',
  );
}
async function authorize(db: Db, scope: CashScope): Promise<UserRole> {
  const user = await db.user.findFirst({
    where: { id: scope.userId, organizationId: scope.organizationId },
    select: { role: true },
  });
  if (!user || !['OWNER', 'ADMIN', 'BILLING_STAFF'].includes(user.role))
    throw new ApiError('FORBIDDEN', 'Your stored practice role cannot access cash evidence.');
  return user.role;
}
async function lockOrganization(db: Db, scope: CashScope): Promise<void> {
  // A tuple write fences stale RepeatableRead writers without changing updatedAt.
  const count =
    await db.$executeRaw`UPDATE "Organization" SET id=id WHERE id=${scope.organizationId}`;
  if (!count) throw new ApiError('NOT_FOUND', 'Practice not found.');
}
async function recordAccess(
  db: Db,
  scope: CashScope,
  resourceId: string,
  accessKind: string,
  resultCount = 1,
): Promise<void> {
  await audit(
    {
      ...scope,
      action: 'cash.read',
      resourceType:
        accessKind === 'LIST'
          ? 'Organization'
          : accessKind === 'HISTORY'
            ? 'CashSourceTransaction'
            : 'CashSourceEvidence',
      resourceId,
      metadata: { accessKind, resultCount },
    },
    db,
  );
}
async function findEvidence(db: Db, scope: CashScope, id: string): Promise<Evidence> {
  const row = await db.cashSourceEvidence.findFirst({
    where: { id, organizationId: scope.organizationId },
    include: evidenceInclude,
  });
  if (!row) throw new ApiError('NOT_FOUND', 'Cash evidence not found in your practice.');
  return row;
}
async function findTransaction(
  db: Db,
  scope: CashScope,
  id: string,
): Promise<CashSourceTransaction> {
  const row = await db.cashSourceTransaction.findFirst({
    where: { id, organizationId: scope.organizationId },
  });
  if (!row) throw new ApiError('NOT_FOUND', 'Source transaction not found in your practice.');
  return row;
}
function response(row: Evidence): CashEvidenceResponse {
  return CashEvidenceSchema.parse({
    id: row.id,
    transactionId: row.transactionId,
    createdAt: row.createdAt.toISOString(),
    contentHash: row.contentHash,
    provenance: 'MANUAL_UPLOAD',
    bankVerification: 'UNVERIFIED',
    settlement: 'UNVERIFIED',
    payload: CashInputSchema.parse(row.payload),
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
  scope: CashScope,
  row: CashSourceTransaction,
): Promise<CashTransactionResponse> {
  const where = { organizationId: scope.organizationId, transactionId: row.id };
  const latest = await db.cashSourceEvidence.findFirst({
    where,
    orderBy: { sourceSequence: 'desc' },
    include: evidenceInclude,
  });
  const accepted = await db.cashSourceEvidence.findFirst({
    where: { ...where, review: { decision: 'ACCEPT' } },
    orderBy: { sourceSequence: 'desc' },
    include: evidenceInclude,
  });
  if (!latest) throw new ApiError('INTERNAL_ERROR', 'Source transaction has no evidence.');
  return CashTransactionSchema.parse({
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

export async function importCashEvidence(
  scope: CashScope,
  input: unknown,
  secret: string,
): Promise<{ created: boolean; evidence: CashEvidenceResponse }> {
  const parsed = CashInputSchema.safeParse(input);
  if (!parsed.success)
    throw new ApiError(
      'VALIDATION_ERROR',
      'Check the version 1 cash source fields, status, amount signs and references.',
    );
  const payload = parsed.data;
  if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 64 * 1024)
    throw new ApiError('VALIDATION_ERROR', 'The normalized source record must fit within 64 KiB.');
  const contentHash = createHmac('sha256', secret)
    .update(JSON.stringify(['cash-source-v1', scope.organizationId, payload]))
    .digest('hex');
  return prisma.$transaction(async (db) => {
    await lockOrganization(db, scope);
    await authorize(db, scope);
    const account = {
      organizationId: scope.organizationId,
      sourceNamespace: payload.sourceNamespace,
      sourceAccountId: payload.sourceAccountId,
    };
    const existing = await db.cashSourceEvidence.findFirst({
      where: { ...account, sourceRecordId: payload.sourceRecordId },
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
    const accountIdentity = await db.cashSourceTransaction.findFirst({
      where: account,
      select: { sourceSystem: true, sourceProduct: true },
    });
    if (
      accountIdentity &&
      (accountIdentity.sourceSystem !== payload.sourceSystem ||
        accountIdentity.sourceProduct !== payload.sourceProduct)
    )
      conflict('This account namespace already identifies a different source system or product.');
    let parent = await db.cashSourceTransaction.findFirst({
      where: { ...account, sourceTransactionId: payload.sourceTransactionId },
    });
    if (
      parent &&
      (await db.cashSourceEvidence.findFirst({
        where: {
          organizationId: scope.organizationId,
          transactionId: parent.id,
          sourceSequence: payload.sourceSequence,
        },
        select: { id: true },
      }))
    )
      conflict(
        'This source sequence already has an observation. Use its exact original source record or a new source revision.',
      );
    parent ??= await db.cashSourceTransaction.create({
      data: {
        ...account,
        sourceTransactionId: payload.sourceTransactionId,
        sourceSystem: payload.sourceSystem,
        sourceProduct: payload.sourceProduct,
      },
    });
    const row = await db.cashSourceEvidence.create({
      data: {
        ...account,
        transactionId: parent.id,
        sourceRecordId: payload.sourceRecordId,
        sourceSequence: payload.sourceSequence,
        sourceVersion: payload.sourceVersion,
        sourceDocumentId: payload.sourceDocumentId,
        status: payload.status,
        amount: payload.amount,
        payload,
        contentHash,
      },
      include: evidenceInclude,
    });
    await audit(
      {
        ...scope,
        action: 'cash.import',
        resourceType: 'CashSourceEvidence',
        resourceId: row.id,
        metadata: {
          transactionId: parent.id,
          status: payload.status,
          sourceSequence: payload.sourceSequence,
        },
      },
      db,
    );
    return { created: true, evidence: response(row) };
  }, transactionOptions);
}

async function buildPreview(db: Db, scope: CashScope, row: Evidence): Promise<CashPreviewResponse> {
  const current = await context(db, scope, await findTransaction(db, scope, row.transactionId));
  const where = { organizationId: scope.organizationId };
  const version = `${String(await db.cashSourceEvidence.count({ where }))}:${String(await db.cashSourceReview.count({ where }))}`;
  const blockers: z.infer<typeof CashBlockerSchema>[] = [];
  if (row.review) blockers.push('ALREADY_REVIEWED');
  if (row.sourceSequence !== current.latestSourceSequence) blockers.push('NEWER_SOURCE_EVIDENCE');
  const payload = CashInputSchema.parse(row.payload);
  const links = await db.$queryRaw<
    { blocker: string | null }[]
  >`SELECT dentabill_cash_link_blocker(${scope.organizationId}::text, ${row.transactionId}::uuid, ${payload.pendingSourceTransactionId}::text, ${payload.status}::text) AS blocker`;
  const linkBlocker = links[0]?.blocker;
  if (linkBlocker) blockers.push(CashBlockerSchema.parse(linkBlocker));
  return CashPreviewSchema.parse({
    evidence: response(row),
    currentAcceptedEvidence: current.currentAcceptedEvidence,
    latestSourceSequence: current.latestSourceSequence,
    ledgerVersion: version,
    reviewToken: digest([
      'cash-source-review-v1',
      scope.organizationId,
      row.id,
      row.contentHash,
      current.currentAcceptedEvidence?.id ?? null,
      current.latestSourceSequence,
      version,
    ]),
    blockers,
    priorIncludedAmount:
      current.freshness === 'CURRENT' &&
      current.currentAcceptedEvidence?.payload.status === 'POSTED'
        ? current.currentAcceptedEvidence.payload.amount
        : null,
    nextIncludedAmount:
      row.sourceSequence === current.latestSourceSequence && payload.status === 'POSTED'
        ? payload.amount
        : null,
    bankVerification: 'UNVERIFIED',
    settlement: 'UNVERIFIED',
  });
}
export async function previewCashEvidence(
  scope: CashScope,
  id: string,
): Promise<CashPreviewResponse> {
  return prisma.$transaction(async (db) => {
    await lockOrganization(db, scope);
    await authorize(db, scope);
    const preview = await buildPreview(db, scope, await findEvidence(db, scope, id));
    await recordAccess(db, scope, id, 'PREVIEW');
    return preview;
  }, transactionOptions);
}
export async function reviewCashEvidence(
  scope: CashScope,
  id: string,
  input: CashReviewInput,
): Promise<CashEvidenceResponse> {
  const parsed = CashReviewInputSchema.safeParse(input);
  if (!parsed.success)
    throw new ApiError('VALIDATION_ERROR', 'Check the review token, decision and idempotency key.');
  const body = parsed.data;
  const requestHash = digest([scope.organizationId, scope.userId, id, body]);
  return prisma.$transaction(async (db) => {
    await lockOrganization(db, scope);
    const role = await authorize(db, scope);
    const row = await findEvidence(db, scope, id);
    const replay = await db.cashSourceReview.findFirst({
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
        'This source observation has unresolved revision or replacement issues. Refresh the preview.',
      );
    const review = await db.cashSourceReview.create({
      data: {
        organizationId: scope.organizationId,
        transactionId: row.transactionId,
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
    await audit(
      {
        ...scope,
        action: 'cash.review',
        resourceType: 'CashSourceEvidence',
        resourceId: id,
        metadata: {
          transactionId: row.transactionId,
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
  kind: z.literal('TRANSACTIONS'),
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});
const HistoryCursorSchema = z.strictObject({
  organizationId: z.string(),
  kind: z.literal('HISTORY'),
  transactionId: z.uuid(),
  sourceSequence: z.number().int().positive(),
});
function decodeCursor<T>(schema: z.ZodType<T>, cursor: string | undefined): T | undefined {
  if (!cursor) return undefined;
  try {
    return schema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
  } catch {
    throw new ApiError('VALIDATION_ERROR', 'Invalid cash evidence cursor.');
  }
}
function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
type AccountRow = Omit<CashAccountResponse, 'bankVerification' | 'settlement' | 'postedNetAmount'>;
async function accountsForPage(
  db: Db,
  scope: CashScope,
  items: CashTransactionResponse[],
): Promise<CashAccountResponse[]> {
  const keys = new Map(
    items.map((item) => {
      const p = item.latestEvidence.payload;
      return [JSON.stringify([p.sourceNamespace, p.sourceAccountId]), p];
    }),
  );
  if (!keys.size) return [];
  const filter = Prisma.join(
    [...keys.values()].map(
      (key) =>
        Prisma.sql`(t."sourceNamespace"=${key.sourceNamespace} AND t."sourceAccountId"=${key.sourceAccountId})`,
    ),
    ' OR ',
  );
  // Each summary covers its whole account, but only accounts represented on this
  // transaction page are returned. No unbounded all-account response or total.
  const rows = await db.$queryRaw<AccountRow[]>(Prisma.sql`
    WITH states AS (
      SELECT t."sourceSystem",t."sourceProduct",t."sourceNamespace",t."sourceAccountId",
        l."sourceSequence" AS latest_sequence, l.reviewed AS latest_reviewed,
        a."sourceSequence" AS accepted_sequence,a.status,a.amount
      FROM "CashSourceTransaction" t
      JOIN LATERAL (
        SELECT e."sourceSequence", EXISTS(SELECT 1 FROM "CashSourceReview" r WHERE r."organizationId"=${scope.organizationId} AND r."evidenceId"=e.id) AS reviewed
        FROM "CashSourceEvidence" e WHERE e."organizationId"=${scope.organizationId} AND e."transactionId"=t.id ORDER BY e."sourceSequence" DESC LIMIT 1
      ) l ON true
      LEFT JOIN LATERAL (
        SELECT e."sourceSequence",e.status,e.amount FROM "CashSourceReview" r
        JOIN "CashSourceEvidence" e ON e.id=r."evidenceId" AND e."organizationId"=r."organizationId" AND e."transactionId"=r."transactionId"
        WHERE r."organizationId"=${scope.organizationId} AND r."transactionId"=t.id AND r.decision='ACCEPT' ORDER BY r."sourceSequence" DESC LIMIT 1
      ) a ON true
      WHERE t."organizationId"=${scope.organizationId} AND (${filter})
    ) SELECT "sourceSystem","sourceProduct","sourceNamespace","sourceAccountId",
      (COALESCE(SUM(amount) FILTER(WHERE accepted_sequence=latest_sequence AND status='POSTED' AND amount>0),0)::numeric(30,2))::text AS "postedCreditAmount",
      (COALESCE(-SUM(amount) FILTER(WHERE accepted_sequence=latest_sequence AND status='POSTED' AND amount<0),0)::numeric(30,2))::text AS "postedDebitAmount",
      count(*)::int AS "transactionCount",
      count(*) FILTER(WHERE accepted_sequence=latest_sequence AND status='POSTED')::int AS "postedCount",
      count(*) FILTER(WHERE accepted_sequence=latest_sequence AND status='PENDING')::int AS "pendingCount",
      count(*) FILTER(WHERE accepted_sequence=latest_sequence AND status='REMOVED')::int AS "removedCount",
      count(*) FILTER(WHERE accepted_sequence=latest_sequence AND status='UNKNOWN')::int AS "unknownCount",
      count(*) FILTER(WHERE accepted_sequence IS NULL)::int AS "unreviewedCount",
      count(*) FILTER(WHERE accepted_sequence<latest_sequence)::int AS "staleCount",
      count(*) FILTER(WHERE NOT latest_reviewed)::int AS "reviewNeededCount"
      FROM states GROUP BY "sourceSystem","sourceProduct","sourceNamespace","sourceAccountId"
      ORDER BY "sourceNamespace","sourceAccountId"`);
  return rows.map((row) =>
    CashAccountSchema.parse({
      ...row,
      postedNetAmount: moneyString(
        moneyCents(row.postedCreditAmount) - moneyCents(row.postedDebitAmount),
      ),
      bankVerification: 'UNVERIFIED',
      settlement: 'UNVERIFIED',
    }),
  );
}
export async function listCashEvidence(
  scope: CashScope,
  limit: number,
  cursor?: string,
): Promise<z.infer<typeof CashListSchema>> {
  const page = decodeCursor(ListCursorSchema, cursor);
  if (page && page.organizationId !== scope.organizationId)
    throw new ApiError('VALIDATION_ERROR', 'Invalid cash evidence cursor.');
  return prisma.$transaction(
    async (db) => {
      await authorize(db, scope);
      const rows = await db.cashSourceTransaction.findMany({
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
      const items: CashTransactionResponse[] = [];
      // Reserve 4KiB per possible account summary plus envelope/cursor headroom.
      let bytes = 4096 + Math.min(limit, pageLimit) * 4096;
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
      const result = CashListSchema.parse({
        items,
        accounts: await accountsForPage(db, scope, items),
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({
                organizationId: scope.organizationId,
                kind: 'TRANSACTIONS',
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
export async function cashEvidenceHistory(
  scope: CashScope,
  transactionId: string,
  limit: number,
  cursor?: string,
): Promise<z.infer<typeof CashHistorySchema>> {
  const page = decodeCursor(HistoryCursorSchema, cursor);
  if (
    page &&
    (page.organizationId !== scope.organizationId || page.transactionId !== transactionId)
  )
    throw new ApiError('VALIDATION_ERROR', 'Invalid cash evidence cursor.');
  return prisma.$transaction(
    async (db) => {
      await authorize(db, scope);
      const transaction = await context(db, scope, await findTransaction(db, scope, transactionId));
      const rows = await db.cashSourceEvidence.findMany({
        where: {
          organizationId: scope.organizationId,
          transactionId,
          ...(page ? { sourceSequence: { lt: page.sourceSequence } } : {}),
        },
        orderBy: { sourceSequence: 'desc' },
        include: evidenceInclude,
        take: Math.min(limit, pageLimit) + 1,
      });
      const items: CashEvidenceResponse[] = [];
      let bytes = Buffer.byteLength(JSON.stringify(transaction), 'utf8') + 4096;
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
      await recordAccess(db, scope, transactionId, 'HISTORY', items.length);
      return CashHistorySchema.parse({
        transaction,
        items,
        hasMore,
        nextCursor:
          hasMore && last
            ? encodeCursor({
                organizationId: scope.organizationId,
                kind: 'HISTORY',
                transactionId,
                sourceSequence: last.payload.sourceSequence,
              })
            : null,
      });
    },
    { ...transactionOptions, isolationLevel: 'RepeatableRead' },
  );
}
