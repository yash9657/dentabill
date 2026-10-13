import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import PricingPage from './page.js';

describe('/pricing', () => {
  it('renders the free-forever hero headline', () => {
    render(<PricingPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: /free for practices.*forever/i }),
    ).toBeInTheDocument();
  });

  it('renders "What you get" section with feature list', () => {
    render(<PricingPage />);
    expect(screen.getByRole('heading', { level: 2, name: /what you get/i })).toBeInTheDocument();
    expect(screen.getByText(/unlimited claim follow-up calls/i)).toBeInTheDocument();
    expect(screen.getByText(/all supported payers from day one/i)).toBeInTheDocument();
  });

  it('renders "How this is sustainable" section', () => {
    render(<PricingPage />);
    expect(
      screen.getByRole('heading', { level: 2, name: /how this is sustainable/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/partnerships with dental dsos/i)).toBeInTheDocument();
  });

  it('renders the closing CTA with "Get started free"', () => {
    render(<PricingPage />);
    expect(
      screen.getByRole('heading', { level: 2, name: /no card required.*just log in/i }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /get started free/i })[0]).toHaveAttribute(
      'href',
      '/sign-up',
    );
  });

  it('points the only CTA at /sign-up', () => {
    render(<PricingPage />);
    const ctaLinks = screen.getAllByRole('link', { name: /get started free/i });
    expect(ctaLinks.length).toBeGreaterThanOrEqual(1);
    for (const link of ctaLinks) {
      expect(link).toHaveAttribute('href', '/sign-up');
    }
  });
});
