import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SETTINGS_TABS, SettingsTabs } from './settings-tabs.js';

vi.mock('next/navigation', () => ({ usePathname: vi.fn() }));
const { usePathname } = await import('next/navigation');

describe('<SettingsTabs />', () => {
  it('renders one link per SETTINGS_TABS entry', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard/settings/organization');
    render(<SettingsTabs />);
    for (const { href, label } of SETTINGS_TABS) {
      expect(screen.getByRole('link', { name: label })).toHaveAttribute('href', href);
    }
  });

  it('marks the matching tab with aria-current', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard/settings/billing');
    render(<SettingsTabs />);
    expect(screen.getByRole('link', { name: 'Billing' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Organization' })).not.toHaveAttribute('aria-current');
  });

  it('treats nested paths as active for the parent tab', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard/settings/team/invite');
    render(<SettingsTabs />);
    expect(screen.getByRole('link', { name: 'Team' })).toHaveAttribute('aria-current', 'page');
  });
});
