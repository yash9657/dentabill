import { Prisma } from '@prisma/client';

import { MissingOrgScopeError } from '../lib/errors.js';
import { isMultiTenantModel } from '../lib/multi-tenant.js';

/**
 * Layer 1 of the three-layer multi-tenancy defense (ADR-009):
 *
 *   1. Write middleware — this file. Rejects writes against multi-tenant
 *      models that lack an `organizationId` filter / payload.
 *   2. Read helper — `getOrgScopedDb(orgId)` (P1-T4A) auto-injects the
 *      filter on read methods.
 *   3. Audit log — `audit()` (P1-T4A) records every PHI-touching read.
 *
 * Implementation note: we use Prisma's `defineExtension` query-level hook on
 * `$allModels.$allOperations`. This catches every CRUD verb on every model in
 * one place; we then narrow to (a) multi-tenant models and (b) write
 * operations before validating. Reads pass through untouched — the read helper
 * handles those.
 *
 * `findUnique`/`findUniqueOrThrow` remain unaffected because they are reads
 * and `getOrgScopedDb` deliberately does not intercept them (see
 * `with-org.ts` for the rationale).
 */

const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

interface DataArg {
  data?: unknown;
}
interface WhereArg {
  where?: unknown;
}

function hasOrgId(value: unknown): boolean {
  if (value === null || value === undefined || typeof value !== 'object') return false;
  const orgId = (value as { organizationId?: unknown }).organizationId;
  return typeof orgId === 'string' && orgId.length > 0;
}

function fail(model: string, operation: string, reason: string): never {
  throw new MissingOrgScopeError(
    `${model}.${operation} blocked: ${reason}. Multi-tenant writes must include a non-empty organizationId.`,
  );
}

function validateCreatePayload(model: string, operation: string, data: unknown): void {
  if (Array.isArray(data)) {
    if (data.length === 0) return;
    const bad = data.findIndex((row) => !hasOrgId(row));
    if (bad !== -1) {
      fail(model, operation, `data[${String(bad)}] is missing organizationId`);
    }
    return;
  }
  if (!hasOrgId(data)) {
    fail(model, operation, 'data is missing organizationId');
  }
}

function validateWhereScope(model: string, operation: string, where: unknown): void {
  if (!hasOrgId(where)) {
    fail(model, operation, 'where is missing organizationId');
  }
}

export const orgScopeWriteExtension = Prisma.defineExtension({
  name: 'orgScopeWrites',
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        if (!WRITE_OPERATIONS.has(operation)) return query(args);

        const camelModel = model.charAt(0).toLowerCase() + model.slice(1);
        if (!isMultiTenantModel(camelModel)) return query(args);

        switch (operation) {
          case 'create':
          case 'createMany':
          case 'createManyAndReturn': {
            const { data } = args as DataArg;
            validateCreatePayload(camelModel, operation, data);
            break;
          }
          case 'upsert': {
            const upsertArgs = args as DataArg & WhereArg & { create?: unknown };
            validateWhereScope(camelModel, operation, upsertArgs.where);
            if (!hasOrgId(upsertArgs.create)) {
              fail(camelModel, operation, 'create payload is missing organizationId');
            }
            break;
          }
          case 'update':
          case 'updateMany':
          case 'delete':
          case 'deleteMany': {
            const { where } = args as WhereArg;
            validateWhereScope(camelModel, operation, where);
            break;
          }
          default:
            break;
        }

        return query(args);
      },
    },
  },
});
