import { createHash } from 'node:crypto';

import { audit, prisma, type Prisma, type UserRole } from '@dentabill/db';
import { ApiError } from '@dentabill/types';
import { z } from 'zod';

import { PostingInputSchema, type PostingInput } from '../posting-evidence/contract.js';

import {
  RelationshipCandidateSchema,
  RelationshipDecisionSchema,
  RelationshipListSchema,
  RelationshipPreviewSchema,
  RelationshipReceiptSchema,
  RelationshipReleaseCandidateSchema,
  RelationshipReleaseDecisionSchema,
  RelationshipReleasePreviewSchema,
  RelationshipReleaseReceiptSchema,
  RelationshipSchema,
  RelationshipTargetsSchema,
  type RelationshipBlocker,
  type RelationshipCandidate,
  type RelationshipClaim,
  type RelationshipDecision,
  type RelationshipPreview,
  type RelationshipReceipt,
  type RelationshipReleaseDecision,
  type RelationshipReleasePreview,
  type RelationshipReleaseReceipt,
  type RelationshipResponse,
  type RelationshipSource,
} from './contract.js';

export interface RelationshipScope {
  readonly organizationId: string;
  readonly userId: string;
}
type Db = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
const evidenceInclude = { receipt: true, review: { include: { entries: true } } } as const;
type Evidence = Prisma.PostingSourceEvidenceGetPayload<{ include: typeof evidenceInclude }>;
const relationshipInclude = { release: true } as const;
type Relationship = Prisma.PostingClaimRelationshipGetPayload<{
  include: typeof relationshipInclude;
}>;
const lineSelect = {
  id: true,
  sourceLineId: true,
  sourceProcedureId: true,
  procedureCode: true,
  serviceDate: true,
  billedAmount: true,
} as const;
const claimSelect = {
  id: true,
  claimNumber: true,
  updatedAt: true,
  sourceSystem: true,
  sourceNamespace: true,
  sourceClaimId: true,
  sourceVersion: true,
  sourceContentHash: true,
  sourceDetails: { select: { lines: { select: lineSelect } } },
} as const;
type Claim = Prisma.ClaimGetPayload<{ select: typeof claimSelect }>;
const transactionOptions = { maxWait: 5000, timeout: 30000 } as const;
const financialState = {
  provenance: 'MANUAL_REVIEW',
  relationshipBasis: 'EXACT_SOURCE_IDENTITY',
  sourceVerification: 'UNVERIFIED',
  bankVerification: 'UNVERIFIED',
  settlement: 'UNVERIFIED',
  claimCashAllocation: 'UNALLOCATED',
} as const;
const supportedSystems = ['DENTRIX', 'EAGLESOFT', 'OPEN_DENTAL'];
interface SourceBundle {
  row: Evidence;
  payload: PostingInput;
  latest: { id: string; sourceSequence: number };
  acceptedId: string | null;
  reservations: { id: string; sourceEntryId: string }[];
}
function digest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function conflict(message: string): never {
  throw new ApiError('CONFLICT', message);
}
export function safeRelationshipError(error: unknown): never {
  if (ApiError.isApiError(error)) throw error;
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    ['P2002', 'P2034'].includes(String(error.code))
  )
    conflict('The source, claim or existing links changed. Refresh the preview.');
  throw new ApiError(
    'INTERNAL_ERROR',
    'Posting relationships could not be completed. Retry the same request or refresh the evidence.',
  );
}
async function authorize(db: Db, scope: RelationshipScope): Promise<UserRole> {
  const actor = await db.user.findFirst({
    where: { id: scope.userId, organizationId: scope.organizationId },
    select: { role: true },
  });
  if (!actor || !['OWNER', 'ADMIN', 'BILLING_STAFF'].includes(actor.role))
    throw new ApiError(
      'FORBIDDEN',
      'Your stored practice role cannot review posting relationships.',
    );
  return actor.role;
}
async function lockOrganization(db: Db, scope: RelationshipScope): Promise<void> {
  const count =
    await db.$executeRaw`UPDATE "Organization" SET id=id WHERE id=${scope.organizationId}`;
  if (!count) throw new ApiError('NOT_FOUND', 'Practice not found.');
}
async function lockClaim(db: Db, scope: RelationshipScope, claimId: string): Promise<void> {
  const count =
    await db.$executeRaw`UPDATE "Claim" SET id=id WHERE id=${claimId} AND "organizationId"=${scope.organizationId}`;
  if (!count) throw new ApiError('NOT_FOUND', 'Claim not found in your practice.');
}
async function ledgerVersion(db: Db, scope: RelationshipScope): Promise<string> {
  const [row] = await db.$queryRaw<{ version: string }[]>`
    SELECT dentabill_posting_claim_ledger(${scope.organizationId}) AS version`;
  if (!row) throw new ApiError('INTERNAL_ERROR', 'Posting relationship history is unavailable.');
  return row.version;
}
async function recordAccess(
  db: Db,
  scope: RelationshipScope,
  resourceId: string,
  accessKind: string,
  resultCount = 1,
): Promise<void> {
  await audit(
    {
      ...scope,
      action: 'posting.relationship.read',
      resourceType: ['LIST', 'TARGETS', 'PREVIEW'].includes(accessKind)
        ? 'Organization'
        : accessKind === 'RELEASE_REPLAY'
          ? 'PostingClaimRelease'
          : 'PostingClaimRelationship',
      resourceId,
      metadata: { accessKind, resultCount },
    },
    db,
  );
}
async function sourceBundle(
  db: Db,
  scope: RelationshipScope,
  evidenceId: string,
): Promise<SourceBundle> {
  const row = await db.postingSourceEvidence.findFirst({
    where: { id: evidenceId, organizationId: scope.organizationId },
    include: evidenceInclude,
  });
  if (!row) throw new ApiError('NOT_FOUND', 'Posting evidence not found in your practice.');
  const payload = PostingInputSchema.parse(row.payload);
  const where = { organizationId: scope.organizationId, receiptId: row.receiptId };
  const [latest, accepted, reservations] = await Promise.all([
    db.postingSourceEvidence.findFirst({
      where,
      orderBy: { sourceSequence: 'desc' },
      select: { id: true, sourceSequence: true },
    }),
    db.postingSourceEvidence.findFirst({
      where: { ...where, review: { decision: 'ACCEPT' } },
      orderBy: { sourceSequence: 'desc' },
      select: { id: true },
    }),
    db.postingClaimRelationship.findMany({
      where: {
        organizationId: scope.organizationId,
        sourceSystem: payload.sourceSystem,
        sourceNamespace: payload.sourceNamespace,
        sourceEntryId: { in: payload.entries.map((entry) => entry.sourceEntryId) },
        release: null,
      },
      select: { id: true, sourceEntryId: true },
    }),
  ]);
  if (!latest) throw new ApiError('INTERNAL_ERROR', 'Posting source history is unavailable.');
  return { row, payload, latest, acceptedId: accepted?.id ?? null, reservations };
}
function sourceBinding(bundle: SourceBundle, sourceEntryId: string): RelationshipSource {
  const { row, payload, latest, acceptedId } = bundle;
  const entry = payload.entries.find((item) => item.sourceEntryId === sourceEntryId);
  if (!entry) throw new ApiError('NOT_FOUND', 'Posting entry not found in this evidence.');
  return {
    receiptId: row.receiptId,
    evidenceId: row.id,
    reviewId: row.review?.id ?? null,
    reviewDecision: (row.review?.decision as 'ACCEPT' | 'REJECT' | undefined) ?? null,
    contentHash: row.contentHash,
    sourceSystem: payload.sourceSystem,
    sourceProduct: payload.sourceProduct,
    sourceNamespace: payload.sourceNamespace,
    sourceReceiptId: payload.sourceReceiptId,
    sourceRecordId: payload.sourceRecordId,
    sourceDocumentId: payload.sourceDocumentId,
    sourceSequence: row.sourceSequence,
    latestEvidenceId: latest.id,
    latestSourceSequence: latest.sourceSequence,
    currentAcceptedEvidenceId: acceptedId,
    status: payload.status,
    detailCompleteness: payload.detailCompleteness,
    headerAmount: payload.amount,
    headerSourceAmount: payload.sourceAmount,
    sourceSignConvention: payload.sourceSignConvention,
    entryId: row.review?.entries.find((item) => item.sourceEntryId === sourceEntryId)?.id ?? null,
    entry,
  };
}
function claimBinding(claim: Claim, lineId: string | null): RelationshipClaim {
  const line = claim.sourceDetails?.lines.find((item) => item.id === lineId);
  return {
    id: claim.id,
    claimNumber: claim.claimNumber,
    version: claim.updatedAt.toISOString(),
    sourceSystem: claim.sourceSystem,
    sourceNamespace: claim.sourceNamespace,
    sourceClaimId: claim.sourceClaimId,
    sourceVersion: claim.sourceVersion,
    sourceContentHash: claim.sourceContentHash,
    line: line
      ? {
          ...line,
          serviceDate: line.serviceDate.toISOString().slice(0, 10),
          billedAmount: line.billedAmount.toFixed(2),
        }
      : null,
  };
}
function sourceBlockers(
  bundle: SourceBundle,
  source: RelationshipSource,
  excludeId?: string,
): RelationshipBlocker[] {
  const blockers: RelationshipBlocker[] = [];
  if (source.reviewDecision !== 'ACCEPT' || !source.entryId) blockers.push('SOURCE_NOT_ACCEPTED');
  if (
    source.latestEvidenceId !== source.evidenceId ||
    source.currentAcceptedEvidenceId !== source.evidenceId
  )
    blockers.push('SOURCE_NOT_CURRENT');
  if (!supportedSystems.includes(source.sourceSystem)) blockers.push('SOURCE_SYSTEM_UNSUPPORTED');
  if (!source.entry.sourceClaimId) blockers.push('SOURCE_CLAIM_ID_MISSING');
  if (
    bundle.reservations.some(
      (item) => item.sourceEntryId === source.entry.sourceEntryId && item.id !== excludeId,
    )
  )
    blockers.push('ENTRY_ALREADY_LINKED');
  return blockers;
}
function identityBlockers(
  source: RelationshipSource,
  claim: RelationshipClaim,
  lineId: string | null,
): RelationshipBlocker[] {
  const blockers: RelationshipBlocker[] = [];
  if (
    !claim.sourceContentHash ||
    claim.sourceSystem !== source.sourceSystem ||
    claim.sourceNamespace !== source.sourceNamespace ||
    claim.sourceClaimId !== source.entry.sourceClaimId
  )
    blockers.push('CLAIM_SOURCE_IDENTITY_MISMATCH');
  if (source.entry.sourceLineId === null) {
    if (lineId !== null) blockers.push('SOURCE_LINE_ID_MISSING');
  } else if (claim.line?.sourceLineId !== source.entry.sourceLineId) {
    blockers.push('SOURCE_LINE_NOT_FOUND');
  } else if (
    source.entry.sourceProcedureId !== null &&
    claim.line.sourceProcedureId !== source.entry.sourceProcedureId
  ) {
    blockers.push('SOURCE_PROCEDURE_MISMATCH');
  }
  return blockers;
}
async function buildPreview(
  db: Db,
  scope: RelationshipScope,
  candidate: RelationshipCandidate,
  excludeId?: string,
): Promise<RelationshipPreview> {
  const bundle = await sourceBundle(db, scope, candidate.evidenceId);
  const source = sourceBinding(bundle, candidate.sourceEntryId);
  const row = await db.claim.findFirst({
    where: {
      id: candidate.claimId,
      organizationId: scope.organizationId,
    },
    select: claimSelect,
  });
  if (!row) throw new ApiError('NOT_FOUND', 'Claim not found in your practice.');
  const claim = claimBinding(row, candidate.claimSourceLineId);
  const blockers = [
    ...sourceBlockers(bundle, source, excludeId),
    ...identityBlockers(source, claim, candidate.claimSourceLineId),
  ];
  const version = await ledgerVersion(db, scope);
  return RelationshipPreviewSchema.parse({
    candidate,
    source,
    claim,
    blockers,
    ledgerVersion: version,
    reviewToken: digest([
      'posting-claim-preview-v1',
      scope.organizationId,
      candidate,
      source,
      claim,
      blockers,
      version,
    ]),
    ...financialState,
  });
}
export async function previewRelationship(
  scope: RelationshipScope,
  input: RelationshipCandidate,
): Promise<RelationshipPreview> {
  const candidate = RelationshipCandidateSchema.parse(input);
  return prisma.$transaction(
    async (db) => {
      await authorize(db, scope);
      const result = await buildPreview(db, scope, candidate);
      await recordAccess(db, scope, scope.organizationId, 'PREVIEW');
      return result;
    },
    { ...transactionOptions, isolationLevel: 'RepeatableRead' },
  );
}
function receipt(
  row: Prisma.PostingClaimRelationshipGetPayload<Record<string, never>>,
): RelationshipReceipt {
  return RelationshipReceiptSchema.parse({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    reviewedByUserId: row.reviewedByUserId,
    reviewedByRole: row.reviewedByRole,
    receiptId: row.receiptId,
    evidenceId: row.evidenceId,
    reviewId: row.reviewId,
    entryId: row.entryId,
    sourceEntryId: row.sourceEntryId,
    claimId: row.claimId,
    claimSourceLineId: row.claimSourceLineId,
    claimVersion: row.claimVersion.toISOString(),
    ...financialState,
  });
}
function releaseReceipt(
  row: Prisma.PostingClaimReleaseGetPayload<Record<string, never>>,
): RelationshipReleaseReceipt {
  return RelationshipReleaseReceiptSchema.parse({
    id: row.id,
    relationshipId: row.relationshipId,
    createdAt: row.createdAt.toISOString(),
    reviewedByUserId: row.reviewedByUserId,
    reviewedByRole: row.reviewedByRole,
    reason: row.reason,
  });
}
function releaseSummary(
  row: Prisma.PostingClaimReleaseGetPayload<Record<string, never>>,
): Omit<RelationshipReleaseReceipt, 'relationshipId'> {
  const result = releaseReceipt(row);
  return {
    id: result.id,
    createdAt: result.createdAt,
    reviewedByUserId: result.reviewedByUserId,
    reviewedByRole: result.reviewedByRole,
    reason: result.reason,
  };
}
export async function createRelationship(
  scope: RelationshipScope,
  input: RelationshipDecision,
): Promise<{
  created: boolean;
  receipt: RelationshipReceipt;
}> {
  const body = RelationshipDecisionSchema.parse(input);
  const requestHash = digest(['posting-claim-create-v1', scope.organizationId, scope.userId, body]);
  return prisma.$transaction(async (db) => {
    await lockOrganization(db, scope);
    const role = await authorize(db, scope);
    const replay = await db.postingClaimRelationship.findFirst({
      where: {
        organizationId: scope.organizationId,
        idempotencyKey: body.idempotencyKey,
      },
    });
    if (replay) {
      if (replay.requestHash !== requestHash)
        conflict('This retry key was used for a different posting relationship.');
      await recordAccess(db, scope, replay.id, 'CREATE_REPLAY');
      return { created: false, receipt: receipt(replay) };
    }
    await lockClaim(db, scope, body.claimId);
    const candidate = RelationshipCandidateSchema.parse({
      evidenceId: body.evidenceId,
      sourceEntryId: body.sourceEntryId,
      claimId: body.claimId,
      claimSourceLineId: body.claimSourceLineId,
    });
    const preview = await buildPreview(db, scope, candidate);
    if (preview.reviewToken !== body.reviewToken)
      conflict('The source, claim or existing links changed. Refresh the preview.');
    if (
      preview.blockers.length ||
      !preview.source.reviewId ||
      !preview.source.entryId ||
      !preview.claim.sourceContentHash ||
      !preview.source.entry.sourceClaimId
    )
      conflict(
        'Resolve the source identity and currentness requirements before linking this entry.',
      );
    const row = await db.postingClaimRelationship.create({
      data: {
        organizationId: scope.organizationId,
        receiptId: preview.source.receiptId,
        evidenceId: body.evidenceId,
        reviewId: preview.source.reviewId,
        entryId: preview.source.entryId,
        sourceSystem: preview.source.sourceSystem,
        sourceNamespace: preview.source.sourceNamespace,
        sourceEntryId: body.sourceEntryId,
        sourceClaimId: preview.source.entry.sourceClaimId,
        claimId: body.claimId,
        claimSourceLineId: body.claimSourceLineId,
        claimVersion: new Date(preview.claim.version),
        claimSourceContentHash: preview.claim.sourceContentHash,
        evidenceHash: preview.source.contentHash,
        reviewedByUserId: scope.userId,
        reviewedByRole: role,
        idempotencyKey: body.idempotencyKey,
        requestHash,
        reviewToken: body.reviewToken,
        ledgerVersion: preview.ledgerVersion,
      },
    });
    await audit(
      {
        ...scope,
        action: 'posting.relationship.create',
        resourceType: 'PostingClaimRelationship',
        resourceId: row.id,
        metadata: { evidenceId: row.evidenceId, claimId: row.claimId },
      },
      db,
    );
    return { created: true, receipt: receipt(row) };
  }, transactionOptions);
}
async function findRelationship(
  db: Db,
  scope: RelationshipScope,
  id: string,
): Promise<Relationship> {
  const row = await db.postingClaimRelationship.findFirst({
    where: { id, organizationId: scope.organizationId },
    include: relationshipInclude,
  });
  if (!row) throw new ApiError('NOT_FOUND', 'Posting relationship not found in your practice.');
  return row;
}
async function releasePreview(
  db: Db,
  scope: RelationshipScope,
  row: Relationship,
  reason: RelationshipReleaseDecision['reason'],
): Promise<RelationshipReleasePreview> {
  const version = await ledgerVersion(db, scope);
  return RelationshipReleasePreviewSchema.parse({
    relationship: receipt(row),
    release: row.release ? releaseSummary(row.release) : null,
    reason,
    canRelease: row.release === null,
    ledgerVersion: version,
    reviewToken: digest([
      'posting-claim-release-preview-v1',
      scope.organizationId,
      row.id,
      row.requestHash,
      row.release?.id ?? null,
      reason,
      version,
    ]),
  });
}
export async function previewRelationshipRelease(
  scope: RelationshipScope,
  id: string,
  reason: RelationshipReleaseDecision['reason'],
): Promise<RelationshipReleasePreview> {
  const input = RelationshipReleaseCandidateSchema.parse({ reason });
  return prisma.$transaction(
    async (db) => {
      await authorize(db, scope);
      const result = await releasePreview(
        db,
        scope,
        await findRelationship(db, scope, id),
        input.reason,
      );
      await recordAccess(db, scope, id, 'RELEASE_PREVIEW');
      return result;
    },
    { ...transactionOptions, isolationLevel: 'RepeatableRead' },
  );
}
export async function releaseRelationship(
  scope: RelationshipScope,
  id: string,
  input: RelationshipReleaseDecision,
): Promise<{ created: boolean; receipt: RelationshipReleaseReceipt }> {
  const body = RelationshipReleaseDecisionSchema.parse(input);
  const requestHash = digest([
    'posting-claim-release-v1',
    scope.organizationId,
    scope.userId,
    id,
    body,
  ]);
  return prisma.$transaction(async (db) => {
    await lockOrganization(db, scope);
    const role = await authorize(db, scope);
    const replay = await db.postingClaimRelease.findFirst({
      where: {
        organizationId: scope.organizationId,
        idempotencyKey: body.idempotencyKey,
      },
    });
    if (replay) {
      if (replay.requestHash !== requestHash)
        conflict('This retry key was used for a different relationship release.');
      await recordAccess(db, scope, replay.id, 'RELEASE_REPLAY');
      return { created: false, receipt: releaseReceipt(replay) };
    }
    const relationship = await findRelationship(db, scope, id);
    const preview = await releasePreview(db, scope, relationship, body.reason);
    if (!preview.canRelease || preview.reviewToken !== body.reviewToken)
      conflict('The relationship or release history changed. Refresh the release preview.');
    const row = await db.postingClaimRelease.create({
      data: {
        organizationId: scope.organizationId,
        relationshipId: id,
        reviewedByUserId: scope.userId,
        reviewedByRole: role,
        reason: body.reason,
        idempotencyKey: body.idempotencyKey,
        requestHash,
        reviewToken: body.reviewToken,
        ledgerVersion: preview.ledgerVersion,
        relationshipRequestHash: relationship.requestHash,
      },
    });
    await audit(
      {
        ...scope,
        action: 'posting.relationship.release',
        resourceType: 'PostingClaimRelease',
        resourceId: row.id,
        metadata: { relationshipId: id, reason: body.reason },
      },
      db,
    );
    return { created: true, receipt: releaseReceipt(row) };
  }, transactionOptions);
}
async function response(
  db: Db,
  scope: RelationshipScope,
  row: Relationship,
): Promise<RelationshipResponse> {
  const preview = await buildPreview(
    db,
    scope,
    {
      evidenceId: row.evidenceId,
      sourceEntryId: row.sourceEntryId,
      claimId: row.claimId,
      claimSourceLineId: row.claimSourceLineId,
    },
    row.id,
  );
  const blockers = [...preview.blockers];
  if (
    preview.claim.version !== row.claimVersion.toISOString() ||
    preview.claim.sourceContentHash !== row.claimSourceContentHash
  )
    blockers.push('CLAIM_CHANGED');
  return RelationshipSchema.parse({
    ...receipt(row),
    source: preview.source,
    claim: preview.claim,
    status: row.release ? 'RELEASED' : blockers.length ? 'STALE' : 'CURRENT',
    blockers,
    release: row.release ? releaseSummary(row.release) : null,
  });
}
const CursorSchema = z.strictObject({
  organizationId: z.string(),
  receiptId: z.uuid().nullable(),
  id: z.uuid(),
  createdAt: z.iso.datetime(),
});
export async function listRelationships(
  scope: RelationshipScope,
  limit: number,
  cursor?: string,
  receiptId?: string,
): Promise<z.infer<typeof RelationshipListSchema>> {
  let page: z.infer<typeof CursorSchema> | undefined;
  if (cursor) {
    try {
      page = CursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')));
    } catch {
      throw new ApiError('VALIDATION_ERROR', 'Invalid posting relationship cursor.');
    }
    if (page.organizationId !== scope.organizationId || page.receiptId !== (receiptId ?? null))
      throw new ApiError('VALIDATION_ERROR', 'Invalid posting relationship cursor.');
  }
  return prisma.$transaction(
    async (db) => {
      await authorize(db, scope);
      const rows = await db.postingClaimRelationship.findMany({
        where: {
          organizationId: scope.organizationId,
          ...(receiptId ? { receiptId } : {}),
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
        include: relationshipInclude,
      });
      const items: RelationshipResponse[] = [];
      let bytes = 4096;
      for (const row of rows.slice(0, Math.min(limit, 20))) {
        const item = await response(db, scope, row);
        const size = Buffer.byteLength(JSON.stringify(item), 'utf8') + 1;
        if (bytes + size > 2 * 1024 * 1024) break;
        items.push(item);
        bytes += size;
      }
      if (rows.length && !items.length)
        throw new ApiError('INTERNAL_ERROR', 'Posting relationships exceed the page size.');
      const last = items.at(-1);
      const result = RelationshipListSchema.parse({
        items,
        hasMore: rows.length > items.length,
        nextCursor:
          rows.length > items.length && last
            ? Buffer.from(
                JSON.stringify({
                  organizationId: scope.organizationId,
                  receiptId: receiptId ?? null,
                  id: last.id,
                  createdAt: last.createdAt,
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
export async function listRelationshipTargets(
  scope: RelationshipScope,
  evidenceId: string,
): Promise<z.infer<typeof RelationshipTargetsSchema>> {
  return prisma.$transaction(
    async (db) => {
      await authorize(db, scope);
      const bundle = await sourceBundle(db, scope, evidenceId);
      const claims = await db.claim.findMany({
        where: {
          organizationId: scope.organizationId,
          sourceSystem: bundle.payload.sourceSystem,
          sourceNamespace: bundle.payload.sourceNamespace,
          sourceClaimId: {
            in: bundle.payload.entries.flatMap((entry) =>
              entry.sourceClaimId ? [entry.sourceClaimId] : [],
            ),
          },
        },
        select: claimSelect,
      });
      const items = bundle.payload.entries.map((entry) => {
        const source = sourceBinding(bundle, entry.sourceEntryId);
        const target = claims.find((claim) => claim.sourceClaimId === entry.sourceClaimId);
        const line = entry.sourceLineId
          ? target?.sourceDetails?.lines.find((item) => item.sourceLineId === entry.sourceLineId)
          : null;
        const claim = target ? claimBinding(target, line?.id ?? null) : null;
        const candidate: RelationshipCandidate | null = claim
          ? {
              evidenceId,
              sourceEntryId: entry.sourceEntryId,
              claimId: claim.id,
              claimSourceLineId: line?.id ?? null,
            }
          : null;
        const blockers = sourceBlockers(bundle, source);
        if (claim && candidate)
          blockers.push(...identityBlockers(source, claim, candidate.claimSourceLineId));
        else blockers.push('CLAIM_SOURCE_IDENTITY_MISMATCH');
        return { source, candidate, claim, blockers: [...new Set(blockers)] };
      });
      const result = RelationshipTargetsSchema.parse({ evidenceId, items, ...financialState });
      if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 2 * 1024 * 1024)
        throw new ApiError('INTERNAL_ERROR', 'Posting targets exceed the supported response size.');
      await recordAccess(db, scope, scope.organizationId, 'TARGETS', items.length);
      return result;
    },
    { ...transactionOptions, isolationLevel: 'RepeatableRead' },
  );
}
