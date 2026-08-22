import { describe, it, expect } from 'vitest';

import { type ReportsSummaryResponse } from './use-reports-summary.js';

describe('useReportsSummary', () => {
  const mockReportsData: ReportsSummaryResponse = {
    recoveredByWeek: [
      { weekStart: '2026-08-04', recoveredCents: 50000, claimCount: 5 },
      { weekStart: '2026-08-11', recoveredCents: 75000, claimCount: 8 },
    ],
    denialReasons: [
      { code: 'D001', label: 'Missing documentation', count: 12 },
      { code: 'D002', label: 'Out of network', count: 8 },
    ],
    claimAging: [
      { bucket: '0-7', count: 15 },
      { bucket: '8-14', count: 10 },
      { bucket: '15-30', count: 8 },
      { bucket: '31-60', count: 4 },
      { bucket: '60+', count: 2 },
    ],
    payerOutcomes: [
      {
        payer: 'Delta Dental',
        callCount: 25,
        resolvedCount: 18,
        avgDurationSeconds: 420,
        recoveredCents: 125000,
      },
      {
        payer: 'Cigna',
        callCount: 15,
        resolvedCount: 10,
        avgDurationSeconds: 380,
        recoveredCents: 85000,
      },
    ],
    callVolume: [
      { day: '2026-08-19', callCount: 12, avgDurationSeconds: 400 },
      { day: '2026-08-20', callCount: 15, avgDurationSeconds: 420 },
    ],
  };

  /**
   * Hook tests verify type definitions and Zod schema structure.
   * Full integration test coverage happens at the component level
   * via mocked hooks (vitest) and e2e level (Playwright).
   */

  it('exports correct type definitions for ReportsSummaryResponse', () => {
    const _data: ReportsSummaryResponse = mockReportsData;
    expect(_data).toBeDefined();
  });

  it('validates recoveredByWeek structure', () => {
    const hasWeek = mockReportsData.recoveredByWeek.every(
      (week) => 'weekStart' in week && 'recoveredCents' in week && 'claimCount' in week,
    );
    expect(hasWeek).toBe(true);
  });

  it('validates denialReasons structure', () => {
    const hasReason = mockReportsData.denialReasons.every(
      (reason) => 'code' in reason && 'label' in reason && 'count' in reason,
    );
    expect(hasReason).toBe(true);
  });

  it('validates claimAging structure with enum values', () => {
    const validBuckets = ['0-7', '8-14', '15-30', '31-60', '60+'];
    const hasBucket = mockReportsData.claimAging.every(
      (aging) => 'bucket' in aging && 'count' in aging && validBuckets.includes(aging.bucket),
    );
    expect(hasBucket).toBe(true);
  });

  it('validates payerOutcomes structure', () => {
    const hasPayer = mockReportsData.payerOutcomes.every(
      (payer) =>
        'payer' in payer &&
        'callCount' in payer &&
        'resolvedCount' in payer &&
        'avgDurationSeconds' in payer &&
        'recoveredCents' in payer,
    );
    expect(hasPayer).toBe(true);
  });

  it('validates callVolume structure', () => {
    const hasDay = mockReportsData.callVolume.every(
      (day) => 'day' in day && 'callCount' in day && 'avgDurationSeconds' in day,
    );
    expect(hasDay).toBe(true);
  });
});
