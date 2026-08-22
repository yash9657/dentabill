import { audit, prisma } from '@dentabill/db';
import { ApiError } from '@dentabill/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

/**
 * `/v1/reports/summary` — aggregate metrics for dashboard overview.
 *
 * Returns org-scoped aggregates across claims and calls:
 * - recoveredByWeek: last 8 weeks of claim resolutions
 * - denialReasons: breakdown by denial code
 * - claimAging: buckets (0-7, 8-14, 15-30, 31-60, 60+ days)
 * - payerOutcomes: per-payer call/resolution metrics
 * - callVolume: last 14 days of daily call counts
 */

const DayBucketSchema = z.object({
  day: z.string(), // ISO date string YYYY-MM-DD
  callCount: z.number().int().min(0),
  avgDurationSeconds: z.number().int().min(0).nullable(),
});

const WeekBucketSchema = z.object({
  weekStart: z.string(), // ISO date string YYYY-MM-DD
  recoveredCents: z.number().int().min(0),
  claimCount: z.number().int().min(0),
});

const DenialReasonSchema = z.object({
  code: z.string(),
  label: z.string(),
  count: z.number().int().min(0),
});

const ClaimAgingBucketSchema = z.object({
  bucket: z.enum(['0-7', '8-14', '15-30', '31-60', '60+']),
  count: z.number().int().min(0),
});

const PayerOutcomeSchema = z.object({
  payer: z.string(),
  callCount: z.number().int().min(0),
  resolvedCount: z.number().int().min(0),
  avgDurationSeconds: z.number().int().min(0).nullable(),
  recoveredCents: z.number().int().min(0),
});

const ReportsSummaryResponseSchema = z.object({
  recoveredByWeek: z.array(WeekBucketSchema),
  denialReasons: z.array(DenialReasonSchema),
  claimAging: z.array(ClaimAgingBucketSchema),
  payerOutcomes: z.array(PayerOutcomeSchema),
  callVolume: z.array(DayBucketSchema),
});

type ReportsSummaryResponse = z.infer<typeof ReportsSummaryResponseSchema>;

