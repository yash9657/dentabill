import type { BillingPort } from '@dentabill/billing';
import { audit, type prisma } from '@dentabill/db';
import type { Logger } from '@dentabill/logger';

import type { BillingWorkerEnv } from './env.js';

/**
 * Daily Stripe metered-billing reconciliation (ADR-043).
 *
 *   1. Find every `claim.transition` audit row in the last 24h whose
 *      `metadata.toStatus = 'RESOLVED'`. The audit log is the source
 *      of truth — Claim.status alone could be re-flipped by a manual
 *      revert and we'd undercount.
 *   2. Group by organizationId.
 *   3. For each org, ensure Stripe customer (lazy first-time create).
 *   4. For each resolved claim, post a usage record with
 *      `idempotencyKey = claim.<id>.<billingPeriodStartIso>`.
 *   5. Persist a `BillingUsageRecord` row per claim — composite-unique
 *      on `(claimId, billingPeriodStart)` collapses duplicate runs to
 *      a single insert.
 *   6. Audit each Stripe call.
 *
 * The handler is a pure function over deps; the caller decides how
 * to invoke it (BullMQ repeatable job, GH Actions cron, manual CLI).
 */

export type DbClient = typeof prisma;

export interface RunReconciliationDeps {
  readonly logger: Logger;
  readonly prisma: DbClient;
  readonly billing: BillingPort;
  readonly env: BillingWorkerEnv;
  /** Override "now" for deterministic tests. */
  readonly clock?: () => Date;
}

export interface RunReconciliationResult {
  readonly orgsTouched: number;
  readonly claimsBilled: number;
  readonly stripeCalls: number;
  readonly recordsCreated: number;
  readonly recordsDeduplicated: number;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function startOfBillingPeriod(now: Date): Date {
  // UTC day boundary — the daily run's anchor.
  const period = new Date(now);
  period.setUTCHours(0, 0, 0, 0);
  return period;
}

interface ResolvedClaim {
  readonly organizationId: string;
  readonly claimId: string;
  readonly resolvedAt: Date;
}

export async function runReconciliation(
  deps: RunReconciliationDeps,
): Promise<RunReconciliationResult> {
  const clock = deps.clock ?? ((): Date => new Date());
  const now = clock();
  const since = new Date(now.getTime() - ONE_DAY_MS);
  const billingPeriodStart = startOfBillingPeriod(now);
  const periodIso = billingPeriodStart.toISOString();

  // Audit-log scan. The metadata field is JSON; we filter via Prisma's
  // Json path to keep the index usage clean.
  const audits = await deps.prisma.auditLog.findMany({
    where: {
      action: 'claim.transition',
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'asc' },
  });

  const resolvedByClaim = new Map<string, ResolvedClaim>();
  for (const row of audits) {
    const meta = row.metadata as Record<string, unknown> | null;
    const toStatus = meta && typeof meta.toStatus === 'string' ? meta.toStatus : null;
    const autoTransitioned =
      meta && typeof meta.autoTransitioned === 'boolean' ? meta.autoTransitioned : false;
    if (toStatus !== 'RESOLVED') continue;
    // Track the most recent resolved transition per claimId — manual
    // operator reverts followed by re-resolution still bill once.
    resolvedByClaim.set(row.resourceId, {
      organizationId: row.organizationId,
      claimId: row.resourceId,
      resolvedAt: row.createdAt,
    });
    deps.logger.debug(
      { claimId: row.resourceId, autoTransitioned },
      'reconciliation: candidate resolved claim',
    );
  }

  if (resolvedByClaim.size === 0) {
    return {
      orgsTouched: 0,
      claimsBilled: 0,
      stripeCalls: 0,
      recordsCreated: 0,
      recordsDeduplicated: 0,
    };
  }

  // Group by org so we ensureCustomer at most once per org per run.
  const byOrg = new Map<string, ResolvedClaim[]>();
  for (const r of resolvedByClaim.values()) {
    const list = byOrg.get(r.organizationId) ?? [];
    list.push(r);
    byOrg.set(r.organizationId, list);
  }

  let stripeCalls = 0;
  let recordsCreated = 0;
  let recordsDeduplicated = 0;

  for (const [orgId, claims] of byOrg) {
    const org = await deps.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, stripeCustomerId: true },
    });
    if (!org) {
      deps.logger.warn({ orgId }, 'reconciliation: org missing — skipping');
      continue;
    }

    // First OWNER's email — Stripe needs an invoice address.
    const owner = await deps.prisma.user.findFirst({
      where: { organizationId: orgId, role: { in: ['OWNER', 'ADMIN'] } },
      orderBy: { createdAt: 'asc' },
      select: { email: true },
    });
    if (!owner) {
      deps.logger.warn({ orgId }, 'reconciliation: org has no OWNER/ADMIN — skipping');
      continue;
    }

    if (!org.stripeCustomerId) {
      const customer = await deps.billing.ensureCustomer({
        organizationId: orgId,
        name: org.name,
        email: owner.email,
      });
      stripeCalls += 1;
      await deps.prisma.organization.update({
        where: { id: orgId },
        data: { stripeCustomerId: customer.stripeCustomerId },
      });
      await audit({
        action: 'billing.customer.ensured',
        resourceType: 'Organization',
        resourceId: orgId,
        organizationId: orgId,
        metadata: {
          stripeCustomerId: customer.stripeCustomerId,
          created: customer.created,
        },
      });
    }

    for (const r of claims) {
      const idempotencyKey = `claim.${r.claimId}.${periodIso}`;
      // The composite unique on (claimId, billingPeriodStart) makes
      // this UPSERT a 1:1 — even if the cron fires twice, only one
      // row exists.
      const existing = await deps.prisma.billingUsageRecord.findUnique({
        where: { idempotencyKey },
      });
      if (existing && existing.postedAt !== null) {
        recordsDeduplicated += 1;
        continue;
      }
      const result = await deps.billing.recordUsage({
        organizationId: orgId,
        claimId: r.claimId,
        amountCents: deps.env.STRIPE_PER_CLAIM_FEE_CENTS,
        billingPeriodStart,
        idempotencyKey,
      });
      stripeCalls += 1;
      const postedAt = new Date(result.postedAt);
      if (existing) {
        await deps.prisma.billingUsageRecord.update({
          where: { idempotencyKey },
          data: { stripeUsageRecordId: result.stripeUsageRecordId, postedAt },
        });
      } else {
        await deps.prisma.billingUsageRecord.create({
          data: {
            organizationId: orgId,
            claimId: r.claimId,
            billingPeriodStart,
            amountCents: deps.env.STRIPE_PER_CLAIM_FEE_CENTS,
            idempotencyKey,
            stripeUsageRecordId: result.stripeUsageRecordId,
            postedAt,
          },
        });
        recordsCreated += 1;
      }
      await audit({
        action: 'billing.usage.recorded',
        resourceType: 'Claim',
        resourceId: r.claimId,
        organizationId: orgId,
        metadata: {
          idempotencyKey,
          amountCents: deps.env.STRIPE_PER_CLAIM_FEE_CENTS,
          stripeUsageRecordId: result.stripeUsageRecordId,
          deduplicated: result.deduplicated,
          stripePosted: deps.env.STRIPE_METERED_BILLING_ENABLED,
        },
      });
    }
  }

  return {
    orgsTouched: byOrg.size,
    claimsBilled: resolvedByClaim.size,
    stripeCalls,
    recordsCreated,
    recordsDeduplicated,
  };
}
