import { describe, expect, it } from 'vitest';

import { prisma } from '../client.js';

import { MissingOrgScopeError } from './errors.js';
import { getOrgScopedDb } from './with-org.js';

async function seedTwoOrgsWithClaims() {
  const org1 = await prisma.organization.create({
    data: { name: 'Acme Dental', clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}` },
  });
  const org2 = await prisma.organization.create({
    data: { name: 'Beta Dental', clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}` },
  });

  await prisma.claim.createMany({
    data: [
      {
        organizationId: org1.id,
        patientDOBHash: 'hash1',
        claimNumber: 'CL-1',
        cdtCodes: ['D2740'],
        claimAmount: '100.00',
        payerCode: 'DELTA_DENTAL_PPO',
        serviceDate: new Date('2026-01-15'),
      },
      {
        organizationId: org1.id,
        patientDOBHash: 'hash2',
        claimNumber: 'CL-2',
        cdtCodes: ['D0150'],
        claimAmount: '200.00',
        payerCode: 'CIGNA_DENTAL',
        serviceDate: new Date('2026-02-15'),
      },
      {
        organizationId: org2.id,
        patientDOBHash: 'hash3',
        claimNumber: 'CL-3',
        cdtCodes: ['D2392'],
        claimAmount: '300.00',
        payerCode: 'METLIFE_DENTAL',
        serviceDate: new Date('2026-03-15'),
      },
    ],
  });

  return { org1, org2 };
}

