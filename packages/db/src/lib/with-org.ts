import { prisma } from '../client.js';

import { MissingOrgScopeError } from './errors.js';

/**
 * Returns a Prisma client where every read against a multi-tenant model
 * (per `MULTI_TENANT_MODELS`) is automatically filtered by
 * `organizationId = orgId`. The caller cannot forget to scope.
 *
 * Intercepted methods on each multi-tenant model:
 *   - findMany
 *   - findFirst / findFirstOrThrow
 *   - count
 *   - aggregate
 *   - groupBy
 *
 * `findUnique` / `findUniqueOrThrow` are intentionally NOT intercepted —
 * Prisma's findUnique requires a unique-key `where`, and silently mixing
 * scope into it can produce surprising 'record not found' results that
 * mask cross-tenant attempts. For scoped lookups by id, use:
 *
 *   getOrgScopedDb(orgId).claim.findFirst({ where: { id } })
 *
 * Writes pass through unchanged here — the org-scope write middleware
 * (`packages/db/src/middleware/org-scope.ts`, P1-T5) handles those.
 */

interface ArgsWithWhere {
  where?: Record<string, unknown>;
}

function injectOrg<T extends ArgsWithWhere>(args: T | undefined, orgId: string): T {
  const base = (args ?? {}) as T;
  return {
    ...base,
    where: { ...(base.where ?? {}), organizationId: orgId },
  };
}

export type OrgScopedDb = ReturnType<typeof getOrgScopedDb>;

// The Prisma `$extends` return type is generic over the extension config
// and impractical to spell out by hand. TypeScript infers it correctly for
// downstream callers (see `OrgScopedDb`); we suppress the explicit-return
// rule for this single boundary.
// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function getOrgScopedDb(orgId: string) {
  if (typeof orgId !== 'string' || orgId.length === 0) {
    throw new MissingOrgScopeError('getOrgScopedDb(orgId) requires a non-empty orgId');
  }

  return prisma.$extends({
    name: 'orgScope',
    query: {
      user: {
        findMany: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirst: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirstOrThrow: ({ args, query }) => query(injectOrg(args, orgId)),
        count: ({ args, query }) => query(injectOrg(args, orgId)),
        aggregate: ({ args, query }) => query(injectOrg(args, orgId)),
        groupBy: ({ args, query }) => query(injectOrg(args, orgId)),
      },
      claim: {
        findMany: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirst: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirstOrThrow: ({ args, query }) => query(injectOrg(args, orgId)),
        count: ({ args, query }) => query(injectOrg(args, orgId)),
        aggregate: ({ args, query }) => query(injectOrg(args, orgId)),
        groupBy: ({ args, query }) => query(injectOrg(args, orgId)),
      },
      call: {
        findMany: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirst: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirstOrThrow: ({ args, query }) => query(injectOrg(args, orgId)),
        count: ({ args, query }) => query(injectOrg(args, orgId)),
        aggregate: ({ args, query }) => query(injectOrg(args, orgId)),
        groupBy: ({ args, query }) => query(injectOrg(args, orgId)),
      },
      callIntent: {
        findMany: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirst: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirstOrThrow: ({ args, query }) => query(injectOrg(args, orgId)),
        count: ({ args, query }) => query(injectOrg(args, orgId)),
        aggregate: ({ args, query }) => query(injectOrg(args, orgId)),
        groupBy: ({ args, query }) => query(injectOrg(args, orgId)),
      },
      jobOutbox: {
        findMany: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirst: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirstOrThrow: ({ args, query }) => query(injectOrg(args, orgId)),
        count: ({ args, query }) => query(injectOrg(args, orgId)),
        aggregate: ({ args, query }) => query(injectOrg(args, orgId)),
        groupBy: ({ args, query }) => query(injectOrg(args, orgId)),
      },
      inferenceBudget: {
        findMany: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirst: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirstOrThrow: ({ args, query }) => query(injectOrg(args, orgId)),
        count: ({ args, query }) => query(injectOrg(args, orgId)),
        aggregate: ({ args, query }) => query(injectOrg(args, orgId)),
        groupBy: ({ args, query }) => query(injectOrg(args, orgId)),
      },
      inferenceRun: {
        findMany: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirst: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirstOrThrow: ({ args, query }) => query(injectOrg(args, orgId)),
        count: ({ args, query }) => query(injectOrg(args, orgId)),
        aggregate: ({ args, query }) => query(injectOrg(args, orgId)),
        groupBy: ({ args, query }) => query(injectOrg(args, orgId)),
      },
      inferenceAttempt: {
        findMany: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirst: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirstOrThrow: ({ args, query }) => query(injectOrg(args, orgId)),
        count: ({ args, query }) => query(injectOrg(args, orgId)),
        aggregate: ({ args, query }) => query(injectOrg(args, orgId)),
        groupBy: ({ args, query }) => query(injectOrg(args, orgId)),
      },
      // P4-T1A — CallSummary holds PHI (rawTranscript + claudeSummary)
      // and must be tenant-isolated. The `MULTI_TENANT_MODELS` registry
      // (lib/multi-tenant.ts) is the source of truth; both this read
      // scope and the write middleware (middleware/org-scope.ts) consult
      // it. Adding a model here without updating the registry — or vice
      // versa — leaves a gap; cross-tenant tests in with-org.test.ts
      // catch the asymmetry.
      callSummary: {
        findMany: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirst: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirstOrThrow: ({ args, query }) => query(injectOrg(args, orgId)),
        count: ({ args, query }) => query(injectOrg(args, orgId)),
        aggregate: ({ args, query }) => query(injectOrg(args, orgId)),
        groupBy: ({ args, query }) => query(injectOrg(args, orgId)),
      },
      payerConfig: {
        findMany: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirst: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirstOrThrow: ({ args, query }) => query(injectOrg(args, orgId)),
        count: ({ args, query }) => query(injectOrg(args, orgId)),
        aggregate: ({ args, query }) => query(injectOrg(args, orgId)),
        groupBy: ({ args, query }) => query(injectOrg(args, orgId)),
      },
      auditLog: {
        findMany: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirst: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirstOrThrow: ({ args, query }) => query(injectOrg(args, orgId)),
        count: ({ args, query }) => query(injectOrg(args, orgId)),
        aggregate: ({ args, query }) => query(injectOrg(args, orgId)),
        groupBy: ({ args, query }) => query(injectOrg(args, orgId)),
      },
      // Phase 4 — billing usage receipts (ADR-043). One row per
      // (claim, billingPeriod). Cross-tenant isolation is critical here:
      // a leak would post org A's resolved claim against org B's Stripe
      // customer — a financial-correctness bug, not just a privacy one.
      billingUsageRecord: {
        findMany: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirst: ({ args, query }) => query(injectOrg(args, orgId)),
        findFirstOrThrow: ({ args, query }) => query(injectOrg(args, orgId)),
        count: ({ args, query }) => query(injectOrg(args, orgId)),
        aggregate: ({ args, query }) => query(injectOrg(args, orgId)),
        groupBy: ({ args, query }) => query(injectOrg(args, orgId)),
      },
    },
  });
}
