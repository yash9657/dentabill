import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import DashboardOverviewPage from './page.js';

describe('DashboardOverviewPage (P2-T35)', () => {
  it('renders the welcome heading', () => {
    render(<DashboardOverviewPage />);
    expect(screen.getByRole('heading', { level: 1, name: /welcome back/i })).toBeInTheDocument();
  });

  it('renders the four headline stats with em-dash placeholders', () => {
    render(<DashboardOverviewPage />);
    const region = screen.getByRole('region', { name: /headline metrics/i });
    expect(region).toBeInTheDocument();
    for (const label of ['Calls today', 'Queue depth', 'Denials this week', 'Recovered']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText('—').length).toBe(4);
  });

  it('renders both empty-state panels with their CTAs pointing at the dashboard routes', () => {
    render(<DashboardOverviewPage />);
    expect(
      screen.getByRole('heading', { level: 2, name: /nothing in the queue yet/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /no payer calls yet/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open claims/i })).toHaveAttribute(
      'href',
      '/dashboard/claims',
    );
    expect(screen.getByRole('link', { name: /open calls/i })).toHaveAttribute(
      'href',
      '/dashboard/calls',
    );
  });
});
