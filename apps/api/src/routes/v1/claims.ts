import { audit, getOrgScopedDb, prisma } from '@dentabill/db';
import { ApiError, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@dentabill/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { isValidClaimTransition } from '../../lib/claim-state.js';

/**
 * `/v1/claims` — basic CRUD on Claim rows (P2-T38).
 *
 * The router intentionally ships the smallest end-to-end surface a
 * dashboard can hang off of. Pagination, sortable filters, and the
 * cursor convention land in P2-T39; the state-machine `PATCH`
 * transitions land in P2-T40. Until then, list returns up to 100
 * recent rows and `PATCH` accepts the same Zod-validated subset of
 * mutable fields a UI form would surface.
 *
 * Multi-tenancy is enforced through three layers:
 *
 *   1. `requireAuth` puts `userId` + `orgId` on `request.auth`. No
 *      route handler runs without it.
 *   2. `getOrgScopedDb(orgId)` returns a Prisma client where every
 *      read on `Claim` is auto-filtered by organizationId.
 *   3. The write middleware in `@dentabill/db` blocks writes that
 *      omit organizationId. The router supplies it explicitly on
 *      every create / update.
 *
 * Reads call `audit()` so the resulting AuditLog row is visible at
 * /dashboard/settings/audit-log once that view ships.
 *
 * `patientDOBHash` lands in the request body as a pre-hashed value.
 * The dashboard's manual-create flow can call `hashPatientDOB` from
 * `@dentabill/db/lib/dob` once P2-T45 ships; the CSV ingestion path
 * (P2-T48) hashes during parse. The router is unconcerned which
 * upstream produced the hash.
 */
const PayerCodeEnum = z.enum([
  'DELTA_DENTAL_PPO',
  'DELTA_DENTAL_PREMIER',
  'CIGNA_DENTAL',
  'METLIFE_DENTAL',
  'AETNA_DENTAL',
  'GUARDIAN_DENTAL',
  'UNITED_CONCORDIA',
  'HUMANA_DENTAL',
  'UNKNOWN',
]);

const ClaimStatusEnum = z.enum([
  'PENDING',
  'IN_QUEUE',
  'CALLING',
  'COMPLETED',
  'DENIED',
  'NEEDS_INFO',
  'APPEALING',
  'RESOLVED',
  'WRITTEN_OFF',
  'FAILED',
  'MANUAL_REVIEW',
]);

const ClaimResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  patientDOBHash: z.string(),
  patientDOBLast4: z.string().nullable(),
  claimNumber: z.string(),
  cdtCodes: z.array(z.string()),
  claimAmount: z.string(),
  payerCode: PayerCodeEnum,
  serviceDate: z.string(),
  submittedDate: z.string().nullable(),
  status: ClaimStatusEnum,
  priority: z.number().int(),
  retryCount: z.number().int(),
  maxRetries: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

type ClaimResponse = z.infer<typeof ClaimResponseSchema>;

const ClaimCreateSchema = z.object({
  patientDOBHash: z.string().min(1),
  patientDOBLast4: z
    .string()
    .refine((v) => /^\d{4}$/.test(v), 'Last 4 must be exactly 4 digits.')
    .optional(),
  claimNumber: z.string().min(1).max(120),
  cdtCodes: z.array(z.string().min(1)).max(50).default([]),
  claimAmount: z.string().refine((v) => {
    if (typeof v !== 'string' || v.length === 0 || v.length > 20) return false;
    const parts = v.split('.');
    if (parts.length > 2) return false;
    const [whole, fractional] = parts;
    if (!whole || !/^\d+$/.test(whole)) return false;
    if (
      fractional !== undefined &&
      (fractional.length === 0 || fractional.length > 2 || !/^\d+$/.test(fractional))
    ) {
      return false;
    }
    return true;
  }, 'Amount must be a positive decimal with up to 2 fractional digits.'),
  payerCode: PayerCodeEnum,
  serviceDate: z.iso.datetime(),
  submittedDate: z.iso.datetime().optional(),
});

const ClaimPatchSchema = ClaimCreateSchema.partial().extend({
  status: ClaimStatusEnum.optional(),
  priority: z.number().int().min(0).max(1_000_000).optional(),
});

/**
 * Inline `paginatedResponseSchema` rather than the helper from
 * `@dentabill/types`. The helper is a generic over `ZodTypeAny` and
 * the cross-package zod v3 / v4 type bleed forces a `as never` at the
 * call site that hides the actual response shape from the SDK
 * generator. Inlining keeps the OpenAPI emit accurate.
 */
const ClaimsListResponseSchema = z.object({
  items: z.array(ClaimResponseSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

const IdParamSchema = z.object({ id: z.string().min(1) });

/**
 * Cursor format: base64url("<sortValue>|<id>") so a tie on the sort
 * field (`createdAt`, `priority`, etc.) still produces a deterministic
 * page boundary. The id half breaks ties; sortValue is the field we
 * order by so the client never sees the underlying date / number.
 *
 * Cursors are opaque to the client per `docs/API_CONVENTIONS.md` —
 * round-trip them as-is, do not parse.
 */
function encodeCursor(sortValue: string, id: string): string {
  return Buffer.from(`${sortValue}|${id}`, 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { sortValue: string; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = decoded.indexOf('|');
    if (sep < 1 || sep === decoded.length - 1) return null;
    return { sortValue: decoded.slice(0, sep), id: decoded.slice(sep + 1) };
  } catch {
    return null;
  }
}

const SortFieldEnum = z.enum(['createdAt', 'serviceDate', 'priority', 'status']);
const SortDirEnum = z.enum(['asc', 'desc']);

const ClaimsListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  sort: SortFieldEnum.default('createdAt'),
  dir: SortDirEnum.default('desc'),
  status: ClaimStatusEnum.optional(),
  payer: PayerCodeEnum.optional(),
  serviceDateFrom: z.iso.datetime().optional(),
  serviceDateTo: z.iso.datetime().optional(),
  // Search runs case-insensitively against `claimNumber` (the only
  // PHI-safe text field on the Claim row). Patient names / DOB are
  // never searchable from this surface.
  search: z.string().min(1).max(120).optional(),
});

type ClaimsListQuery = z.infer<typeof ClaimsListQuerySchema>;

interface ClaimRowForCursor {
  id: string;
  createdAt: Date;
  serviceDate: Date;
  priority: number;
  status: ClaimResponse['status'];
}

function cursorValueOf(row: ClaimRowForCursor, field: ClaimsListQuery['sort']): string {
  switch (field) {
    case 'createdAt':
      return row.createdAt.toISOString();
    case 'serviceDate':
      return row.serviceDate.toISOString();
    case 'priority':
      return row.priority.toString().padStart(11, '0');
    case 'status':
      return row.status;
  }
}

/**
 * Serialise a Prisma `Claim` row into the wire shape. Decimals and
 * Date instances become strings so the response matches the Zod schema
 * the SDK consumes.
 */
function toResponse(row: {
  id: string;
  organizationId: string;
  patientDOBHash: string;
  patientDOBLast4: string | null;
  claimNumber: string;
  cdtCodes: string[];
  claimAmount: { toString: () => string };
  payerCode: ClaimResponse['payerCode'];
  serviceDate: Date;
  submittedDate: Date | null;
  status: ClaimResponse['status'];
  priority: number;
  retryCount: number;
  maxRetries: number;
  createdAt: Date;
  updatedAt: Date;
}): ClaimResponse {
  return {
    id: row.id,
    organizationId: row.organizationId,
    patientDOBHash: row.patientDOBHash,
    patientDOBLast4: row.patientDOBLast4,
    claimNumber: row.claimNumber,
    cdtCodes: row.cdtCodes,
    claimAmount: row.claimAmount.toString(),
    payerCode: row.payerCode,
    serviceDate: row.serviceDate.toISOString(),
    submittedDate: row.submittedDate ? row.submittedDate.toISOString() : null,
    status: row.status,
    priority: row.priority,
    retryCount: row.retryCount,
    maxRetries: row.maxRetries,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function claimsRoutes(fastify: FastifyInstance): void {
  const { requireAuth } = fastify.auth;
  const security = [{ bearer: [] as string[] }];

  fastify.withTypeProvider().post(
    '/claims',
    {
      preHandler: requireAuth,
      schema: {
        description: "Create a claim under the authenticated user's organization.",
        security,
        body: ClaimCreateSchema,
        response: { 201: ClaimResponseSchema },
      },
    },
    async (request, reply): Promise<ClaimResponse> => {
      const auth = request.auth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'unreachable: requireAuth ran');
      const orgId = auth.orgId;
      const body = request.body as z.infer<typeof ClaimCreateSchema>;

      const created = await prisma.claim.create({
        data: {
          organizationId: orgId,
          patientDOBHash: body.patientDOBHash,
          patientDOBLast4: body.patientDOBLast4 ?? null,
          claimNumber: body.claimNumber,
          cdtCodes: body.cdtCodes,
          claimAmount: body.claimAmount,
          payerCode: body.payerCode,
          serviceDate: new Date(body.serviceDate),
          submittedDate: body.submittedDate ? new Date(body.submittedDate) : null,
        },
      });

      reply.code(201);
      return toResponse(created);
    },
  );

  fastify.withTypeProvider().get(
    '/claims',
    {
      preHandler: requireAuth,
      schema: {
        description:
          'List claims for the authenticated organization with cursor pagination, sortable by createdAt / serviceDate / priority / status, and filterable by status / payer / service-date range / claimNumber search.',
        security,
        querystring: ClaimsListQuerySchema,
        response: { 200: ClaimsListResponseSchema },
      },
    },
    async (request): Promise<z.infer<typeof ClaimsListResponseSchema>> => {
      const auth = request.auth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'unreachable: requireAuth ran');
      const { orgId } = auth;
      const query = request.query as ClaimsListQuery;

      const where: Record<string, unknown> = {};
      if (query.status) where.status = query.status;
      if (query.payer) where.payerCode = query.payer;
      if (query.serviceDateFrom || query.serviceDateTo) {
        const range: Record<string, Date> = {};
        if (query.serviceDateFrom) range.gte = new Date(query.serviceDateFrom);
        if (query.serviceDateTo) range.lte = new Date(query.serviceDateTo);
        where.serviceDate = range;
      }
      if (query.search) {
        // claimNumber is the only PHI-safe searchable text — the schema
        // exposes nothing else free-form to the client. case-insensitive
        // contains so partial matches feel natural in the UI.
        where.claimNumber = { contains: query.search, mode: 'insensitive' };
      }

      // Cursor decoding. The cursor encodes (sortValue, id); we use it
      // as a strict-greater / strict-less seek key. For descending
      // sorts the predicate flips. We also break ties on `id` using
      // the secondary order so two rows with the same sortValue are
      // not rendered twice.
      let cursorPredicate: Record<string, unknown> | null = null;
      if (query.cursor) {
        const decoded = decodeCursor(query.cursor);
        if (!decoded) {
          throw new ApiError('VALIDATION_ERROR', 'cursor is malformed.');
        }
        const seekField = query.sort;
        const seekValue =
          seekField === 'createdAt' || seekField === 'serviceDate'
            ? new Date(decoded.sortValue)
            : seekField === 'priority'
              ? Number(decoded.sortValue)
              : decoded.sortValue;
        const op = query.dir === 'desc' ? 'lt' : 'gt';
        cursorPredicate = {
          OR: [
            { [seekField]: { [op]: seekValue } },
            { AND: [{ [seekField]: seekValue }, { id: { [op]: decoded.id } }] },
          ],
        };
      }

      const finalWhere = cursorPredicate === null ? where : { AND: [where, cursorPredicate] };

      const db = getOrgScopedDb(orgId);
      const rows = await db.claim.findMany({
        where: finalWhere,
        orderBy: [{ [query.sort]: query.dir }, { id: query.dir }],
        take: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;
      const last = page.at(-1);
      const nextCursor =
        hasMore && last ? encodeCursor(cursorValueOf(last, query.sort), last.id) : null;

      await audit({
        action: 'claim.list',
        resourceType: 'Claim',
        resourceId: 'list',
        organizationId: orgId,
        metadata: {
          count: page.length,
          clerkUserId: auth.userId,
          sort: query.sort,
          dir: query.dir,
        },
      });

      return {
        items: page.map(toResponse),
        nextCursor,
        hasMore,
      };
    },
  );

  fastify.withTypeProvider().get(
    '/claims/:id',
    {
      preHandler: requireAuth,
      schema: {
        description: 'Fetch a single claim by id, scoped to the auth organization.',
        security,
        params: IdParamSchema,
        response: { 200: ClaimResponseSchema },
      },
    },
    async (request): Promise<ClaimResponse> => {
      const auth = request.auth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'unreachable: requireAuth ran');
      const { orgId } = auth;
      const { id } = request.params as z.infer<typeof IdParamSchema>;
      const db = getOrgScopedDb(orgId);
      const row = await db.claim.findFirst({ where: { id } });
      if (!row) {
        throw new ApiError('NOT_FOUND', 'Claim not found in your organization.');
      }
      await audit({
        action: 'claim.read',
        resourceType: 'Claim',
        resourceId: id,
        organizationId: orgId,
        // See claim.list note above on userId omission.
        metadata: { clerkUserId: auth.userId },
      });
      return toResponse(row);
    },
  );

  fastify.withTypeProvider().patch(
    '/claims/:id',
    {
      preHandler: requireAuth,
      schema: {
        description: 'Patch a claim. Only fields supplied in the body are updated.',
        security,
        params: IdParamSchema,
        body: ClaimPatchSchema,
        response: { 200: ClaimResponseSchema },
      },
    },
    async (request): Promise<ClaimResponse> => {
      const auth = request.auth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'unreachable: requireAuth ran');
      const { orgId } = auth;
      const { id } = request.params as z.infer<typeof IdParamSchema>;
      const body = request.body as z.infer<typeof ClaimPatchSchema>;

      const db = getOrgScopedDb(orgId);
      const existing = await db.claim.findFirst({
        where: { id },
        select: { id: true, status: true },
      });
      if (!existing) {
        throw new ApiError('NOT_FOUND', 'Claim not found in your organization.');
      }

      // State-machine validation. A status change is only accepted
      // when the (existing.status, body.status) pair is permitted by
      // the table in `claim-state.ts`. Self-transitions are allowed
      // so a PATCH that echoes the current status (alongside, say, a
      // priority bump) is not rejected.
      if (body.status && !isValidClaimTransition(existing.status, body.status)) {
        throw new ApiError(
          'INVALID_STATE_TRANSITION',
          `Cannot transition claim from ${existing.status} to ${body.status}.`,
        );
      }

      const data: Record<string, unknown> = {
        organizationId: orgId,
      };
      if (body.patientDOBHash !== undefined) data.patientDOBHash = body.patientDOBHash;
      if (body.patientDOBLast4 !== undefined) data.patientDOBLast4 = body.patientDOBLast4;
      if (body.claimNumber !== undefined) data.claimNumber = body.claimNumber;
      if (body.cdtCodes !== undefined) data.cdtCodes = body.cdtCodes;
      if (body.claimAmount !== undefined) data.claimAmount = body.claimAmount;
      if (body.payerCode !== undefined) data.payerCode = body.payerCode;
      if (body.serviceDate !== undefined) data.serviceDate = new Date(body.serviceDate);
      if (body.submittedDate !== undefined) {
        data.submittedDate = body.submittedDate ? new Date(body.submittedDate) : null;
      }
      if (body.status !== undefined) data.status = body.status;
      if (body.priority !== undefined) data.priority = body.priority;

      // updateMany lets us include `organizationId` in the where filter
      // so the write middleware accepts the request — `update` requires
      // a unique-key where, but the middleware requires `organizationId`
      // on every write. We've already verified existence via the org-
      // scoped `findFirst`, so updateMany with the composite filter is
      // both safe and necessary.
      await prisma.claim.updateMany({
        where: { id, organizationId: orgId },
        data,
      });
      const updated = await getOrgScopedDb(orgId).claim.findFirst({ where: { id } });
      if (!updated) {
        throw new ApiError('NOT_FOUND', 'Claim not found in your organization.');
      }
      return toResponse(updated);
    },
  );

  fastify.withTypeProvider().delete(
    '/claims/:id',
    {
      preHandler: requireAuth,
      schema: {
        description: 'Delete a claim. Hard-delete; soft-delete arrives in Phase 4.',
        security,
        params: IdParamSchema,
        response: { 204: z.null() },
      },
    },
    async (request, reply): Promise<null> => {
      const auth = request.auth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'unreachable: requireAuth ran');
      const { orgId } = auth;
      const { id } = request.params as z.infer<typeof IdParamSchema>;

      const db = getOrgScopedDb(orgId);
      const existing = await db.claim.findFirst({ where: { id }, select: { id: true } });
      if (!existing) {
        throw new ApiError('NOT_FOUND', 'Claim not found in your organization.');
      }

      // deleteMany over delete for the same reason update uses updateMany:
      // the org-scope write middleware requires `organizationId` on every
      // multi-tenant write, and `delete` only takes a unique-key where.
      await prisma.claim.deleteMany({ where: { id, organizationId: orgId } });
      reply.code(204);
      return null;
    },
  );
}
