import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import BlogIndexPage from './page.js';

describe('/blog (skeleton)', () => {
  it('renders the empty-state hero h1 when no posts are published', () => {
    render(<BlogIndexPage />);
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /notes on dental billing/i,
      }),
    ).toBeInTheDocument();
  });

  it('offers the FAQ while articles are being prepared', () => {
    render(<BlogIndexPage />);
    expect(screen.getByRole('link', { name: /explore the faq/i })).toHaveAttribute('href', '/faq');
  });

  it('exposes a heading describing the empty-state purpose', () => {
    render(<BlogIndexPage />);
    expect(
      screen.getByRole('heading', { level: 2, name: /first notes are on the way/i }),
    ).toBeInTheDocument();
  });
});
