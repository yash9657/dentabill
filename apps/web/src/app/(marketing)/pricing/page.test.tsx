import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import PricingPage from './page.js';

describe('/pricing', () => {
  it('renders the hero h1', () => {
    render(<PricingPage />);
    expect(screen.getByRole('heading', { level: 1, name: /pay per call/i })).toBeInTheDocument();
  });

  it('renders all three tier headings', () => {
    render(<PricingPage />);
    expect(screen.getByRole('heading', { level: 3, name: /^starter$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /^professional$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: /^enterprise$/i })).toBeInTheDocument();
  });

  it('points every Enterprise / closing-Enterprise CTA at /contact, every trial CTA at /sign-up', () => {
    render(<PricingPage />);
    const enterpriseCtas = screen.getAllByRole('link', { name: /talk to enterprise/i });
    expect(enterpriseCtas.length).toBeGreaterThanOrEqual(2);
    for (const cta of enterpriseCtas) expect(cta).toHaveAttribute('href', '/contact');

    const trialCtas = screen.getAllByRole('link', { name: /start free trial/i });
    expect(trialCtas.length).toBeGreaterThanOrEqual(2);
    for (const cta of trialCtas) expect(cta).toHaveAttribute('href', '/sign-up');
  });

  it('exposes the inline pricing FAQ as a definition list', () => {
    render(<PricingPage />);
    const heading = screen.getByRole('heading', { level: 2, name: /five questions/i });
    expect(heading).toBeInTheDocument();
    const region = heading.closest('section');
    expect(region).not.toBeNull();
    if (!region) return;
    const dts = within(region).getAllByRole('term');
    expect(dts.length).toBe(5);
  });

  it('renders the closing CTA section', () => {
    render(<PricingPage />);
    expect(
      screen.getByRole('heading', { level: 2, name: /first fifty calls are free/i }),
    ).toBeInTheDocument();
  });
});
