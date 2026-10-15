import { createHash } from 'node:crypto';

import { audit, prisma, type Prisma, type UserRole } from '@dentabill/db';
import { ApiError } from '@dentabill/types';
import { z } from 'zod';

import { CashInputSchema } from '../cash-evidence/contract.js';
import { BatchInputSchema } from '../remittance-batches/contract.js';
import { moneyCents, moneyString } from '../remittances/contract.js';

import {
  CashMatchListSchema,
  CashMatchReceiptSchema,
  CashMatchSchema,
  MatchCandidateSchema,
  MatchDecisionSchema,
  MatchPreviewSchema,
  ReleaseCandidateSchema,
  ReleaseDecisionSchema,
  ReleasePreviewSchema,
  ReleaseReceiptSchema,
  type BatchBinding,
  type CashBinding,
  type CashMatchReceipt,
  type CashMatchResponse,
  type MatchBlocker,
  type MatchCandidate,
  type MatchDecision,
  type MatchPreview,
  type ReleaseDecision,
  type ReleasePreview,
  type ReleaseReceipt,
} from './contract.js';

export interface ReconciliationScope {
  readonly organizationId: string;
  readonly userId: string;
}
type Db = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type MatchRow = Prisma.CashBatchMatchGetPayload<{ include: { release: true } }>;
const includeMatch = { release: true } as const;
const transactionOptions = { maxWait: 5000, timeout: 30000 } as const;
const financialState = {
  provenance: 'MANUAL_REVIEW',
  bankVerification: 'UNVERIFIED',
  posting: 'UNVERIFIED',
  settlement: 'UNVERIFIED',
  claimCashAllocation: 'UNALLOCATED',
} as const;
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function magnitude(value: bigint): bigint {
  return value < 0n ? -value : value;
}
function remaining(total: bigint, reserved: bigint): bigint {
  return magnitude(total) > reserved ? magnitude(total) - reserved : 0n;
}
function conflict(message: string): never {
  throw new ApiError('CONFLICT', message);
}
export function safeReconciliationError(error: unknown): never {
  if (ApiError.isApiError(error)) throw error;
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    ['P2002', 'P2034'].includes(String(error.code))
  )
    conflict('The source or matching reservations changed. Refresh the preview.');
  throw new ApiError(
    'INTERNAL_ERROR',
    'Reconciliation could not be completed. Retry the same request or refresh the evidence.',
  );
}
async function authorize(db: Db, scope: ReconciliationScope): Promise<UserRole> {
  const actor = await db.user.findFirst({
    where: { id: scope.userId, organizationId: scope.organizationId },
    select: { role: true },
  });
  if (!actor || !['OWNER', 'ADMIN', 'BILLING_STAFF'].includes(actor.role))
    throw new ApiError('FORBIDDEN', 'Your stored practice role cannot review reconciliation.');
  return actor.role;
}
async function lockOrganization(db: Db, scope: ReconciliationScope): Promise<void> {
  const count =
    await db.$executeRaw`UPDATE "Organization" SET id=id WHERE id=${scope.organizationId}`;
  if (!count) throw new ApiError('NOT_FOUND', 'Practice not found.');
}
async function ledgerVersion(db: Db, scope: ReconciliationScope): Promise<string> {
  const where = { organizationId: scope.organizationId };
  const counts = await Promise.all([
    db.cashSourceEvidence.count({ where }),
    db.cashSourceReview.count({ where }),
    db.remittanceBatchEvidence.count({ where }),
    db.remittanceBatchReview.count({ where }),
    db.cashBatchMatch.count({ where }),
    db.cashBatchRelease.count({ where }),
  ]);
  return counts.join(':');
}
async function recordAccess(
  db: Db,
  scope: ReconciliationScope,
  resourceId: string,
  accessKind: string,
  resultCount = 1,
): Promise<void> {
  await audit(
    {
      ...scope,
      action: 'reconciliation.read',
      resourceType:
        accessKind === 'LIST' || accessKind === 'MATCH_PREVIEW'
          ? 'Organization'
          : accessKind === 'RELEASE_REPLAY'
            ? 'CashBatchRelease'
            : 'CashBatchMatch',
      resourceId,
      metadata: { accessKind, resultCount },
    },
    db,
  );
}
async function findMatch(db: Db, scope: ReconciliationScope, id: string): Promise<MatchRow> {
  const row = await db.cashBatchMatch.findFirst({
    where: { id, organizationId: scope.organizationId },
    include: includeMatch,
  });
  if (!row) throw new ApiError('NOT_FOUND', 'Source match not found in your practice.');
  return row;
}
function matchReceipt(
  row: Prisma.CashBatchMatchGetPayload<Record<string, never>>,
): CashMatchReceipt {
  return CashMatchReceiptSchema.parse({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    reviewedByUserId: row.reviewedByUserId,
    reviewedByRole: row.reviewedByRole,
    cashTransactionId: row.cashTransactionId,
    cashEvidenceId: row.cashEvidenceId,
    cashReviewId: row.cashReviewId,
    batchEvidenceId: row.batchEvidenceId,
    batchReviewId: row.batchReviewId,
    amount: row.amount.toFixed(2),
    ...financialState,
  });
}
function releaseReceipt(
  row: Prisma.CashBatchReleaseGetPayload<Record<string, never>>,
): ReleaseReceipt {
  return ReleaseReceiptSchema.parse({
    id: row.id,
    matchId: row.matchId,
    createdAt: row.createdAt.toISOString(),
    reviewedByUserId: row.reviewedByUserId,
    reviewedByRole: row.reviewedByRole,
    reason: row.reason,
  });
}

