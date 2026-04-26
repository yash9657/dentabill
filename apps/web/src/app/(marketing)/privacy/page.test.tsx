import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import PrivacyPage from './page.js';

describe('/privacy', () => {
  it('renders the hero h1 and an effective date', () => {
    render(<PrivacyPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: /short, honest privacy policy/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/effective.*2026/i)).toBeInTheDocument();
  });

  it('renders all required policy section headings', () => {
    render(<PrivacyPage />);
    const headings = [
      /information we collect/i,
      /how we use information/i,
      /^phi specifically/i,
      /sharing and disclosure/i,
      /^cookies$/i,
      /retention and deletion/i,
      /your rights/i,
      /^children$/i,
      /changes to this policy/i,
      /^contact$/i,
    ];
    for (const re of headings) {
      expect(screen.getByRole('heading', { level: 2, name: re })).toBeInTheDocument();
    }
  });

  it('exposes mailto links for privacy, legal, and security inquiries', () => {
    render(<PrivacyPage />);
    expect(screen.getAllByRole('link', { name: /privacy@dentabill.example/i })[0]).toHaveAttribute(
      'href',
      'mailto:privacy@dentabill.example',
    );
    expect(screen.getByRole('link', { name: /legal@dentabill.example/i })).toHaveAttribute(
      'href',
      'mailto:legal@dentabill.example',
    );
    expect(screen.getByRole('link', { name: /security@dentabill.example/i })).toHaveAttribute(
      'href',
      'mailto:security@dentabill.example',
    );
  });

  it('cross-links the security page from the PHI and sharing sections', () => {
    render(<PrivacyPage />);
    const securityLinks = screen
      .getAllByRole('link')
      .filter((a) => a.getAttribute('href') === '/security');
    expect(securityLinks.length).toBeGreaterThanOrEqual(2);
  });
});
