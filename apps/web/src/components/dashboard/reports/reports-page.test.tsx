import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useReportsSummary } from '../../../lib/reports/use-reports-summary.js';

import { ReportsPage } from './reports-page.js';

// Hoisted by vitest ahead of the imports above, so the mock is in place
// before `useReportsSummary` is bound.
vi.mock('../../../lib/reports/use-reports-summary.js');

describe('<ReportsPage>', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockData = {
    recoveredByWeek: [
      { weekStart: '2026-08-04', recoveredCents: 50000, claimCount: 5 },
      { weekStart: '2026-08-11', recoveredCents: 75000, claimCount: 8 },
      { weekStart: '2026-08-18', recoveredCents: 125000, claimCount: 12 },
    ],
    denialReasons: [
      { code: 'D001', label: 'Missing documentation', count: 12 },
      { code: 'D002', label: 'Out of network', count: 8 },
      { code: 'D003', label: 'Deductible not met', count: 5 },
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
        resolvedCount: 18,
        avgDurationSeconds: 420,
        recoveredCents: 125000,
      },
      {
        payer: 'Cigna Dental',
        callCount: 15,
        resolvedCount: 10,
        avgDurationSeconds: 380,
        recoveredCents: 85000,
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
      screen.getByText(
        /Recovery trends, denial analysis, payer performance, and aging distribution/,
      ),
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

  it('renders recovered by week chart with data', () => {
    (useReportsSummary as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockData,
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<ReportsPage />);

    expect(screen.getByText('Recovered value by week')).toBeInTheDocument();
    // Check for currency formatted values in the chart
    expect(screen.getByText('$500')).toBeInTheDocument(); // 50000 cents = $500
    expect(screen.getByText('$750')).toBeInTheDocument(); // 75000 cents = $750
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

  it('renders payer outcomes with recovered amounts', () => {
    (useReportsSummary as ReturnType<typeof vi.fn>).mockReturnValue({
      data: mockData,
      isLoading: false,
      isError: false,
      error: null,
    });

    render(<ReportsPage />);

    expect(screen.getByText('Per-payer recovery')).toBeInTheDocument();
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

  it('handles empty data gracefully', () => {
    (useReportsSummary as ReturnType<typeof vi.fn>).mockReturnValue({
      data: {
        recoveredByWeek: [],
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
