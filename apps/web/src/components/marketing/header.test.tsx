import { render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { MARKETING_NAV_LINKS, MarketingHeader } from './header.js';

describe('<MarketingHeader />', () => {
  it('renders the wordmark linked to the home route', () => {
    render(<MarketingHeader />);
    const home = screen.getByRole('link', { name: /dentabill home/i });
    expect(home).toHaveAttribute('href', '/');
  });

  it('renders one link per MARKETING_NAV_LINKS entry on desktop', () => {
    render(<MarketingHeader />);
    // The desktop <nav aria-label="Primary"> always renders the links;
    // visibility is a CSS-only hide on small breakpoints.
    const desktopNav = screen.getByRole('navigation', { name: /^primary$/i });
    for (const { href, label } of MARKETING_NAV_LINKS) {
      const link = within(desktopNav).getByRole('link', { name: label });
      expect(link).toHaveAttribute('href', href);
    }
  });

  it('renders the primary CTA pill linking to /sign-up', () => {
    render(<MarketingHeader />);
    const startTrial = screen.getAllByRole('link', { name: /start free trial/i });
    expect(startTrial[0]).toHaveAttribute('href', '/sign-up');
  });

  it('toggles the mobile drawer via the hamburger button', async () => {
    const user = userEvent.setup();
    render(<MarketingHeader />);
    const toggle = screen.getByRole('button', { name: /open menu/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);
    expect(screen.getByRole('button', { name: /close menu/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('navigation', { name: /mobile primary/i })).toBeVisible();
  });

  it('closes the mobile drawer when Escape is pressed', async () => {
    const user = userEvent.setup();
    render(<MarketingHeader />);
    await user.click(screen.getByRole('button', { name: /open menu/i }));
    expect(screen.getByRole('button', { name: /close menu/i })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: /open menu/i })).toBeInTheDocument();
  });
});
