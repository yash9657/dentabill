#!/usr/bin/env tsx
import { PrismaClient } from '@dentabill/db';
import { hashPatientDOB } from '@dentabill/db';

const prisma = new PrismaClient();

const ORG_CLERK_ID = 'local_test_org';
const USER_CLERK_ID = 'user_test_seed';
const HASH_SECRET = 'local-test-seed-secret';

async function main() {
  const org = await prisma.organization.upsert({
    where: { clerkOrgId: ORG_CLERK_ID },
    update: {},
    create: {
      clerkOrgId: ORG_CLERK_ID,
      name: 'Test Practice',
      npi: '1234567890',
    },
  });

  const user = await prisma.user.upsert({
    where: { clerkUserId: USER_CLERK_ID },
    update: { organizationId: org.id },
    create: {
      clerkUserId: USER_CLERK_ID,
      organizationId: org.id,
      role: 'OWNER',
      email: 'seed@test.local',
      name: 'Seed User',
    },
  });

  const payer = await prisma.payerConfig.upsert({
    where: {
      organizationId_payerCode: {
        organizationId: org.id,
        payerCode: 'DELTA_DENTAL_PPO',
      },
    },
    update: { enabled: true, providerNpi: org.npi },
    create: {
      organizationId: org.id,
      payerCode: 'DELTA_DENTAL_PPO',
      enabled: true,
      providerNpi: org.npi,
    },
  });

  const dob = '1985-06-15';
  const existingClaim = await prisma.claim.findFirst({
    where: { organizationId: org.id, claimNumber: 'TEST-001' },
  });
  const claim = existingClaim
    ? await prisma.claim.update({
        where: { id: existingClaim.id },
        data: { status: 'PENDING' },
      })
    : await prisma.claim.create({
        data: {
          organizationId: org.id,
          claimNumber: 'TEST-001',
          patientDOBHash: hashPatientDOB({
            dob,
            organizationId: org.id,
            secret: HASH_SECRET,
          }),
          patientDOBLast4: dob.slice(0, 4),
          cdtCodes: ['D2392'],
          claimAmount: 245.0,
          payerCode: 'DELTA_DENTAL_PPO',
          serviceDate: new Date('2026-04-01'),
          submittedDate: new Date('2026-04-05'),
          status: 'PENDING',
          priority: 50,
        },
      });

  console.log('\n=== Seed complete ===');
  console.log('Organization:', org.id);
  console.log('User       :', user.id, `(clerkUserId=${user.clerkUserId})`);
  console.log('PayerConfig:', payer.id);
  console.log('Claim      :', claim.id);
  console.log('\nUse these for curl:');
  console.log(`  export TEST_USER=${user.clerkUserId}`);
  console.log(`  export CLAIM_ID=${claim.id}`);
  console.log(
    `  curl -X POST http://localhost:3001/v1/claims/$CLAIM_ID/calls -H "x-test-user-id: $TEST_USER" -H "Content-Type: application/json"`,
  );
  console.log(`  curl http://localhost:3001/v1/calls -H "x-test-user-id: $TEST_USER" | jq`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
