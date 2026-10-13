import { audit, getOrgScopedDb } from '@dentabill/db';
import { ApiError, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@dentabill/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

/**
 * `/v1/audit-logs` — cursor-paginated read of AuditLog rows for compliance.
 *
 * Multi-tenancy is enforced through `getOrgScopedDb(orgId)` so reads always
 * filter by organizationId. The route is audited itself (meta-audit).
 */

const AuditLogResponseSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  userId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
});

type AuditLogResponse = z.infer<typeof AuditLogResponseSchema>;

const AuditLogsListResponseSchema = z.object({
  items: z.array(AuditLogResponseSchema),
  nextCursor: z.string().nullable(),
  hasMore: z.boolean(),
});

/**
 * `from`/`to` accept either a calendar date (`2026-08-21`, what an
 * `<input type="date">` emits) or a full ISO datetime. Bare dates are
 * anchored to UTC midnight; see `rangeBoundary` for the `to` end-of-day
 * widening that keeps the filter inclusive.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DateBoundarySchema = z
  .string()
  .refine((value) => DATE_ONLY.test(value) || !Number.isNaN(Date.parse(value)), {
    message: 'Expected a YYYY-MM-DD date or an ISO 8601 datetime.',
  });

const AuditLogsListQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  resourceType: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  from: DateBoundarySchema.optional(),
  to: DateBoundarySchema.optional(),
});

type AuditLogsListQuery = z.infer<typeof AuditLogsListQuerySchema>;

/**
 * A bare `to=2026-08-21` means "through the end of the 21st", not
 * "up to midnight on the 21st" — without the widening, filtering to a
 * single day returns nothing.
 */
function rangeBoundary(value: string, edge: 'start' | 'end'): Date {
  if (DATE_ONLY.test(value)) {
    return new Date(`${value}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`);
  }
  return new Date(value);
}

/**
 * Cursor format mirrors claims.ts: base64url("<sortValue>|<id>").
 * AuditLogs list sorts by `createdAt` desc with id tiebreaker.
 */
function encodeAuditCursor(sortValue: string, id: string): string {
  return Buffer.from(`${sortValue}|${id}`, 'utf8').toString('base64url');
}

function decodeAuditCursor(cursor: string): { sortValue: string; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const sep = decoded.indexOf('|');
    if (sep < 1 || sep === decoded.length - 1) return null;
    return { sortValue: decoded.slice(0, sep), id: decoded.slice(sep + 1) };
  } catch {
    return null;
  }
}

function nextCursorFor(row: { id: string; createdAt: Date } | undefined): string | null {
  if (row === undefined) return null;
  return encodeAuditCursor(row.createdAt.toISOString(), row.id);
}

interface AuditLogRow {
  id: string;
  createdAt: Date;
  action: string;
  resourceType: string;
  resourceId: string;
  userId: string | null;
  metadata: unknown;
}

function toAuditLogResponse(row: AuditLogRow): AuditLogResponse {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    action: row.action,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    userId: row.userId,
    metadata:
      typeof row.metadata === 'object' && row.metadata !== null
        ? (row.metadata as Record<string, unknown>)
        : {},
  };
}

export function auditLogsRoutes(fastify: FastifyInstance): void {
  const { requireAuth } = fastify.auth;
  const security = [{ bearer: [] as string[] }];

  fastify.withTypeProvider().get(
    '/audit-logs',
    {
      preHandler: requireAuth,
      schema: {
        description:
          'List audit logs for the authenticated organization with cursor pagination. Sorted by `createdAt` desc with id tiebreaker.',
        security,
        querystring: AuditLogsListQuerySchema,
        response: { 200: AuditLogsListResponseSchema },
      },
    },
    async (request): Promise<z.infer<typeof AuditLogsListResponseSchema>> => {
      const auth = request.dentabillAuth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'unreachable: requireAuth ran');
      const { orgId } = auth;
      const query = request.query as AuditLogsListQuery;

      const where: Record<string, unknown> = {};
      if (query.resourceType) where.resourceType = query.resourceType;
      if (query.action) where.action = query.action;
      if (query.from !== undefined || query.to !== undefined) {
        const range: Record<string, Date> = {};
        if (query.from !== undefined) range.gte = rangeBoundary(query.from, 'start');
        if (query.to !== undefined) range.lte = rangeBoundary(query.to, 'end');
        where.createdAt = range;
      }

      // Cursor decoding — descending order: prior page's last row had a
      // smaller-or-equal createdAt; we want strictly less-than that
      // sortValue OR (equal sortValue AND lexically lesser id).
      let cursorPredicate: Record<string, unknown> | null = null;
      if (query.cursor !== undefined) {
        const decoded = decodeAuditCursor(query.cursor);
        if (decoded === null) {
          throw new ApiError('VALIDATION_ERROR', 'cursor is malformed.');
        }
        const cursorDate = new Date(decoded.sortValue);
        if (Number.isNaN(cursorDate.getTime())) {
          throw new ApiError('VALIDATION_ERROR', 'cursor sort value is not a valid date.');
        }
        cursorPredicate = {
          OR: [
            { createdAt: { lt: cursorDate } },
            { createdAt: cursorDate, id: { lt: decoded.id } },
          ],
        };
      }
      const finalWhere = cursorPredicate ? { AND: [where, cursorPredicate] } : where;

      const db = getOrgScopedDb(orgId);
      const rows = await db.auditLog.findMany({
        where: finalWhere,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const items = (hasMore ? rows.slice(0, query.limit) : rows).map((row) =>
        toAuditLogResponse(row as AuditLogRow),
      );
      const lastRow = hasMore ? rows[query.limit - 1] : undefined;
      const nextCursor = nextCursorFor(lastRow);

      // Meta-audit: log that we read the audit logs.
      await audit({
        action: 'auditLog.list',
        resourceType: 'AuditLog',
        resourceId: 'list',
        organizationId: orgId,
        metadata: {
          clerkUserId: auth.userId,
          count: items.length,
          resourceType: query.resourceType ?? null,
          action: query.action ?? null,
        },
      });

      return { items, nextCursor, hasMore };
    },
  );
}