describe('getOrgScopedDb()', () => {
  it('rejects empty or non-string orgIds synchronously', () => {
    expect(() => getOrgScopedDb('')).toThrow(MissingOrgScopeError);
    expect(() => getOrgScopedDb(undefined as unknown as string)).toThrow(MissingOrgScopeError);
    expect(() => getOrgScopedDb(null as unknown as string)).toThrow(MissingOrgScopeError);
  });

  it('findMany on Claim returns only the calling org rows', async () => {
    const { org1, org2 } = await seedTwoOrgsWithClaims();

    const org1Db = getOrgScopedDb(org1.id);
    const org2Db = getOrgScopedDb(org2.id);

    const claims1 = await org1Db.claim.findMany();
    const claims2 = await org2Db.claim.findMany();

    expect(claims1).toHaveLength(2);
    expect(claims1.every((c) => c.organizationId === org1.id)).toBe(true);
    expect(claims2).toHaveLength(1);
    expect(claims2[0]?.organizationId).toBe(org2.id);
  });

  it('respects scope when caller adds their own where filter', async () => {
    const { org1 } = await seedTwoOrgsWithClaims();
    const org1Db = getOrgScopedDb(org1.id);
    const claims = await org1Db.claim.findMany({
      where: { payerCode: 'DELTA_DENTAL_PPO' },
    });
    expect(claims).toHaveLength(1);
    expect(claims[0]?.claimNumber).toBe('CL-1');
  });

  it('does not leak across orgs when caller naively filters by id only', async () => {
    const { org1, org2 } = await seedTwoOrgsWithClaims();
    const org2Claim = await prisma.claim.findFirstOrThrow({
      where: { organizationId: org2.id },
    });

    const org1Db = getOrgScopedDb(org1.id);
    const result = await org1Db.claim.findFirst({ where: { id: org2Claim.id } });
    expect(result).toBeNull();
  });

  it('count() returns the calling org count', async () => {
    const { org1, org2 } = await seedTwoOrgsWithClaims();
    expect(await getOrgScopedDb(org1.id).claim.count()).toBe(2);
    expect(await getOrgScopedDb(org2.id).claim.count()).toBe(1);
  });

  it('scopes User reads', async () => {
    const { org1, org2 } = await seedTwoOrgsWithClaims();
    await prisma.user.createMany({
      data: [
        { organizationId: org1.id, clerkUserId: 'u1', email: 'a@a.com', role: 'OWNER' },
        { organizationId: org2.id, clerkUserId: 'u2', email: 'b@b.com', role: 'OWNER' },
      ],
    });
    const users1 = await getOrgScopedDb(org1.id).user.findMany();
    expect(users1).toHaveLength(1);
    expect(users1[0]?.clerkUserId).toBe('u1');
  });

  it('scopes AuditLog reads', async () => {
    const { org1, org2 } = await seedTwoOrgsWithClaims();
    await prisma.auditLog.createMany({
      data: [
        {
          organizationId: org1.id,
          action: 'claim.read',
          resourceType: 'Claim',
          resourceId: 'clm_x',
        },
        {
          organizationId: org2.id,
          action: 'claim.read',
          resourceType: 'Claim',
          resourceId: 'clm_y',
        },
      ],
    });
    expect(await getOrgScopedDb(org1.id).auditLog.count()).toBe(1);
    expect(await getOrgScopedDb(org2.id).auditLog.count()).toBe(1);
    const logs1 = await getOrgScopedDb(org1.id).auditLog.findMany();
    expect(logs1[0]?.organizationId).toBe(org1.id);
  });

  // P4-T1A — CallSummary holds PHI (rawTranscript + claudeSummary) and
  // must be org-scoped. Regression guard: re-running these against a
  // pre-P4-T1A build returns rows from both orgs and trips the
  // assertions immediately.
  it('scopes CallSummary reads', async () => {
    const { org1, org2 } = await seedTwoOrgsWithClaims();
    const claim1 = await prisma.claim.findFirstOrThrow({ where: { organizationId: org1.id } });
    const claim2 = await prisma.claim.findFirstOrThrow({ where: { organizationId: org2.id } });
    const call1 = await prisma.call.create({
      data: {
        organizationId: org1.id,
        claimId: claim1.id,
        retellCallId: 'rc_summary_org1',
        status: 'COMPLETED',
        attemptNumber: 1,
      },
    });
    const call2 = await prisma.call.create({
      data: {
        organizationId: org2.id,
        claimId: claim2.id,
        retellCallId: 'rc_summary_org2',
        status: 'COMPLETED',
        attemptNumber: 1,
      },
    });
    await prisma.callSummary.createMany({
      data: [
        {
          organizationId: org1.id,
          callId: call1.id,
          claimStatus: 'RESOLVED',
          nextAction: 'RESOLVED',
          rawTranscript: 'transcript-org1',
          claudeSummary: 'summary-org1',
        },
        {
          organizationId: org2.id,
          callId: call2.id,
          claimStatus: 'RESOLVED',
          nextAction: 'RESOLVED',
          rawTranscript: 'transcript-org2',
          claudeSummary: 'summary-org2',
        },
      ],
    });

    const summaries1 = await getOrgScopedDb(org1.id).callSummary.findMany();
    const summaries2 = await getOrgScopedDb(org2.id).callSummary.findMany();

    expect(summaries1).toHaveLength(1);
    expect(summaries1[0]?.organizationId).toBe(org1.id);
    expect(summaries1[0]?.rawTranscript).toBe('transcript-org1');
    expect(summaries2).toHaveLength(1);
    expect(summaries2[0]?.organizationId).toBe(org2.id);
  });

  it('does not leak CallSummary across orgs when caller filters by callId only', async () => {
    const { org1, org2 } = await seedTwoOrgsWithClaims();
    const claim2 = await prisma.claim.findFirstOrThrow({ where: { organizationId: org2.id } });
    const call2 = await prisma.call.create({
      data: {
        organizationId: org2.id,
        claimId: claim2.id,
        retellCallId: 'rc_leak_check',
        status: 'COMPLETED',
        attemptNumber: 1,
      },
    });
    await prisma.callSummary.create({
      data: {
        organizationId: org2.id,
        callId: call2.id,
        claimStatus: 'RESOLVED',
        nextAction: 'RESOLVED',
        rawTranscript: 'org2 transcript',
        claudeSummary: 'org2 summary',
      },
    });

    // Org 1 attempts to read org 2's summary by its callId. The scope
    // helper must apply organizationId=org1 and return nothing, even
    // though the underlying callId exists.
    const result = await getOrgScopedDb(org1.id).callSummary.findFirst({
      where: { callId: call2.id },
    });
    expect(result).toBeNull();
  });

  it('count() on CallSummary is org-scoped', async () => {
    const { org1, org2 } = await seedTwoOrgsWithClaims();
    const [claim1] = await Promise.all([
      prisma.claim.findFirstOrThrow({ where: { organizationId: org1.id } }),
    ]);
    const claim2 = await prisma.claim.findFirstOrThrow({ where: { organizationId: org2.id } });
    const [c1, c2] = await Promise.all([
      prisma.call.create({
        data: {
          organizationId: org1.id,
          claimId: claim1.id,
          retellCallId: 'rc_count_org1',
          status: 'COMPLETED',
          attemptNumber: 1,
        },
      }),
      prisma.call.create({
        data: {
          organizationId: org2.id,
          claimId: claim2.id,
          retellCallId: 'rc_count_org2',
          status: 'COMPLETED',
          attemptNumber: 1,
        },
      }),
    ]);
    await prisma.callSummary.createMany({
      data: [
        {
          organizationId: org1.id,
          callId: c1.id,
          claimStatus: 'RESOLVED',
          nextAction: 'RESOLVED',
          rawTranscript: 't1',
          claudeSummary: 's1',
        },
        {
          organizationId: org2.id,
          callId: c2.id,
          claimStatus: 'RESOLVED',
          nextAction: 'RESOLVED',
          rawTranscript: 't2',
          claudeSummary: 's2',
        },
      ],
    });
    expect(await getOrgScopedDb(org1.id).callSummary.count()).toBe(1);
    expect(await getOrgScopedDb(org2.id).callSummary.count()).toBe(1);
  });
});
