import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import type { PropsWithChildren, ReactElement } from 'react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import { useReportsSummary, type ReportsSummaryResponse } from './use-reports-summary.js';

const getMock = vi.hoisted(() => vi.fn());
vi.mock('../api-client.js', () => ({
  useDentaBillApi: () => ({
    client: { GET: getMock },
    withAuthHeaders: async () => ({ authorization: 'Bearer synthetic-test-token' }),
  }),
}));

function wrapper({ children }: PropsWithChildren): ReactElement {
  return createElement(QueryProvider, { client: createDentaBillQueryClient(), children });
}

const report: ReportsSummaryResponse = {
  verifiedPayments: {
    status: 'unavailable',
    reason: 'PAYMENT_LEDGER_NOT_IMPLEMENTED',
    amountCents: null,
  },
  callActivityByWeek: [
    { weekStart: '2026-10-12', callCount: 3, completedCallCount: 2, uniqueClaimCount: 1 },
  ],
  denialReasons: [],
  claimAging: [],
  payerOutcomes: [
    {
      payer: 'DELTA_DENTAL_PPO',
      callCount: 3,
      completedCallCount: 2,
      uniqueClaimCount: 1,
      claimsMarkedResolvedCount: 1,
      avgDurationSeconds: 60,
    },
  ],
  callVolume: [],
};

beforeEach(() => {
  getMock.mockReset();
});

describe('useReportsSummary wire contract', () => {
  it('fetches and parses explicit payment unavailability and distinct call/claim metrics', async () => {
    getMock.mockResolvedValue({ data: report });
    const { result } = renderHook(useReportsSummary, { wrapper });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.data).toEqual(report);
    expect(getMock).toHaveBeenCalledWith(
      '/v1/reports/summary',
      expect.objectContaining({ headers: { authorization: 'Bearer synthetic-test-token' } }),
    );
  });

  it('rejects the old unsupported recovery contract instead of displaying recovered money', async () => {
    getMock.mockResolvedValue({
      data: {
        recoveredByWeek: [{ weekStart: '2026-10-12', recoveredCents: 60000, claimCount: 2 }],
        denialReasons: [],
        claimAging: [],
        payerOutcomes: [],
        callVolume: [],
      },
    });
    const { result } = renderHook(useReportsSummary, { wrapper });
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.data).toBeUndefined();
  });

  it.each([0, 10000, 60000])(
    'rejects an unavailable payment metric with an invented amount %i',
    async (amountCents) => {
      getMock.mockResolvedValue({
        data: { ...report, verifiedPayments: { ...report.verifiedPayments, amountCents } },
      });
      const { result } = renderHook(useReportsSummary, { wrapper });
      await waitFor(() => {
        expect(result.current.isError).toBe(true);
      });
      expect(result.current.data).toBeUndefined();
    },
  );
});
