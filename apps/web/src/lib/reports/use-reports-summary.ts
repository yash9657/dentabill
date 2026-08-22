'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';

import { useDentaBillApi } from '../api-client.js';

/**
 * Zod schemas matching the API response types from `/v1/reports/summary`.
 * These are derived from apps/api/src/routes/v1/reports.ts to ensure
 * consistency without depending on SDK regeneration.
 */
const DayBucketSchema = z.object({
  day: z.string(),
  callCount: z.number().int(),
  avgDurationSeconds: z.number().int().nullable(),
});

const WeekBucketSchema = z.object({
  weekStart: z.string(),
  recoveredCents: z.number().int(),
  claimCount: z.number().int(),
});

const DenialReasonSchema = z.object({
  code: z.string(),
  label: z.string(),
  count: z.number().int(),
});

const ClaimAgingBucketSchema = z.object({
  bucket: z.enum(['0-7', '8-14', '15-30', '31-60', '60+']),
  count: z.number().int(),
});

const PayerOutcomeSchema = z.object({
  payer: z.string(),
  callCount: z.number().int(),
  resolvedCount: z.number().int(),
  avgDurationSeconds: z.number().int().nullable(),
  recoveredCents: z.number().int(),
});

const ReportsSummaryResponseSchema = z.object({
  recoveredByWeek: z.array(WeekBucketSchema),
  denialReasons: z.array(DenialReasonSchema),
  claimAging: z.array(ClaimAgingBucketSchema),
  payerOutcomes: z.array(PayerOutcomeSchema),
  callVolume: z.array(DayBucketSchema),
});

export type ReportsSummaryResponse = z.infer<typeof ReportsSummaryResponseSchema>;
export type WeekBucket = z.infer<typeof WeekBucketSchema>;
export type DenialReason = z.infer<typeof DenialReasonSchema>;
export type ClaimAgingBucket = z.infer<typeof ClaimAgingBucketSchema>;
export type PayerOutcome = z.infer<typeof PayerOutcomeSchema>;

interface ApiErrorBody {
  message?: string;
  code?: string;
}

/**
 * `useReportsSummary()` fetches `/v1/reports/summary` which returns
 * five aggregates for the reports dashboard:
 *
 * - recoveredByWeek: last 8 weeks of claim resolutions (value, count)
 * - denialReasons: breakdown by denial code
 * - claimAging: distribution of pending claims by age bucket
 * - payerOutcomes: per-payer call/resolution metrics
 * - callVolume: last 14 days of daily call counts
 *
 * Polled every 120s (slower than live-call screens, faster than
 * hourly). On error, returns `isError: true` and the hook consumer
 * displays a small error message; the page does not fail.
 */
export function useReportsSummary(): UseQueryResult<ReportsSummaryResponse> {
  const { client, withAuthHeaders } = useDentaBillApi();
  return useQuery({
    queryKey: ['reports', 'summary'],
    throwOnError: false,
    retry: false,
    queryFn: async ({ signal }): Promise<ReportsSummaryResponse> => {
      const headers = await withAuthHeaders();
      const result = (await client.GET('/v1/reports/summary', { headers, signal })) as unknown;

      // Safe type assertion after validation
      if (typeof result !== 'object' || result === null) {
        throw new Error('Invalid response from /v1/reports/summary.');
      }

      const typed = result as { data?: unknown; error?: ApiErrorBody };
      if (typed.error) {
        throw new Error(typed.error.message ?? 'Failed to load reports.');
      }
      if (!typed.data) throw new Error('Empty response from /v1/reports/summary.');

      return ReportsSummaryResponseSchema.parse(typed.data);
    },
    refetchInterval: 120000,
    refetchIntervalInBackground: false,
  });
}
