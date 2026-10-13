import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  useReportsSummary,
  type ReportsSummaryResponse,
} from '../../../lib/reports/use-reports-summary.js';

import { ReportsPage } from './reports-page.js';

// Hoisted by vitest ahead of the imports above, so the mock is in place
// before `useReportsSummary` is bound.
vi.mock('../../../lib/reports/use-reports-summary.js');

describe('<ReportsPage>', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockData: ReportsSummaryResponse = {
    verifiedPayments: {
      status: 'unavailable',
      reason: 'PAYMENT_LEDGER_NOT_IMPLEMENTED',
      amountCents: null,
    },
    callActivityByWeek: [
      { weekStart: '2026-08-04', callCount: 10, completedCallCount: 8, uniqueClaimCount: 5 },
      { weekStart: '2026-08-11', callCount: 16, completedCallCount: 12, uniqueClaimCount: 8 },
      { weekStart: '2026-08-18', callCount: 24, completedCallCount: 18, uniqueClaimCount: 12 },
    ],
    denialReasons: [
      { code: 'D001', label: 'Missing documentation', uniqueClaimCount: 12 },
      { code: 'D002', label: 'Out of network', uniqueClaimCount: 8 },
      { code: 'D003', label: 'Deductible not met', uniqueClaimCount: 5 },
    ],
    claimAging: [
      { bucket: '0-7' as const, count: 15 },
      { bucket: '8-14' as const, count: 10 },
      { bucket: '15-30' as const, count: 8 },
      { bucket: '31-60' as const, count: 4 },
      { bucket: '60+' as const, count: 2 },
    ],
    payerOutcomes: [
      {
        payer: 'Delta Dental',
        callCount: 25,
        completedCallCount: 18,
        uniqueClaimCount: 15,
        claimsMarkedResolvedCount: 6,
        avgDurationSeconds: 420,
      },
      {
        payer: 'Cigna Dental',
        callCount: 15,
        completedCallCount: 10,
        uniqueClaimCount: 9,
        claimsMarkedResolvedCount: 2,
        avgDurationSeconds: 380,
      },
    ],
    callVolume: [
      { day: '2026-08-18', callCount: 12, avgDurationSeconds: 400 },
      { day: '2026-08-19', callCount: 15, avgDurationSeconds: 420 },
    ],
  };

  it('renders page header', () => {
    (useReportsSummary as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockData,
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<ReportsPage />);

    expect(screen.getByRole('heading', { level: 1, name: /Reports/ })).toBeInTheDocument();
    expect(
      screen.getByText(/Call activity, reported denials, and claim aging/),
    ).toBeInTheDocument();
  });

  it('renders loading state for charts when data is loading', () => {
    (useReportsSummary as ReturnType<typeof vi.fn>).mockReturnValue({
      data: null,
      isLoading: true,
      isError: false,
      error: null,
    });

    render(<ReportsPage />);

    // Should have loading state for 3 charts (+ 1 table with "Loading table…")
    const loadingTexts = screen.getAllByText('Loading chart…');
    expect(loadingTexts).toHaveLength(3);
    expect(screen.getByText('Loading table…')).toBeInTheDocument();
  });

  it('renders error message when query fails', () => {
    const mockError = new Error('Network error');
    (useReportsSummary as ReturnType<typeof vi.fn>).mockReturnValue({
      data: null,
      isLoading: false,
      isError: true,
      error: mockError,
    });

    render(<ReportsPage />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Network error/)).toBeInTheDocument();
  });

  it('renders call-start activity without financial outcome amounts', () => {
    (useReportsSummary as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockData,
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<ReportsPage />);

    expect(screen.getByText('Call activity by week')).toBeInTheDocument();
    expect(screen.getByText('10 calls')).toBeInTheDocument();
    expect(screen.getByText('8 completed · 5 unique claims')).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('Verified payments unavailable');
  });

  it('renders denial reasons chart with accessible data', () => {
    (useReportsSummary as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockData,
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<ReportsPage />);

    expect(screen.getByText('Top denial reasons')).toBeInTheDocument();
    // Check that denial reason labels appear (may appear in both chart and accessibility list)
    const missingDocLabels = screen.getAllByText('Missing documentation');
    expect(missingDocLabels.length).toBeGreaterThan(0);
    const outOfNetLabels = screen.getAllByText('Out of network');
    expect(outOfNetLabels.length).toBeGreaterThan(0);
  });

  it('renders payer call completions separately from distinct claims marked resolved', () => {
    (useReportsSummary as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockData,
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<ReportsPage />);

    expect(screen.getByText('Payer call activity')).toBeInTheDocument();
    expect(screen.getByText(/25 calls · 18 completed/)).toBeInTheDocument();
    expect(screen.getByText('15 unique claims')).toBeInTheDocument();
    expect(screen.getByText(/6 of 15 claims marked resolved/)).toBeInTheDocument();
    // Check for the payer names in the accessibility data list
    const payerNames = screen.getAllByText('Delta Dental');
    expect(payerNames.length).toBeGreaterThan(0);
    const cignaNames = screen.getAllByText('Cigna Dental');
    expect(cignaNames.length).toBeGreaterThan(0);
  });

  it('renders claim aging table with all buckets', () => {
    (useReportsSummary as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockData,
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<ReportsPage />);

    expect(screen.getByText('Claim aging')).toBeInTheDocument();
    expect(screen.getByText('Fresh (0-7 days)')).toBeInTheDocument();
    expect(screen.getByText('Recent (8-14 days)')).toBeInTheDocument();
    expect(screen.getByText('Aging (15-30 days)')).toBeInTheDocument();
    expect(screen.getByText('Overdue (31-60 days)')).toBeInTheDocument();
    expect(screen.getByText('Critical (60+ days)')).toBeInTheDocument();
  });

  it('renders claim aging percentages correctly', () => {
    (useReportsSummary as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockData,
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<ReportsPage />);

    // Total: 15 + 10 + 8 + 4 + 2 = 39 claims
    // 0-7: 15/39 ≈ 38.5%
    expect(screen.getByText('38.5%')).toBeInTheDocument();
  });

  it('renders a single activity week without invalid chart coordinates', () => {
    vi.mocked(useReportsSummary).mockReturnValue({
      data: { ...mockData, callActivityByWeek: [mockData.callActivityByWeek[0]!] },
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useReportsSummary>);
    render(<ReportsPage />);
    const chart = screen.getByRole('img', { name: 'Call activity trend over 8 weeks' });
    expect(chart.querySelector('path')).toHaveAttribute('d', 'M 60 20');
    expect(chart.querySelector('circle')).toHaveAttribute('cx', '60');
    expect(screen.getByText('8 completed · 5 unique claims')).toBeInTheDocument();
  });

  it('renders eight zero-activity weeks with valid coordinates and no financial amounts', () => {
    const weeks = Array.from({ length: 8 }, (_, index) => ({
      weekStart: new Date(Date.UTC(2026, 7, 24 + index * 7)).toISOString().slice(0, 10),
      callCount: 0,
      completedCallCount: 0,
      uniqueClaimCount: 0,
    }));
    vi.mocked(useReportsSummary).mockReturnValue({
      data: { ...mockData, callActivityByWeek: weeks },
      isLoading: false,
      isError: false,
      error: null,
    } as ReturnType<typeof useReportsSummary>);
    render(<ReportsPage />);
    const chart = screen.getByRole('img', { name: 'Call activity trend over 8 weeks' });
    expect(chart.querySelectorAll('circle')).toHaveLength(8);
    for (const point of chart.querySelectorAll('circle')) {
      expect(point).toHaveAttribute('cy', '210');
    }
    expect(chart.querySelector('path')?.getAttribute('d')).not.toMatch(/NaN|Infinity/);
    expect(screen.getAllByText('0 calls')).toHaveLength(8);
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('handles empty data gracefully', () => {
    (useReportsSummary as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        callActivityByWeek: [],
        denialReasons: [],
        claimAging: [],
        payerOutcomes: [],
        callVolume: [],
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<ReportsPage />);

    expect(screen.getByText('No data available')).toBeInTheDocument();
  });
});
