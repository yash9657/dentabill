import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import DashboardOverviewPage from './page.js';

describe('DashboardOverviewPage (P2-T35)', () => {
  it('renders the welcome heading', () => {
    render(<DashboardOverviewPage />);
    expect(screen.getByRole('heading', { level: 1, name: /welcome back/i })).toBeInTheDocument();
  });

  it('renders the four headline stat tiles with em-dash placeholders (unauth fallback)', () => {
    // No Clerk env stubbed → page falls back to the static placeholder strip.
    render(<DashboardOverviewPage />);
    const region = screen.getByRole('region', { name: /headline metrics/i });
    expect(region).toBeInTheDocument();
    for (const label of ['Calls today', 'Queue depth', 'Avg call (7d)', 'Verified payments']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText('—').length).toBe(4);
    expect(screen.getByText('Unavailable: no reconciliation')).toBeInTheDocument();
    expect(screen.queryByText(/Recovered/i)).not.toBeInTheDocument();
  });

  it('renders both empty-state panels with their CTAs pointing at the dashboard routes', () => {
    render(<DashboardOverviewPage />);
    expect(
      screen.getByRole('heading', { level: 3, name: /nothing in the queue yet/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: /no payer calls yet/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /import claims/i })[0]).toHaveAttribute(
      'href',
      '/dashboard/claims/import',
    );
    expect(screen.getByRole('link', { name: /open calls/i })).toHaveAttribute(
      'href',
      '/dashboard/calls',
    );
  });
});