async function sourceContext(
  db: Db,
  scope: ReconciliationScope,
  candidate: MatchCandidate,
  excludeMatchId?: string,
): Promise<{
  cash: CashBinding;
  batch: BatchBinding;
  blockers: MatchBlocker[];
  capacity: MatchPreview['capacity'];
  component: (string | null)[];
}> {
  const cashRow = await db.cashSourceEvidence.findFirst({
    where: { id: candidate.cashEvidenceId, organizationId: scope.organizationId },
    include: { transaction: true, review: true },
  });
  const batchRow = await db.remittanceBatchEvidence.findFirst({
    where: { id: candidate.batchEvidenceId, organizationId: scope.organizationId },
    include: { review: true, revision: true },
  });
  if (!cashRow || !batchRow)
    throw new ApiError('NOT_FOUND', 'Source evidence not found in your practice.');
  if (!batchRow.revision)
    throw new ApiError('INTERNAL_ERROR', 'Batch source history is unavailable.');
  const where = { organizationId: scope.organizationId, transactionId: cashRow.transactionId };
  const batchWhere = {
    organizationId: scope.organizationId,
    batchId: batchRow.revision.batchId,
  };
  const batchOrder = { sourceSequence: { sort: 'desc', nulls: 'last' } } as const;
  const [latest, accepted, latestBatch, acceptedBatch] = await Promise.all([
    db.cashSourceEvidence.findFirst({ where, orderBy: { sourceSequence: 'desc' } }),
    db.cashSourceEvidence.findFirst({
      where: { ...where, review: { decision: 'ACCEPT' } },
      orderBy: { sourceSequence: 'desc' },
    }),
    db.remittanceBatchRevision.findFirst({ where: batchWhere, orderBy: batchOrder }),
    db.remittanceBatchRevision.findFirst({
      where: { ...batchWhere, evidence: { review: { decision: 'ACCEPT' } } },
      orderBy: batchOrder,
    }),
  ]);
  if (!latest) throw new ApiError('INTERNAL_ERROR', 'Cash source history is unavailable.');
  if (!latestBatch) throw new ApiError('INTERNAL_ERROR', 'Batch source history is unavailable.');
  const cashPayload = CashInputSchema.parse(cashRow.payload);
  const batchPayload = BatchInputSchema.parse(batchRow.payload);
  const cash: CashBinding = {
    transactionId: cashRow.transactionId,
    evidenceId: cashRow.id,
    reviewId: cashRow.review?.id ?? null,
    reviewDecision: (cashRow.review?.decision as 'ACCEPT' | 'REJECT' | undefined) ?? null,
    contentHash: cashRow.contentHash,
    sourceSystem: cashRow.transaction.sourceSystem,
    sourceProduct: cashRow.transaction.sourceProduct,
    sourceNamespace: cashRow.sourceNamespace,
    sourceAccountId: cashRow.sourceAccountId,
    sourceTransactionId: cashRow.transaction.sourceTransactionId,
    sourceRecordId: cashRow.sourceRecordId,
    sourceSequence: cashRow.sourceSequence,
    sourceDocumentId: cashRow.sourceDocumentId,
    latestEvidenceId: latest.id,
    latestSourceSequence: latest.sourceSequence,
    currentAcceptedEvidenceId: accepted?.id ?? null,
    status: cashPayload.status,
    amount: cashRow.amount?.toFixed(2) ?? null,
    sourceAmount: cashPayload.sourceAmount,
    sourceSignConvention: cashPayload.sourceSignConvention,
    currency: 'USD',
    postingDate: cashPayload.postingDate,
    paymentTrace: cashPayload.paymentTrace,
    pendingSourceTransactionId: cashPayload.pendingSourceTransactionId,
  };
  const batch: BatchBinding = {
    batchId: batchRow.revision.batchId,
    evidenceId: batchRow.id,
    schemaVersion: batchPayload.schemaVersion,
    sourceSequence: batchRow.revision.sourceSequence,
    reviewId: batchRow.review?.id ?? null,
    reviewDecision: (batchRow.review?.decision as 'ACCEPT' | 'REJECT' | undefined) ?? null,
    contentHash: batchRow.contentHash,
    sourceNamespace: batchRow.sourceNamespace,
    sourceBatchId: batchRow.sourceBatchId,
    sourceRecordId: batchRow.sourceRecordId,
    sourceDocumentId: batchRow.sourceDocumentId,
    latestEvidenceId: latestBatch.evidenceId,
    latestSourceSequence: latestBatch.sourceSequence,
    latestAcceptedEvidenceId: acceptedBatch?.evidenceId ?? null,
    payerName: batchPayload.payerName,
    claimReportedAmount: batchPayload.reportedClaimAmount,
    providerAdjustmentAmount: batchPayload.reportedAdjustmentAmount,
    netAmount: batchPayload.reportedNetAmount,
    currency: 'USD',
    paymentTrace: batchPayload.paymentTrace,
  };
  const blockers: MatchBlocker[] = [];
  if (cashRow.review?.decision !== 'ACCEPT') blockers.push('CASH_NOT_ACCEPTED');
  if (latest.id !== cashRow.id || accepted?.id !== cashRow.id) blockers.push('CASH_NOT_CURRENT');
  if (cashRow.status !== 'POSTED' || cashRow.amount === null) blockers.push('CASH_NOT_POSTED');
  if (cash.amount === '0.00') blockers.push('CASH_ZERO_AMOUNT');
  if (batchRow.review?.decision !== 'ACCEPT' || batch.netAmount === null)
    blockers.push('BATCH_NOT_ACCEPTED');
  if (latestBatch.evidenceId !== batchRow.id || acceptedBatch?.evidenceId !== batchRow.id)
    blockers.push('BATCH_NOT_CURRENT');
  if (batch.netAmount === '0.00') blockers.push('BATCH_ZERO_NET');
  const component = await db.$queryRaw<
    { transaction_id: string | null; source_id: string | null; overflow: boolean }[]
  >`
    SELECT * FROM dentabill_cash_match_component(${scope.organizationId}, ${cashRow.transactionId}::uuid)
  `;
  const overflow = component.some((node) => node.overflow);
  if (overflow) blockers.push('SOURCE_LINK_LIMIT');
  const transactionIds = component.flatMap((node) =>
    node.transaction_id ? [node.transaction_id] : [],
  );
  const conflicting = transactionIds.length
    ? await db.cashBatchMatch.findFirst({
        where: {
          organizationId: scope.organizationId,
          cashTransactionId: { in: transactionIds },
          cashEvidenceId: { not: cashRow.id },
          release: { is: null },
        },
        select: { cashTransactionId: true },
      })
    : null;
  if (conflicting)
    blockers.push(
      conflicting.cashTransactionId === cashRow.transactionId
        ? 'STALE_CASH_RESERVATION'
        : 'CASH_IDENTITY_CONFLICT',
    );
  const [reserved] = await db.$queryRaw<
    { cash: Prisma.Decimal; batch: Prisma.Decimal; staleBatch: boolean }[]
  >`
    SELECT
      COALESCE((SELECT sum(abs(m.amount)) FROM "CashBatchMatch" m
        WHERE m."organizationId"=${scope.organizationId} AND m."cashTransactionId"=${cashRow.transactionId}::uuid
        AND (${excludeMatchId ?? null}::uuid IS NULL OR m.id<>${excludeMatchId ?? null}::uuid)
        AND NOT EXISTS (SELECT 1 FROM "CashBatchRelease" r WHERE r."organizationId"=m."organizationId" AND r."matchId"=m.id)),0)::numeric AS cash,
      COALESCE((SELECT sum(abs(m.amount)) FROM "CashBatchMatch" m
        JOIN "RemittanceBatchRevision" v ON v."evidenceId"=m."batchEvidenceId" AND v."organizationId"=m."organizationId"
        WHERE m."organizationId"=${scope.organizationId} AND v."batchId"=${batchRow.revision.batchId}::uuid
        AND (${excludeMatchId ?? null}::uuid IS NULL OR m.id<>${excludeMatchId ?? null}::uuid)
        AND NOT EXISTS (SELECT 1 FROM "CashBatchRelease" r WHERE r."organizationId"=m."organizationId" AND r."matchId"=m.id)),0)::numeric AS batch,
      EXISTS (SELECT 1 FROM "CashBatchMatch" m
        JOIN "RemittanceBatchRevision" v ON v."evidenceId"=m."batchEvidenceId" AND v."organizationId"=m."organizationId"
        WHERE m."organizationId"=${scope.organizationId} AND v."batchId"=${batchRow.revision.batchId}::uuid
        AND m."batchEvidenceId"<>${batchRow.id}::uuid
        AND NOT EXISTS (SELECT 1 FROM "CashBatchRelease" r WHERE r."organizationId"=m."organizationId" AND r."matchId"=m.id)) AS "staleBatch"
  `;
  if (!reserved) throw new ApiError('INTERNAL_ERROR', 'Source capacities are unavailable.');
  if (reserved.staleBatch) blockers.push('STALE_BATCH_RESERVATION');
  const cashReserved = moneyCents(reserved.cash.toFixed(2));
  const batchReserved = moneyCents(reserved.batch.toFixed(2));
  const cashAmount = cash.amount === null ? null : moneyCents(cash.amount);
  const batchAmount = batch.netAmount === null ? null : moneyCents(batch.netAmount);
  const proposed = moneyCents(candidate.amount);
  if (
    (cashAmount !== null && cashAmount !== 0n && cashAmount > 0n !== proposed > 0n) ||
    (batchAmount !== null && batchAmount !== 0n && batchAmount > 0n !== proposed > 0n)
  )
    blockers.push('DIRECTION_MISMATCH');
  const cashAvailable =
    cashAmount !== null &&
    !blockers.some((blocker) =>
      [
        'CASH_NOT_ACCEPTED',
        'CASH_NOT_CURRENT',
        'CASH_NOT_POSTED',
        'STALE_CASH_RESERVATION',
        'CASH_IDENTITY_CONFLICT',
        'SOURCE_LINK_LIMIT',
      ].includes(blocker),
    )
      ? remaining(cashAmount, cashReserved)
      : null;
  const batchAvailable =
    batchAmount !== null &&
    !blockers.some((blocker) =>
      ['BATCH_NOT_ACCEPTED', 'BATCH_NOT_CURRENT', 'STALE_BATCH_RESERVATION'].includes(blocker),
    )
      ? remaining(batchAmount, batchReserved)
      : null;
  if (cashAvailable !== null && magnitude(proposed) > cashAvailable)
    blockers.push('CASH_CAPACITY_EXCEEDED');
  if (batchAvailable !== null && magnitude(proposed) > batchAvailable)
    blockers.push('BATCH_CAPACITY_EXCEEDED');
  return {
    cash,
    batch,
    blockers,
    component: component.map((node) => node.source_id).sort(),
    capacity: {
      cashReservedMagnitude: moneyString(cashReserved),
      cashAvailableMagnitude: cashAvailable === null ? null : moneyString(cashAvailable),
      batchReservedMagnitude: moneyString(batchReserved),
      batchAvailableMagnitude: batchAvailable === null ? null : moneyString(batchAvailable),
    },
  };
}

