import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DashboardBreadcrumbs } from './dashboard-breadcrumbs.js';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
}));

const { usePathname } = await import('next/navigation');

describe('<DashboardBreadcrumbs />', () => {
  it('returns null outside the dashboard tree', () => {
    vi.mocked(usePathname).mockReturnValue('/about');
    const { container } = render(<DashboardBreadcrumbs />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a single Dashboard crumb on /dashboard/overview', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard/overview');
    render(<DashboardBreadcrumbs />);
    expect(screen.getByRole('link', { name: /dashboard/i })).toHaveAttribute('href', '/dashboard');
    const current = screen.getByText('Overview');
    expect(current).toHaveAttribute('aria-current', 'page');
  });

  it('humanises kebab-cased segments into Title Case', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard/claims/import-csv');
    render(<DashboardBreadcrumbs />);
    expect(screen.getByText('Import Csv')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Claims' })).toHaveAttribute(
      'href',
      '/dashboard/claims',
    );
  });

  it('uses an explicit label override when one is provided', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard/claims/abc123');
    render(<DashboardBreadcrumbs labels={{ abc123: 'Claim #2103' }} />);
    expect(screen.getByText('Claim #2103')).toHaveAttribute('aria-current', 'page');
  });
});
