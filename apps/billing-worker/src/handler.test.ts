import { FakeStripe } from '@dentabill/billing';
import { audit, prisma } from '@dentabill/db';
import { createLogger } from '@dentabill/logger';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { loadBillingWorkerEnv } from './env.js';
import { runReconciliation } from './handler.js';

const silentLogger = createLogger({
  level: 'fatal',
  pretty: false,
  base: { service: 'billing-worker-test' },
});

const env = loadBillingWorkerEnv({
  DATABASE_URL: 'postgresql://dentabill:dentabill@localhost:5432/dentabill_test?schema=public',
  STRIPE_API_KEY: '',
  STRIPE_METERED_BILLING_ENABLED: 'false',
  STRIPE_PER_CLAIM_FEE_CENTS: '50',
});

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Organization", "User", "Claim", "Call", "CallSummary", "CallEvent", "PayerConfig", "AuditLog", "BillingUsageRecord" RESTART IDENTITY CASCADE',
  );
});

interface SeedResult {
  readonly orgId: string;
  readonly claimId: string;
}

async function seedOrgWithResolvedClaim(opts?: {
  readonly autoTransitioned?: boolean;
  readonly toStatus?: string;
}): Promise<SeedResult> {
  const org = await prisma.organization.create({
    data: { name: 'Acme', clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}` },
  });
  await prisma.user.create({
    data: {
      organizationId: org.id,
      clerkUserId: `clerk_user_${Math.random().toString(36).slice(2)}`,
      email: 'owner@acme.test',
      role: 'OWNER',
    },
  });
  const claim = await prisma.claim.create({
    data: {
      organizationId: org.id,
      patientDOBHash: 'h',
      claimNumber: `CL-${Math.random().toString(36).slice(2, 6)}`,
      cdtCodes: ['D2740'],
      claimAmount: '100.00',
      payerCode: 'DELTA_DENTAL_PPO',
      serviceDate: new Date(),
      status: 'RESOLVED',
    },
  });
  await audit({
    action: 'claim.transition',
    resourceType: 'Claim',
    resourceId: claim.id,
    organizationId: org.id,
    metadata: {
      toStatus: opts?.toStatus ?? 'RESOLVED',
      autoTransitioned: opts?.autoTransitioned ?? true,
      fromStatus: 'COMPLETED',
    },
  });
  return { orgId: org.id, claimId: claim.id };
}

describe('runReconciliation', () => {
  it('writes one BillingUsageRecord per RESOLVED claim and ensures Stripe customer', async () => {
    const seed = await seedOrgWithResolvedClaim();
    const billing = new FakeStripe();

    const result = await runReconciliation({
      logger: silentLogger,
      prisma,
      billing,
      env,
    });

    expect(result.claimsBilled).toBe(1);
    expect(result.recordsCreated).toBe(1);
    expect(result.orgsTouched).toBe(1);

    const record = await prisma.billingUsageRecord.findFirstOrThrow({
      where: { claimId: seed.claimId },
    });
    expect(record.amountCents).toBe(50);
    expect(record.organizationId).toBe(seed.orgId);
    expect(record.idempotencyKey).toMatch(/^claim\..+\..+/);

    const orgAfter = await prisma.organization.findUniqueOrThrow({ where: { id: seed.orgId } });
    expect(orgAfter.stripeCustomerId).toMatch(/^cus_fake_/);
  });

  it('is idempotent — second run does not create duplicate records', async () => {
    const seed = await seedOrgWithResolvedClaim();
    const billing = new FakeStripe();

    const first = await runReconciliation({ logger: silentLogger, prisma, billing, env });
    const second = await runReconciliation({ logger: silentLogger, prisma, billing, env });
    expect(first.recordsCreated).toBe(1);
    expect(second.recordsCreated).toBe(0);
    expect(second.recordsDeduplicated).toBe(1);
    const records = await prisma.billingUsageRecord.findMany({
      where: { claimId: seed.claimId },
    });
    expect(records).toHaveLength(1);
  });

  it('skips claims whose audit toStatus is not RESOLVED', async () => {
    await seedOrgWithResolvedClaim({ toStatus: 'NEEDS_INFO' });
    const billing = new FakeStripe();
    const result = await runReconciliation({ logger: silentLogger, prisma, billing, env });
    expect(result.claimsBilled).toBe(0);
    expect(result.recordsCreated).toBe(0);
  });

  it('does not bill across orgs (cross-tenant guard)', async () => {
    const seedA = await seedOrgWithResolvedClaim();
    const seedB = await seedOrgWithResolvedClaim();
    const billing = new FakeStripe();
    const result = await runReconciliation({ logger: silentLogger, prisma, billing, env });
    expect(result.orgsTouched).toBe(2);
    expect(result.recordsCreated).toBe(2);
    const recordsA = await prisma.billingUsageRecord.findMany({
      where: { organizationId: seedA.orgId },
    });
    const recordsB = await prisma.billingUsageRecord.findMany({
      where: { organizationId: seedB.orgId },
    });
    expect(recordsA).toHaveLength(1);
    expect(recordsB).toHaveLength(1);
    expect(recordsA[0]?.claimId).toBe(seedA.claimId);
    expect(recordsB[0]?.claimId).toBe(seedB.claimId);
  });

  it('audits billing.usage.recorded with stripePosted=false in receipt-only mode', async () => {
    const seed = await seedOrgWithResolvedClaim();
    const billing = new FakeStripe();
    await runReconciliation({ logger: silentLogger, prisma, billing, env });
    const auditRow = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: 'billing.usage.recorded',
        organizationId: seed.orgId,
      },
    });
    const meta = auditRow.metadata as Record<string, unknown>;
    expect(meta.stripePosted).toBe(false);
    expect(meta.amountCents).toBe(50);
  });
});