async function buildMatchPreview(
  db: Db,
  scope: ReconciliationScope,
  candidate: MatchCandidate,
): Promise<MatchPreview> {
  const context = await sourceContext(db, scope, candidate);
  const version = await ledgerVersion(db, scope);
  return MatchPreviewSchema.parse({
    candidate,
    cash: context.cash,
    batch: context.batch,
    capacity: context.capacity,
    blockers: context.blockers,
    ledgerVersion: version,
    reviewToken: digest(['cash-batch-match-v2', scope.organizationId, candidate, context, version]),
    ...financialState,
  });
}
async function matchResponse(
  db: Db,
  scope: ReconciliationScope,
  row: MatchRow,
): Promise<CashMatchResponse> {
  const context = await sourceContext(
    db,
    scope,
    {
      cashEvidenceId: row.cashEvidenceId,
      batchEvidenceId: row.batchEvidenceId,
      amount: row.amount.toFixed(2),
    },
    row.id,
  );
  return CashMatchSchema.parse({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    reviewedByUserId: row.reviewedByUserId,
    reviewedByRole: row.reviewedByRole,
    amount: row.amount.toFixed(2),
    cash: context.cash,
    batch: context.batch,
    status: row.release ? 'RELEASED' : context.blockers.length ? 'STALE' : 'CURRENT',
    blockers: row.release ? [] : context.blockers,
    release: row.release
      ? {
          id: row.release.id,
          createdAt: row.release.createdAt.toISOString(),
          reviewedByUserId: row.release.reviewedByUserId,
          reviewedByRole: row.release.reviewedByRole,
          reason: row.release.reason,
        }
      : null,
    ...financialState,
  });
}
export async function previewMatch(
  scope: ReconciliationScope,
  input: unknown,
): Promise<MatchPreview> {
  const parsed = MatchCandidateSchema.safeParse(input);
  if (!parsed.success)
    throw new ApiError(
      'VALIDATION_ERROR',
      'Choose both sources and a signed nonzero amount with two decimal places.',
    );
  return prisma.$transaction(async (db) => {
    await lockOrganization(db, scope);
    await authorize(db, scope);
    const result = await buildMatchPreview(db, scope, parsed.data);
    await recordAccess(db, scope, scope.organizationId, 'MATCH_PREVIEW');
    return result;
  }, transactionOptions);
}
export async function createMatch(
  scope: ReconciliationScope,
  input: MatchDecision,
): Promise<{ created: boolean; receipt: CashMatchReceipt }> {
  const parsed = MatchDecisionSchema.safeParse(input);
  if (!parsed.success)
    throw new ApiError('VALIDATION_ERROR', 'Check the exact match, preview and retry key.');
  const body = parsed.data;
  const requestHash = digest([
    'cash-batch-match-request-v1',
    scope.organizationId,
    scope.userId,
    body,
  ]);
  return prisma.$transaction(async (db) => {
    await lockOrganization(db, scope);
    const role = await authorize(db, scope);
    const replay = await db.cashBatchMatch.findFirst({
      where: { organizationId: scope.organizationId, idempotencyKey: body.idempotencyKey },
    });
    if (replay) {
      if (replay.requestHash !== requestHash)
        conflict('This retry key belongs to a different match decision.');
      await recordAccess(db, scope, replay.id, 'MATCH_REPLAY');
      return { created: false, receipt: matchReceipt(replay) };
    }
    const candidate = {
      cashEvidenceId: body.cashEvidenceId,
      batchEvidenceId: body.batchEvidenceId,
      amount: body.amount,
    };
    const preview = await buildMatchPreview(db, scope, candidate);
    if (preview.reviewToken !== body.reviewToken)
      conflict('Source evidence or matching reservations changed. Refresh and review the preview.');
    if (preview.blockers.length || !preview.cash.reviewId || !preview.batch.reviewId)
      conflict(
        'This source match is blocked. Review the source states, direction and available capacities.',
      );
    const row = await db.cashBatchMatch.create({
      data: {
        organizationId: scope.organizationId,
        cashTransactionId: preview.cash.transactionId,
        cashEvidenceId: preview.cash.evidenceId,
        cashReviewId: preview.cash.reviewId,
        batchEvidenceId: preview.batch.evidenceId,
        batchReviewId: preview.batch.reviewId,
        amount: body.amount,
        reviewedByUserId: scope.userId,
        reviewedByRole: role,
        idempotencyKey: body.idempotencyKey,
        requestHash,
        reviewToken: body.reviewToken,
        ledgerVersion: preview.ledgerVersion,
        cashEvidenceHash: preview.cash.contentHash,
        batchEvidenceHash: preview.batch.contentHash,
      },
    });
    await audit(
      {
        ...scope,
        action: 'reconciliation.match',
        resourceType: 'CashBatchMatch',
        resourceId: row.id,
        metadata: { decision: 'MATCH' },
      },
      db,
    );
    return { created: true, receipt: matchReceipt(row) };
  }, transactionOptions);
}