export function reportsRoutes(fastify: FastifyInstance): void {
  const { requireAuth } = fastify.auth;
  const security = [{ bearer: [] as string[] }];

  fastify.withTypeProvider().get(
    '/reports/summary',
    {
      preHandler: requireAuth,
      schema: {
        description:
          'Aggregate metrics for the dashboard overview: recovered claims by week, denial reasons, claim aging, payer outcomes, and call volume.',
        security,
        response: { 200: ReportsSummaryResponseSchema },
      },
    },
    async (request): Promise<ReportsSummaryResponse> => {
      const auth = request.dentabillAuth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'unreachable: requireAuth ran');
      const { orgId } = auth;

      const now = new Date();

      // ─── Recovered by week (last 8 weeks) ──────────────────────────────
      const eightWeeksAgo = new Date(now.getTime() - 8 * 7 * 24 * 60 * 60 * 1000);
      const resolvedClaims = await prisma.claim.findMany({
        where: {
          organizationId: orgId,
          status: 'RESOLVED',
          updatedAt: { gte: eightWeeksAgo },
        },
        select: { claimAmount: true, updatedAt: true },
      });

      // Group by ISO week start (Monday)
      const weekMap = new Map<string, { recoveredCents: number; claimCount: number }>();
      resolvedClaims.forEach((claim) => {
        const date = claim.updatedAt;
        const dayOfWeek = date.getUTCDay();
        const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const weekStart = new Date(date);
        weekStart.setUTCDate(weekStart.getUTCDate() - daysToMonday);
        weekStart.setUTCHours(0, 0, 0, 0);
        const weekKey = weekStart.toISOString().split('T')[0];
        if (!weekKey) return;

        const existing = weekMap.get(weekKey) ?? { recoveredCents: 0, claimCount: 0 };
        const dollars = Number(claim.claimAmount);
        existing.recoveredCents += Number.isNaN(dollars) ? 0 : Math.round(dollars * 100);
        existing.claimCount += 1;
        weekMap.set(weekKey, existing);
      });

      const recoveredByWeek = Array.from(weekMap.entries())
        .map(([weekStart, { recoveredCents, claimCount }]) => ({
          weekStart,
          recoveredCents,
          claimCount,
        }))
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

      // ─── Denial reasons breakdown ──────────────────────────────────────
      const summariesWithDenials = await prisma.callSummary.findMany({
        where: {
          organizationId: orgId,
          denialCode: { not: null },
        },
        select: { denialCode: true, denialReason: true },
      });

      const denialMap = new Map<string, { label: string; count: number }>();
      summariesWithDenials.forEach((summary) => {
        if (!summary.denialCode) return;
        const existing = denialMap.get(summary.denialCode) ?? {
          label: summary.denialReason ?? summary.denialCode,
          count: 0,
        };
        existing.count += 1;
        denialMap.set(summary.denialCode, existing);
      });

      const denialReasons = Array.from(denialMap.entries())
        .map(([code, { label, count }]) => ({ code, label, count }))
        .sort((a, b) => b.count - a.count);

      // ─── Claim aging buckets ───────────────────────────────────────────
      const pendingClaims = await prisma.claim.findMany({
        where: {
          organizationId: orgId,
          status: {
            in: ['PENDING', 'IN_QUEUE', 'CALLING', 'NEEDS_INFO', 'APPEALING', 'MANUAL_REVIEW'],
          },
        },
        select: { createdAt: true },
      });

      const agingBuckets = { '0-7': 0, '8-14': 0, '15-30': 0, '31-60': 0, '60+': 0 };
      pendingClaims.forEach((claim) => {
        const daysOld = Math.floor(
          (now.getTime() - claim.createdAt.getTime()) / (24 * 60 * 60 * 1000),
        );
        if (daysOld <= 7) agingBuckets['0-7'] += 1;
        else if (daysOld <= 14) agingBuckets['8-14'] += 1;
        else if (daysOld <= 30) agingBuckets['15-30'] += 1;
        else if (daysOld <= 60) agingBuckets['31-60'] += 1;
        else agingBuckets['60+'] += 1;
      });

      const claimAging = [
        { bucket: '0-7' as const, count: agingBuckets['0-7'] },
        { bucket: '8-14' as const, count: agingBuckets['8-14'] },
        { bucket: '15-30' as const, count: agingBuckets['15-30'] },
        { bucket: '31-60' as const, count: agingBuckets['31-60'] },
        { bucket: '60+' as const, count: agingBuckets['60+'] },
      ];

      // ─── Payer outcomes ────────────────────────────────────────────────
      const calls = await prisma.call.findMany({
        where: { organizationId: orgId },
        select: {
          status: true,
          durationSeconds: true,
          claim: { select: { payerCode: true, claimAmount: true, status: true } },
        },
      });

      const payerMap = new Map<
        string,
        { callCount: number; resolvedCount: number; durations: number[]; recoveredCents: number }
      >();

      calls.forEach((call) => {
        const payer = call.claim.payerCode;
        const existing = payerMap.get(payer) ?? {
          callCount: 0,
          resolvedCount: 0,
          durations: [],
          recoveredCents: 0,
        };
        existing.callCount += 1;
        if (call.status === 'COMPLETED') existing.resolvedCount += 1;
        if (call.durationSeconds !== null) existing.durations.push(call.durationSeconds);
        if (call.claim.status === 'RESOLVED') {
          const dollars = Number(call.claim.claimAmount);
          existing.recoveredCents += Number.isNaN(dollars) ? 0 : Math.round(dollars * 100);
        }
        payerMap.set(payer, existing);
      });

      const payerOutcomes = Array.from(payerMap.entries())
        .map(([payer, { callCount, resolvedCount, durations, recoveredCents }]) => ({
          payer,
          callCount,
          resolvedCount,
          avgDurationSeconds:
            durations.length > 0
              ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
              : null,
          recoveredCents,
        }))
        .sort((a, b) => b.callCount - a.callCount);

      // ─── Call volume (last 14 days) ────────────────────────────────────
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const recentCalls = await prisma.call.findMany({
        where: {
          organizationId: orgId,
          startedAt: { gte: fourteenDaysAgo },
        },
        select: { startedAt: true, durationSeconds: true },
      });

      const dayMap = new Map<string, { callCount: number; durations: number[] }>();
      recentCalls.forEach((call) => {
        if (!call.startedAt) return;
        const dayKey = call.startedAt.toISOString().split('T')[0];
        if (!dayKey) return;
        const existing = dayMap.get(dayKey) ?? { callCount: 0, durations: [] };
        existing.callCount += 1;
        if (call.durationSeconds !== null) existing.durations.push(call.durationSeconds);
        dayMap.set(dayKey, existing);
      });

      const callVolume = Array.from(dayMap.entries())
        .map(([day, { callCount, durations }]) => ({
          day,
          callCount,
          avgDurationSeconds:
            durations.length > 0
              ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
              : null,
        }))
        .sort((a, b) => a.day.localeCompare(b.day));

      await audit({
        action: 'report.read',
        resourceType: 'Report',
        resourceId: 'summary',
        organizationId: orgId,
        metadata: { clerkUserId: auth.userId },
      });

      return { recoveredByWeek, denialReasons, claimAging, payerOutcomes, callVolume };
    },
  );
}
