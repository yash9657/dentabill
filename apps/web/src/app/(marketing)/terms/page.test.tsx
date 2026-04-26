import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import TermsPage from './page.js';

describe('/terms', () => {
  it('renders the hero h1, effective date, and the draft-status note', () => {
    render(<TermsPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: /plain-english terms of service/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/effective.*2026/i)).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/draft template/i);
  });

  it('renders all 12 numbered section headings in order', () => {
    render(<TermsPage />);
    const expected = [
      /^1\. acceptance/i,
      /^2\. the service/i,
      /^3\. account terms/i,
      /^4\. acceptable use/i,
      /^5\. payment/i,
      /^6\. term and termination/i,
      /^7\. disclaimer of warranty/i,
      /^8\. limitation of liability/i,
      /^9\. indemnification/i,
      /^10\. governing law/i,
      /^11\. changes to these terms/i,
      /^12\. contact/i,
    ];
    for (const re of expected) {
      expect(screen.getByRole('heading', { level: 2, name: re })).toBeInTheDocument();
    }
  });

  it('cross-links the privacy and pricing pages', () => {
    render(<TermsPage />);
    const privacy = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href') === '/privacy');
    expect(privacy.length).toBeGreaterThanOrEqual(1);
    const pricing = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href') === '/pricing');
    expect(pricing.length).toBeGreaterThanOrEqual(1);
  });
});