async function buildReleasePreview(
  db: Db,
  scope: ReconciliationScope,
  row: MatchRow,
  reason: ReleaseDecision['reason'],
): Promise<ReleasePreview> {
  const version = await ledgerVersion(db, scope);
  return ReleasePreviewSchema.parse({
    match: matchReceipt(row),
    reason,
    release: row.release
      ? {
          id: row.release.id,
          createdAt: row.release.createdAt.toISOString(),
          reviewedByUserId: row.release.reviewedByUserId,
          reviewedByRole: row.release.reviewedByRole,
          reason: row.release.reason,
        }
      : null,
    canRelease: !row.release,
    ledgerVersion: version,
    reviewToken: digest([
      'cash-batch-release-v1',
      scope.organizationId,
      row.id,
      row.requestHash,
      row.release?.id ?? null,
      reason,
      version,
    ]),
  });
}
export async function previewRelease(
  scope: ReconciliationScope,
  id: string,
  input: unknown,
): Promise<ReleasePreview> {
  const parsed = ReleaseCandidateSchema.safeParse(input);
  if (!parsed.success)
    throw new ApiError('VALIDATION_ERROR', 'Choose a reason for releasing the source match.');
  return prisma.$transaction(async (db) => {
    await lockOrganization(db, scope);
    await authorize(db, scope);
    const result = await buildReleasePreview(
      db,
      scope,
      await findMatch(db, scope, id),
      parsed.data.reason,
    );
    await recordAccess(db, scope, id, 'RELEASE_PREVIEW');
    return result;
  }, transactionOptions);
}
export async function releaseMatch(
  scope: ReconciliationScope,
  id: string,
  input: ReleaseDecision,
): Promise<{ created: boolean; receipt: ReleaseReceipt }> {
  const parsed = ReleaseDecisionSchema.safeParse(input);
  if (!parsed.success)
    throw new ApiError('VALIDATION_ERROR', 'Check the release reason, preview and retry key.');
  const body = parsed.data;
  const requestHash = digest([
    'cash-batch-release-request-v1',
    scope.organizationId,
    scope.userId,
    id,
    body,
  ]);
  return prisma.$transaction(async (db) => {
    await lockOrganization(db, scope);
    const role = await authorize(db, scope);
    const replay = await db.cashBatchRelease.findFirst({
      where: { organizationId: scope.organizationId, idempotencyKey: body.idempotencyKey },
    });
    if (replay) {
      if (replay.requestHash !== requestHash)
        conflict('This retry key belongs to a different release decision.');
      await recordAccess(db, scope, replay.id, 'RELEASE_REPLAY');
      return { created: false, receipt: releaseReceipt(replay) };
    }
    const row = await findMatch(db, scope, id);
    const version = await ledgerVersion(db, scope);
    const expected = digest([
      'cash-batch-release-v1',
      scope.organizationId,
      row.id,
      row.requestHash,
      row.release?.id ?? null,
      body.reason,
      version,
    ]);
    if (row.release || expected !== body.reviewToken)
      conflict('This match or the source ledger changed. Refresh the release preview.');
    const released = await db.cashBatchRelease.create({
      data: {
        organizationId: scope.organizationId,
        matchId: row.id,
        reviewedByUserId: scope.userId,
        reviewedByRole: role,
        reason: body.reason,
        idempotencyKey: body.idempotencyKey,
        requestHash,
        reviewToken: body.reviewToken,
        ledgerVersion: version,
        matchRequestHash: row.requestHash,
      },
    });
    await audit(
      {
        ...scope,
        action: 'reconciliation.release',
        resourceType: 'CashBatchRelease',
        resourceId: released.id,
        metadata: { matchId: row.id, reason: body.reason },
      },
      db,
    );
    return { created: true, receipt: releaseReceipt(released) };
  }, transactionOptions);
}

