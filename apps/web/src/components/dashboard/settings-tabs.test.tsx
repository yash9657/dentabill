import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SETTINGS_TABS, SettingsTabs } from './settings-tabs.js';

let role = 'OWNER';
vi.mock('../../lib/me/use-me.js', () => ({ useMe: () => ({ data: { user: { role } } }) }));
afterEach(() => vi.unstubAllEnvs());

vi.mock('next/navigation', () => ({ usePathname: vi.fn() }));
const { usePathname } = await import('next/navigation');

describe('<SettingsTabs />', () => {
  it.each(['OWNER', 'ADMIN', 'BILLING_STAFF'])(
    'shows Operations only for owner/admin, given %s',
    (value) => {
      role = value;
      vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_synthetic');
      vi.mocked(usePathname).mockReturnValue('/dashboard/settings/operations');
      render(<SettingsTabs />);
      if (value === 'BILLING_STAFF')
        expect(screen.queryByRole('link', { name: 'Operations' })).not.toBeInTheDocument();
      else
        expect(screen.getByRole('link', { name: 'Operations' })).toHaveAttribute(
          'aria-current',
          'page',
        );
    },
  );

  it('renders one link per SETTINGS_TABS entry', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard/settings/organization');
    render(<SettingsTabs />);
    for (const { href, label } of SETTINGS_TABS) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href);
    }
  });

  it('marks the matching tab with aria-current', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard/settings/usage');
    render(<SettingsTabs />);
    expect(screen.getByRole('link', { name: 'Usage' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Organization' })).not.toHaveAttribute('aria-current');
  });

  it('treats nested paths as active for the parent tab', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard/settings/team/invite');
    render(<SettingsTabs />);
    expect(screen.getByRole('link', { name: 'Team' })).toHaveAttribute('aria-current', 'page');
  });
});
