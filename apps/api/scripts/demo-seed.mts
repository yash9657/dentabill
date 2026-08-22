#!/usr/bin/env tsx
/**
 * Demo data seeder — idempotent, deterministic, reproducible.
 *
 * Creates a demo organization ("Bright Smile Dental") with realistic claim
 * data across multiple payers and statuses. Safe to run repeatedly.
 *
 * Usage:
 *   pnpm --filter @dentabill/api exec tsx scripts/demo-seed.mts
 *   pnpm --filter @dentabill/api exec tsx scripts/demo-seed.mts --reset
 *
 * Flags:
 *   --reset   Wipe the demo org first (useful for clean re-seeds).
 */

import { PrismaClient, hashPatientDOB, type Organization, type User } from '@dentabill/db';
import {
  buildOrganization,
  buildUser,
  buildPayerConfig,
  buildClaim,
  buildCall,
  buildCallEvent,
  buildCallSummary,
  buildBillingUsageRecord,
} from './lib/demo-builders.mts';

const prisma = new PrismaClient();

// Seeding parameters
const DEMO_ORG_CLERK_ID = 'demo_bright_smile_org';
const DEMO_USER_CLERK_ID = 'demo_bright_smile_user';

// Claim status distribution (total: 40).
//
// RESOLVED is load-bearing, not decorative: `/v1/calls/stats` computes
// `recoveredThisWeekCents` as the sum of claimAmount over claims that are
// RESOLVED and were updated in the last 7 days. A distribution without it
// makes the dashboard's headline "recovered this week" tile read $0. The plan's
// 10-strong "COMPLETED" bucket is therefore split — COMPLETED means the call
// finished, RESOLVED means the money landed.
const CLAIM_DISTRIBUTION = {
  PENDING: 12,
  IN_QUEUE: 2,
  CALLING: 1,
  COMPLETED: 4,
  RESOLVED: 6,
  DENIED: 6,
  MANUAL_REVIEW: 5,
  NEEDS_INFO: 4,
};

/** Statuses whose claims carry a completed call, transcript, and summary. */
const CALLED_STATUSES = new Set(['COMPLETED', 'RESOLVED', 'DENIED', 'MANUAL_REVIEW', 'NEEDS_INFO']);

/**
 * Generate pseudo-random integer in [min, max).
 * Uses a simple deterministic method seeded from current time for variety
 * within each run while maintaining reproducibility across runs.
 */
function randomBetween(min: number, max: number, seed: number): number {
  const x = Math.sin(seed) * 10000;
  return Math.floor((x - Math.floor(x)) * (max - min)) + min;
}