const CursorSchema = z.strictObject({
  organizationId: z.string(),
  createdAt: z.iso.datetime(),
  id: z.uuid(),
});
export async function listMatches(
  scope: ReconciliationScope,
  limit: number,
  cursor?: string,
): Promise<z.infer<typeof CashMatchListSchema>> {
  let page: z.infer<typeof CursorSchema> | undefined;
  if (cursor) {
    try {
      page = CursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    } catch {
      throw new ApiError('VALIDATION_ERROR', 'Invalid source matching cursor.');
    }
    if (page.organizationId !== scope.organizationId)
      throw new ApiError('VALIDATION_ERROR', 'Invalid source matching cursor.');
  }
  return prisma.$transaction(
    async (db) => {
      await authorize(db, scope);
      const rows = await db.cashBatchMatch.findMany({
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
        include: includeMatch,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: Math.min(limit, 20) + 1,
      });
      const items: CashMatchResponse[] = [];
      let bytes = 4096;
      for (const row of rows.slice(0, Math.min(limit, 20))) {
        const item = await matchResponse(db, scope, row);
        const size = Buffer.byteLength(JSON.stringify(item), 'utf8') + 1;
        if (bytes + size > 2 * 1024 * 1024) break;
        items.push(item);
        bytes += size;
      }
      if (rows.length && !items.length)
        throw new ApiError('INTERNAL_ERROR', 'This source match exceeds the supported page size.');
      const last = items.at(-1);
      const hasMore = rows.length > items.length;
      const result = CashMatchListSchema.parse({
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
