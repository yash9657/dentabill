import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import AboutPage from './page.js';

describe('/about', () => {
  it('renders the hero h1', () => {
    render(<AboutPage />);
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: /billing teams should not spend their day on hold/i,
      }),
    ).toBeInTheDocument();
  });

  it('renders the three "How we work" principle headings', () => {
    render(<AboutPage />);
    expect(
      screen.getByRole('heading', { level: 3, name: /phi is the boundary/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: /calls are work, not magic/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 3, name: /one product done well/i }),
    ).toBeInTheDocument();
  });

  it('renders both closing CTAs with the expected hrefs', () => {
    render(<AboutPage />);
    const demo = screen.getByRole('link', { name: /book a 20-minute demo/i });
    expect(demo).toHaveAttribute('href', '/contact');
    const trial = screen.getByRole('link', { name: /start free trial/i });
    expect(trial).toHaveAttribute('href', '/sign-up');
  });
});
