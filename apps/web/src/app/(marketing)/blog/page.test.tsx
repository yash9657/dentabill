import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import BlogIndexPage from './page.js';

describe('/blog (skeleton)', () => {
  it('renders the empty-state hero h1 when no posts are published', () => {
    render(<BlogIndexPage />);
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /no posts yet\. we would rather publish nothing/i,
      }),
    ).toBeInTheDocument();
  });

  it('renders the newsletter signup as the empty-state CTA', () => {
    render(<BlogIndexPage />);
    expect(screen.getByRole('button', { name: /subscribe/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
  });

  it('exposes a heading describing the empty-state purpose', () => {
    render(<BlogIndexPage />);
    expect(
      screen.getByRole('heading', { level: 2, name: /first post lands in your inbox/i }),
    ).toBeInTheDocument();
  });
});
