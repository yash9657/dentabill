import { audit, prisma } from '@dentabill/db';
import { ApiError } from '@dentabill/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  unavailableVerifiedPayments,
  VerifiedPaymentsSchema,
} from '../../lib/financial-reporting.js';

/**
 * `/v1/reports/summary` — aggregate metrics for dashboard overview.
 *
 * Returns org-scoped aggregates across claims and calls:
 * - callActivityByWeek: call-start cohorts for eight UTC weeks
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
  callCount: z.number().int().min(0),
  completedCallCount: z.number().int().min(0),
  uniqueClaimCount: z.number().int().min(0),
});

const DenialReasonSchema = z.object({
  code: z.string(),
  label: z.string(),
  uniqueClaimCount: z.number().int().min(0),
});

const ClaimAgingBucketSchema = z.object({
  bucket: z.enum(['0-7', '8-14', '15-30', '31-60', '60+']),
  count: z.number().int().min(0),
});

const PayerOutcomeSchema = z.object({
  payer: z.string(),
  callCount: z.number().int().min(0),
  completedCallCount: z.number().int().min(0),
  uniqueClaimCount: z.number().int().min(0),
  claimsMarkedResolvedCount: z
    .number()
    .int()
    .min(0)
    .describe(
      'Distinct claims with current workflow status RESOLVED, among claims with calls. Does not establish payment or settlement.',
    ),
  avgDurationSeconds: z.number().int().min(0).nullable(),
});

const ReportsSummaryResponseSchema = z.object({
  callActivityByWeek: z
    .array(WeekBucketSchema)
    .describe(
      'Calls started in the current and seven preceding UTC weeks, grouped by Monday. Distinct claims are counted per week and may recur across weeks.',
    ),
  verifiedPayments: VerifiedPaymentsSchema,
  denialReasons: z.array(DenialReasonSchema),
  claimAging: z.array(ClaimAgingBucketSchema),
  payerOutcomes: z.array(PayerOutcomeSchema),
  callVolume: z.array(DayBucketSchema),
});

export type ReportsSummaryResponse = z.infer<typeof ReportsSummaryResponseSchema>;

export function reportsRoutes(fastify: FastifyInstance): void {
  const { requireAuth } = fastify.auth;
  const security = [{ bearer: [] as string[] }];

  fastify.withTypeProvider().get(
    '/reports/summary',
    {
      preHandler: requireAuth,
      schema: {
        description:
          'Operational call and distinct-claim metrics, denial observations, claim aging, and explicit payment-data availability. Workflow status and payer reports do not establish recovery.',
        security,
        response: { 200: ReportsSummaryResponseSchema },
      },
    },
    async (request): Promise<ReportsSummaryResponse> => {
      const auth = request.dentabillAuth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'unreachable: requireAuth ran');
      const { orgId } = auth;

      const now = new Date();

      const calls = await prisma.call.findMany({
        where: { organizationId: orgId, claim: { organizationId: orgId } },
        select: {
          claimId: true,
          startedAt: true,
          status: true,
          durationSeconds: true,
          claim: { select: { payerCode: true, status: true } },
        },
      });
      const currentMonday = new Date(now);
      const daysToMonday = (now.getUTCDay() + 6) % 7;
      currentMonday.setUTCDate(currentMonday.getUTCDate() - daysToMonday);
      currentMonday.setUTCHours(0, 0, 0, 0);
      const firstWeekStart = new Date(currentMonday.getTime() - 7 * 7 * 24 * 60 * 60 * 1000);
      const weekMap = new Map<
        string,
        { callCount: number; completedCallCount: number; claimIds: Set<string> }
      >();
      for (let week = 0; week < 8; week += 1) {
        const weekStart = new Date(firstWeekStart.getTime() + week * 7 * 24 * 60 * 60 * 1000);
        weekMap.set(weekStart.toISOString().slice(0, 10), {
          callCount: 0,
          completedCallCount: 0,
          claimIds: new Set<string>(),
        });
      }
      calls.forEach((call) => {
        if (!call.startedAt || call.startedAt < firstWeekStart || call.startedAt > now) return;
        const weekStart = new Date(call.startedAt);
        weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
        const weekKey = weekStart.toISOString().slice(0, 10);
        const existing = weekMap.get(weekKey);
        if (!existing) return;
        existing.callCount += 1;
        if (call.status === 'COMPLETED') existing.completedCallCount += 1;
        existing.claimIds.add(call.claimId);
        weekMap.set(weekKey, existing);
      });
      const callActivityByWeek = Array.from(weekMap.entries())
        .map(([weekStart, { callCount, completedCallCount, claimIds }]) => ({
          weekStart,
          callCount,
          completedCallCount,
          uniqueClaimCount: claimIds.size,
        }))
        .sort((a, b) => a.weekStart.localeCompare(b.weekStart));

      // ─── Denial reasons breakdown ──────────────────────────────────────
      const summariesWithDenials = await prisma.callSummary.findMany({
        where: {
          organizationId: orgId,
          denialCode: { not: null },
          call: { organizationId: orgId, claim: { organizationId: orgId } },
        },
        select: { denialCode: true, denialReason: true, call: { select: { claimId: true } } },
        orderBy: { createdAt: 'desc' },
      });

      const denialMap = new Map<string, { label: string; claimIds: Set<string> }>();
      summariesWithDenials.forEach((summary) => {
        if (!summary.denialCode) return;
        const existing = denialMap.get(summary.denialCode) ?? {
          label: summary.denialReason ?? summary.denialCode,
          claimIds: new Set<string>(),
        };
        existing.claimIds.add(summary.call.claimId);
        denialMap.set(summary.denialCode, existing);
      });

      const denialReasons = Array.from(denialMap.entries())
        .map(([code, { label, claimIds }]) => ({ code, label, uniqueClaimCount: claimIds.size }))
        .sort((a, b) => b.uniqueClaimCount - a.uniqueClaimCount);

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
      const payerMap = new Map<
        string,
        {
          callCount: number;
          completedCallCount: number;
          claimIds: Set<string>;
          resolvedClaimIds: Set<string>;
          durations: number[];
        }
      >();

      calls.forEach((call) => {
        const payer = call.claim.payerCode;
        const existing = payerMap.get(payer) ?? {
          callCount: 0,
          completedCallCount: 0,
          claimIds: new Set<string>(),
          resolvedClaimIds: new Set<string>(),
          durations: [],
        };
        existing.callCount += 1;
        if (call.status === 'COMPLETED') existing.completedCallCount += 1;
        existing.claimIds.add(call.claimId);
        if (call.claim.status === 'RESOLVED') existing.resolvedClaimIds.add(call.claimId);
        if (call.durationSeconds !== null) existing.durations.push(call.durationSeconds);
        payerMap.set(payer, existing);
      });

      const payerOutcomes = Array.from(payerMap.entries())
        .map(
          ([payer, { callCount, completedCallCount, claimIds, resolvedClaimIds, durations }]) => ({
            payer,
            callCount,
            completedCallCount,
            uniqueClaimCount: claimIds.size,
            claimsMarkedResolvedCount: resolvedClaimIds.size,
            avgDurationSeconds:
              durations.length > 0
                ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
                : null,
          }),
        )
        .sort((a, b) => b.callCount - a.callCount);

      // ─── Call volume (last 14 days) ────────────────────────────────────
      const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
      const dayMap = new Map<string, { callCount: number; durations: number[] }>();
      calls.forEach((call) => {
        if (!call.startedAt || call.startedAt < fourteenDaysAgo || call.startedAt > now) return;
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

      return {
        callActivityByWeek,
        denialReasons,
        claimAging,
        payerOutcomes,
        callVolume,
        verifiedPayments: unavailableVerifiedPayments,
      };
    },
  );
}
