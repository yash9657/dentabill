import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import HomePage from './page.js';

describe('HomePage (Phase 2 scaffold)', () => {
  it('renders the hero copy', () => {
    render(<HomePage />);
    expect(
      screen.getByRole('heading', { level: 1, name: /stop waiting on hold/i }),
    ).toBeInTheDocument();
  });

  it('renders both CTA pills with the expected hrefs', () => {
    render(<HomePage />);
    const startTrial = screen.getByRole('link', { name: /start free trial/i });
    expect(startTrial).toHaveAttribute('href', '/sign-up');
    const bookDemo = screen.getByRole('link', { name: /book demo/i });
    expect(bookDemo).toHaveAttribute('href', '/contact');
  });
});
