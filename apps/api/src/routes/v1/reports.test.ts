import { prisma } from '@dentabill/db';
import type { Organization } from '@dentabill/db';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildServer } from '../../app.js';

import type { ReportsSummaryResponse as Report } from './reports.js';

async function makeOrg(name: string): Promise<Organization> {
  return prisma.organization.create({
    data: { name, clerkOrgId: `clerk_${Math.random().toString(36).slice(2)}`, npi: '1234567890' },
  });
}

const unavailablePayments = {
  status: 'unavailable',
  reason: 'PAYMENT_LEDGER_NOT_IMPLEMENTED',
  amountCents: null,
};

describe('GET /v1/reports/summary (FW-01/FW-02)', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    server = await buildServer({ logger: false });
    await prisma.$connect();
  });

  afterAll(async () => {
    await server.close();
    await prisma.$disconnect();
  });

  afterEach(async () => {
    vi.useRealTimers();
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Organization", "User", "Claim", "Call", "CallSummary", "CallEvent", "PayerConfig", "AuditLog", "BillingUsageRecord" RESTART IDENTITY CASCADE',
    );
  });

  async function getReport(orgId: string): Promise<Report> {
    const response = await server.inject({
      method: 'GET',
      url: '/v1/reports/summary',
      headers: { 'x-test-user-id': 'user_a', 'x-test-org-id': orgId },
    });
    expect(response.statusCode).toBe(200);
    return response.json<Report>();
  }

  function expectEmptyWeeks(weeks: Report['callActivityByWeek']): void {
    expect(weeks).toHaveLength(8);
    expect(
      weeks.every(
        (week) =>
          week.callCount === 0 && week.completedCallCount === 0 && week.uniqueClaimCount === 0,
      ),
    ).toBe(true);
  }

  async function seedRepeatedCalls(orgId: string): Promise<void> {
    const resolved = await prisma.claim.create({
      data: {
        organizationId: orgId,
        patientDOBHash: 'hash_resolved',
        claimNumber: 'CL-PARTIAL',
        cdtCodes: ['D2740'],
        claimAmount: '300.00',
        payerCode: 'DELTA_DENTAL_PPO',
        serviceDate: new Date('2026-01-15T00:00:00Z'),
        status: 'RESOLVED',
        priority: 80,
      },
    });
    const denied = await prisma.claim.create({
      data: {
        organizationId: orgId,
        patientDOBHash: 'hash_denied',
        claimNumber: 'CL-DENIED',
        cdtCodes: ['D2740'],
        claimAmount: '250.00',
        payerCode: 'DELTA_DENTAL_PPO',
        serviceDate: new Date('2026-01-15T00:00:00Z'),
        status: 'DENIED',
        priority: 80,
      },
    });
    for (const [index, claimId] of [resolved.id, resolved.id, denied.id, denied.id].entries()) {
      const call = await prisma.call.create({
        data: {
          organizationId: orgId,
          claimId,
          retellCallId: `${orgId}_call_${String(index)}`,
          status: index === 3 ? 'FAILED' : 'COMPLETED',
          attemptNumber: index + 1,
          startedAt: new Date(),
          endedAt: new Date(),
          durationSeconds: 60,
        },
      });
      await prisma.callSummary.create({
        data: {
          organizationId: orgId,
          callId: call.id,
          claimStatus: claimId === resolved.id ? 'PAID' : 'DENIED',
          amountApproved: claimId === resolved.id ? '100.00' : null,
          denialCode: claimId === denied.id ? 'CO-16' : null,
          denialReason: claimId === denied.id ? 'Missing information' : null,
          nextAction: 'MANUAL_REVIEW',
          rawTranscript: 'Synthetic payer report; payment has not been reconciled.',
          claudeSummary: 'Synthetic fixture',
        },
      });
    }
  }

  it('rejects unauthenticated requests', async () => {
    const response = await server.inject({ method: 'GET', url: '/v1/reports/summary' });
    expect(response.statusCode).toBe(401);
  });

  it('reports an unavailable payment metric, including for an empty organization', async () => {
    const org = await makeOrg('Empty');
    const body = await getReport(org.id);
    expect(body.verifiedPayments).toEqual(unavailablePayments);
    expectEmptyWeeks(body.callActivityByWeek);
    expect(body.payerOutcomes).toEqual([]);
    expect(body.denialReasons).toEqual([]);
    expect(body.claimAging.every((bucket) => bucket.count === 0)).toBe(true);
    expect(body.callVolume).toEqual([]);
    expect(body).not.toHaveProperty('recoveredByWeek');
  });

  it('separates repeated calls, completed calls, distinct claims and claims marked resolved', async () => {
    const org = await makeOrg('Repeated calls');
    await seedRepeatedCalls(org.id);
    const body = await getReport(org.id);
    expect(body.payerOutcomes).toEqual([
      {
        payer: 'DELTA_DENTAL_PPO',
        callCount: 4,
        completedCallCount: 3,
        uniqueClaimCount: 2,
        claimsMarkedResolvedCount: 1,
        avgDurationSeconds: 60,
      },
    ]);
    expect(body.callActivityByWeek).toHaveLength(8);
    expect(body.callActivityByWeek.at(-1)).toMatchObject({
      callCount: 4,
      completedCallCount: 3,
      uniqueClaimCount: 2,
    });
    expect(body.denialReasons).toEqual([
      { code: 'CO-16', label: 'Missing information', uniqueClaimCount: 1 },
    ]);
    expect(body.verifiedPayments).toEqual(unavailablePayments);
    expect(body.payerOutcomes[0]).not.toHaveProperty('recoveredCents');
    expect(body.payerOutcomes[0]).not.toHaveProperty('resolvedCount');

    const stats = await server.inject({
      method: 'GET',
      url: '/v1/calls/stats',
      headers: { 'x-test-user-id': 'user_a', 'x-test-org-id': org.id },
    });
    expect(stats.statusCode).toBe(200);
    expect(stats.json()).toMatchObject({ callsToday: 4, verifiedPayments: unavailablePayments });
    expect(stats.json()).not.toHaveProperty('recoveredThisWeekCents');
  });

  it('uses call start time for weekly activity, not a resolved claim modification time', async () => {
    const org = await makeOrg('Historical activity');
    await seedRepeatedCalls(org.id);
    await prisma.call.updateMany({
      where: { organizationId: org.id },
      data: { startedAt: new Date(Date.now() - 70 * 24 * 60 * 60 * 1000) },
    });
    const body = await getReport(org.id);
    expectEmptyWeeks(body.callActivityByWeek);
    expect(body.callVolume).toEqual([]);
    expect(body.payerOutcomes[0]).toMatchObject({ callCount: 4, uniqueClaimCount: 2 });
    expect(body.verifiedPayments.amountCents).toBeNull();
  });

  it('fills all eight Monday cohorts and preserves gaps, time boundaries, and tenant scope', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-12T00:00:00.000Z'));
    const org = await makeOrg('Weekly boundaries');
    const otherOrg = await makeOrg('Other weekly activity');
    await seedRepeatedCalls(otherOrg.id);
    const claim = await prisma.claim.create({
      data: {
        organizationId: org.id,
        patientDOBHash: 'hash_weekly',
        claimNumber: 'CL-WEEKLY',
        cdtCodes: ['D2740'],
        claimAmount: '300.00',
        payerCode: 'DELTA_DENTAL_PPO',
        serviceDate: new Date('2026-01-15T00:00:00Z'),
        priority: 80,
      },
    });
    const starts = [
      '2026-08-23T23:59:59.999Z',
      '2026-08-24T00:00:00.000Z',
      '2026-08-24T12:00:00.000Z',
      '2026-10-11T23:59:59.999Z',
      '2026-10-12T00:00:00.000Z',
      '2026-10-12T00:00:00.001Z',
      null,
    ];
    await prisma.call.createMany({
      data: starts.map((startedAt, index) => ({
        organizationId: org.id,
        claimId: claim.id,
        retellCallId: `${org.id}_boundary_${String(index)}`,
        status: 'COMPLETED' as const,
        attemptNumber: index + 1,
        startedAt: startedAt ? new Date(startedAt) : null,
      })),
    });
    const body = await getReport(org.id);
    expect(body.callActivityByWeek).toEqual([
      { weekStart: '2026-08-24', callCount: 2, completedCallCount: 2, uniqueClaimCount: 1 },
      { weekStart: '2026-08-31', callCount: 0, completedCallCount: 0, uniqueClaimCount: 0 },
      { weekStart: '2026-09-07', callCount: 0, completedCallCount: 0, uniqueClaimCount: 0 },
      { weekStart: '2026-09-14', callCount: 0, completedCallCount: 0, uniqueClaimCount: 0 },
      { weekStart: '2026-09-21', callCount: 0, completedCallCount: 0, uniqueClaimCount: 0 },
      { weekStart: '2026-09-28', callCount: 0, completedCallCount: 0, uniqueClaimCount: 0 },
      { weekStart: '2026-10-05', callCount: 1, completedCallCount: 1, uniqueClaimCount: 1 },
      { weekStart: '2026-10-12', callCount: 1, completedCallCount: 1, uniqueClaimCount: 1 },
    ]);
    expect(body.payerOutcomes[0]?.uniqueClaimCount).toBe(1);
    expect(body.verifiedPayments).toEqual(unavailablePayments);
  });

  it('isolates all reporting aggregates by organization', async () => {
    const orgA = await makeOrg('A');
    const orgB = await makeOrg('B');
    await seedRepeatedCalls(orgB.id);
    const a = await getReport(orgA.id);
    const b = await getReport(orgB.id);
    expectEmptyWeeks(a.callActivityByWeek);
    expect(a.payerOutcomes).toEqual([]);
    expect(a.denialReasons).toEqual([]);
    expect(a.callVolume).toEqual([]);
    expect(a.claimAging.every((bucket) => bucket.count === 0)).toBe(true);
    expect(b.payerOutcomes[0]).toMatchObject({ callCount: 4, uniqueClaimCount: 2 });
    expect(b.denialReasons[0]?.uniqueClaimCount).toBe(1);
    expect(b.callVolume.reduce((sum, day) => sum + day.callCount, 0)).toBe(4);
  });
});