async function main() {
  const args = process.argv.slice(2);
  const shouldReset = args.includes('--reset');

  console.log('\n🌿 DentaBill Demo Seed');
  console.log('─'.repeat(50));

  // ─── Setup ─────────────────────────────────────────────────────────

  let org: Organization;
  let user: User;

  if (shouldReset) {
    console.log('\n📋 --reset flag detected. Wiping demo org...');
    const existing = await prisma.organization.findUnique({
      where: { clerkOrgId: DEMO_ORG_CLERK_ID },
    });
    if (existing) {
      // Cascade delete via Prisma relations will clean up all dependent rows
      await prisma.organization.delete({ where: { id: existing.id } });
      console.log(`   ✓ Deleted org ${existing.id}`);
    }
  }

  console.log('\n1️⃣ Creating organization...');
  org = await prisma.organization.upsert({
    where: { clerkOrgId: DEMO_ORG_CLERK_ID },
    update: {},
    create: buildOrganization({
      clerkOrgId: DEMO_ORG_CLERK_ID,
      name: 'Bright Smile Dental',
      npi: '9999999999',
    }),
  });
  console.log(`   ✓ Organization: ${org.id} (${org.name})`);

  console.log('\n2️⃣ Creating user...');
  user = await prisma.user.upsert({
    where: { clerkUserId: DEMO_USER_CLERK_ID },
    update: { organizationId: org.id },
    create: buildUser(org.id, {
      clerkUserId: DEMO_USER_CLERK_ID,
      email: 'demo@brightsmile.local',
      name: 'Demo User',
    }),
  });
  console.log(`   ✓ User: ${user.id} (${user.email})`);

  // ─── Payer Configs ─────────────────────────────────────────────────

  console.log('\n3️⃣ Creating payer configurations...');
  const payerCodes = ['DELTA_DENTAL_PPO', 'CIGNA_DENTAL', 'METLIFE_DENTAL'] as const;
  const payerConfigs = await Promise.all(
    payerCodes.map((payerCode) =>
      prisma.payerConfig.upsert({
        where: {
          organizationId_payerCode: { organizationId: org.id, payerCode },
        },
        update: { enabled: true },
        create: buildPayerConfig(org.id, payerCode),
      }),
    ),
  );
  payerConfigs.forEach((pc) => console.log(`   ✓ ${pc.payerCode}`));

  // ─── Claims & Calls ────────────────────────────────────────────────

  console.log('\n4️⃣ Creating claims and associated data...');
  const claims: { id: string; status: string }[] = [];
  let claimIndex = 0;

  // Create claims in each status category
  for (const [status, count] of Object.entries(CLAIM_DISTRIBUTION)) {
    for (let i = 0; i < count; i++) {
      const payer = payerCodes[claimIndex % payerCodes.length];

      // Find or create the claim
      const claimNumber = `DEMO-${String(claimIndex).padStart(3, '0')}`;
      let claim = await prisma.claim.findFirst({
        where: { organizationId: org.id, claimNumber },
      });

      if (!claim) {
        claim = await prisma.claim.create({
          data: buildClaim(org.id, {
            claimNumber,
            payerCode: payer,
            status,
          }),
        });
      } else if (claim.status !== status) {
        // Update existing claim to the desired status
        claim = await prisma.claim.update({
          where: { id: claim.id },
          data: { status },
        });
      }

      claims.push({ id: claim.id, status });

      // Only statuses that represent a finished call get a transcript and a
      // summary. PENDING has never been dialled; IN_QUEUE and CALLING are
      // mid-flight, so fabricating a completed call for them would contradict
      // the status badge the dashboard shows.
      if (CALLED_STATUSES.has(status)) {
        const existingCall = await prisma.call.findFirst({
          where: { organizationId: org.id, claimId: claim.id },
        });

        if (!existingCall) {
          // Create the Call
          const callData = buildCall(org.id, claim.id);
          const call = await prisma.call.create({
            data: callData,
          });

          // Create CallEvents (transcript events)
          const callStartTime = callData.startedAt ?? new Date();
          const events = [
            { type: 'ivr.prompt', data: { text: 'Welcome to Dental Insurance.' }, offset: 0 },
            { type: 'ivr.dtmf', data: { digits: '1' }, offset: 3000 },
            { type: 'ivr.prompt', data: { text: 'Transferring to agent.' }, offset: 4000 },
            { type: 'call.hold_start', data: { duration_ms: 45000 }, offset: 5000 },
            { type: 'call.hold_end', data: {}, offset: 50000 },
            { type: 'call.human_reached', data: { rep_name: 'Agent' }, offset: 51000 },
            { type: 'agent.speech', data: { text: 'Hi, can I help you?' }, offset: 52000 },
            { type: 'call.completed', data: { reason: 'normal_end' }, offset: 55000 },
          ];

          await Promise.all(
            events.map((event) =>
              prisma.callEvent.create({
                data: buildCallEvent(
                  call.id,
                  event.type,
                  event.data,
                  new Date(callStartTime.getTime() + event.offset),
                ),
              }),
            ),
          );

          // Create CallSummary
          const isDenied = status === 'DENIED';
          await prisma.callSummary.create({
            data: buildCallSummary(org.id, call.id, {
              claimStatus: isDenied ? 'DENIED' : 'APPROVED',
              denialCode: isDenied ? 'CO-50' : null,
              denialReason: isDenied ? 'Non-covered service' : null,
              nextAction: isDenied ? 'APPEAL' : 'RESOLVED',
            }),
          });
        }
      }

      claimIndex++;
    }
  }

  console.log(`   ✓ Created ${claimIndex} claims across ${Object.keys(CLAIM_DISTRIBUTION).length} statuses`);

  // ─── Billing Usage ─────────────────────────────────────────────────

  console.log('\n5️⃣ Creating billing usage records...');
  // Create billing records for COMPLETED and DENIED claims
  const billingClaims = claims.filter((c) => CALLED_STATUSES.has(c.status));
  const billingPromises = billingClaims.map((c) =>
    prisma.billingUsageRecord.upsert({
      where: { claimId_billingPeriodStart: { claimId: c.id, billingPeriodStart: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      update: {},
      create: buildBillingUsageRecord(org.id, c.id),
    }),
  );
  await Promise.all(billingPromises);
  console.log(`   ✓ Created ${billingClaims.length} usage records`);

  // ─── KPI Stats ─────────────────────────────────────────────────────

  console.log('\n6️⃣ Computing KPI targets...');

  // Replicate the /v1/calls/stats logic
  const now = new Date();
  const startOfTodayUTC = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  );
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [callsToday, queueDepth, avgCallRow, recoveredRows] = await Promise.all([
    prisma.call.count({
      where: { organizationId: org.id, startedAt: { gte: startOfTodayUTC } },
    }),
    prisma.claim.count({
      where: { organizationId: org.id, status: { in: ['PENDING', 'IN_QUEUE', 'CALLING'] } },
    }),
    prisma.call.aggregate({
      _avg: { durationSeconds: true },
      where: {
        organizationId: org.id,
        endedAt: { gte: sevenDaysAgo },
        durationSeconds: { not: null },
      },
    }),
    prisma.claim.findMany({
      where: {
        organizationId: org.id,
        status: 'RESOLVED',
        updatedAt: { gte: sevenDaysAgo },
      },
      select: { claimAmount: true },
    }),
  ]);

  const avgCallSeconds =
    avgCallRow._avg.durationSeconds === null
      ? null
      : Math.round(avgCallRow._avg.durationSeconds);

  const recoveredThisWeekCents = recoveredRows.reduce((acc, row) => {
    const dollars = Number(row.claimAmount);
    if (Number.isNaN(dollars)) return acc;
    return acc + Math.round(dollars * 100);
  }, 0);

  console.log('\n📊 KPI Snapshot:');
  console.log(`   callsToday: ${callsToday} (target >= 3)`);
  console.log(`   queueDepth: ${queueDepth}`);
  console.log(
    `   recoveredThisWeekCents: $${(recoveredThisWeekCents / 100).toFixed(2)} (target ~$4,000–$8,000)`,
  );
  console.log(`   avgCallSeconds: ${avgCallSeconds ?? 'n/a'} (target: realistic 180–600s)`);

  // ─── Summary ────────────────────────────────────────────────────────

  console.log('\n✅ Seed complete!');
  console.log('─'.repeat(50));
  console.log('\n📋 Demo Organization Details:');
  console.log(`   Org ID: ${org.id}`);
  console.log(`   Clerk Org ID: ${org.clerkOrgId}`);
  console.log(`   User ID: ${user.id}`);
  console.log(`   Clerk User ID: ${user.clerkUserId}`);
  console.log(`   Claims: ${claims.length}`);
  console.log('\n🎯 Next Steps:');
  console.log('   1. Start the API: pnpm --filter @dentabill/api exec npm run dev');
  console.log('   2. Start the web app: pnpm --filter @dentabill/web exec npm run dev');
  console.log('   3. Open http://localhost:3000 in your browser');
  console.log('   4. Sign in with test header:');
  console.log(`      export TEST_USER_ID="${user.clerkUserId}"`);
  console.log(`      export TEST_ORG_ID="${org.id}"`);
  console.log('   5. Dashboard will load with demo data');
}

main()
  .catch((err) => {
    console.error('\n❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
