import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MarketingFooter } from './footer.js';

describe('<MarketingFooter />', () => {
  it('renders as a contentinfo landmark', () => {
    render(<MarketingFooter />);
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('renders the wordmark linking to /', () => {
    render(<MarketingFooter />);
    const home = screen.getByRole('link', { name: /dentabill home/i });
    expect(home).toHaveAttribute('href', '/');
  });

  it('renders the three column headings', () => {
    render(<MarketingFooter />);
    const nav = screen.getByRole('navigation', { name: /^footer$/i });
    expect(within(nav).getByRole('heading', { level: 2, name: /product/i })).toBeInTheDocument();
    expect(within(nav).getByRole('heading', { level: 2, name: /company/i })).toBeInTheDocument();
    expect(within(nav).getByRole('heading', { level: 2, name: /legal/i })).toBeInTheDocument();
  });

  it('exposes the privacy + terms links', () => {
    render(<MarketingFooter />);
    expect(screen.getByRole('link', { name: /^privacy$/i })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: /^terms$/i })).toHaveAttribute('href', '/terms');
  });

  it('renders the current year in the copyright', () => {
    render(<MarketingFooter />);
    const year = String(new Date().getFullYear());
    expect(screen.getByText(`© ${year} DentaBill. All rights reserved.`)).toBeInTheDocument();
  });

  it('mounts the newsletter signup stub', () => {
    render(<MarketingFooter />);
    expect(screen.getByRole('button', { name: /subscribe/i })).toBeInTheDocument();
  });
});
