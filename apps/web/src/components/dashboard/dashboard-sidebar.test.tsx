import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { DashboardShellProvider } from './dashboard-shell-context.js';
import { DASHBOARD_NAV_LINKS, DashboardSidebar } from './dashboard-sidebar.js';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
}));

const { usePathname } = await import('next/navigation');

function renderSidebar({
  pathname,
  collapsed = false,
  toggleCollapsed = vi.fn(),
  closeMobileDrawer = vi.fn(),
}: {
  readonly pathname: string;
  readonly collapsed?: boolean;
  readonly toggleCollapsed?: () => void;
  readonly closeMobileDrawer?: () => void;
}): { toggleCollapsed: () => void; closeMobileDrawer: () => void } {
  vi.mocked(usePathname).mockReturnValue(pathname);
  render(
    <DashboardShellProvider value={{ collapsed, toggleCollapsed, closeMobileDrawer }}>
      <DashboardSidebar />
    </DashboardShellProvider>,
  );
  return { toggleCollapsed, closeMobileDrawer };
}

describe('<DashboardSidebar />', () => {
  it('renders one link per DASHBOARD_NAV_LINKS entry', () => {
    renderSidebar({ pathname: '/dashboard/overview' });
    for (const { href, label } of DASHBOARD_NAV_LINKS) {
      const link = screen.getByRole('link', { name: label });
      expect(link).toHaveAttribute('href', href);
    }
  });

  it('marks the link matching the pathname with aria-current', () => {
    renderSidebar({ pathname: '/dashboard/claims' });
    const claims = screen.getByRole('link', { name: /claims/i });
    expect(claims).toHaveAttribute('aria-current', 'page');
    const overview = screen.getByRole('link', { name: /overview/i });
    expect(overview).not.toHaveAttribute('aria-current');
  });

  it('treats nested paths as active for the parent link', () => {
    renderSidebar({ pathname: '/dashboard/claims/abc123' });
    expect(screen.getByRole('link', { name: /claims/i })).toHaveAttribute('aria-current', 'page');
  });

  it('marks the cash evidence inbox as a separate destination', () => {
    renderSidebar({ pathname: '/dashboard/cash-evidence' });
    expect(screen.getByRole('link', { name: 'Cash evidence' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Reports' })).not.toHaveAttribute('aria-current');
  });

  it('toggles the shell collapsed flag when the collapse control is pressed', async () => {
    const user = userEvent.setup();
    const toggleCollapsed = vi.fn();
    renderSidebar({ pathname: '/dashboard/overview', toggleCollapsed });
    const toggle = screen.getByRole('button', { name: /collapse sidebar/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(toggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('renders the expand label and aria-pressed=true when collapsed', () => {
    renderSidebar({ pathname: '/dashboard/overview', collapsed: true });
    const toggle = screen.getByRole('button', { name: /expand sidebar/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('closes the mobile drawer when a link is clicked', async () => {
    const user = userEvent.setup();
    const closeMobileDrawer = vi.fn();
    renderSidebar({ pathname: '/dashboard/overview', closeMobileDrawer });
    await user.click(screen.getByRole('link', { name: /claims/i }));
    expect(closeMobileDrawer).toHaveBeenCalled();
  });
});

it('marks remittance batches as a separate review destination', () => {
  renderSidebar({ pathname: '/dashboard/remittance-batches' });
  expect(screen.getByRole('link', { name: 'Remittance batches' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  expect(screen.getByRole('link', { name: 'Cash evidence' })).not.toHaveAttribute('aria-current');
});
