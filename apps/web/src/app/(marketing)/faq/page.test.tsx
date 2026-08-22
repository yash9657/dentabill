import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import FaqPage from './page.js';

describe('/faq', () => {
  it('renders the hero h1', () => {
    render(<FaqPage />);
    expect(
      screen.getByRole('heading', { level: 1, name: /questions we hear most/i }),
    ).toBeInTheDocument();
  });

  it('renders all five category headings', () => {
    render(<FaqPage />);
    const headings = [
      /getting dentabill running in your practice/i,
      /cost and value/i,
      /how patient data is handled/i,
      /which insurance companies the agent can call/i,
      /how dentabill plays with the rest of your stack/i,
    ];
    for (const re of headings) {
      expect(screen.getByRole('heading', { level: 2, name: re })).toBeInTheDocument();
    }
  });

  it('renders questions as collapsed <details> by default', () => {
    const { container } = render(<FaqPage />);
    const details = container.querySelectorAll('details');
    expect(details.length).toBeGreaterThanOrEqual(13);
    for (const d of details) {
      expect(d).not.toHaveAttribute('open');
    }
  });

  it('expands an item when its summary is clicked', async () => {
    const user = userEvent.setup();
    render(<FaqPage />);
    const summary = screen.getByText(/how long does setup take\?/i);
    const detail = summary.closest('details');
    expect(detail).not.toBeNull();
    if (!detail) return;
    expect(detail.open).toBe(false);
    await user.click(summary);
    expect(detail.open).toBe(true);
  });

  it('cross-links the pricing and security pages from the FAQ', () => {
    render(<FaqPage />);
    const links = screen.getAllByRole('link');
    expect(links.some((a) => a.getAttribute('href') === '/pricing')).toBe(true);
    expect(links.some((a) => a.getAttribute('href') === '/security')).toBe(true);
  });

  it('renders the closing CTA pointing at /contact and /sign-up', () => {
    render(<FaqPage />);
    expect(screen.getByRole('link', { name: /ask us anything/i })).toHaveAttribute(
      'href',
      '/contact',
    );
    expect(screen.getByRole('link', { name: /start free trial/i })).toHaveAttribute(
      'href',
      '/sign-up',
    );
  });
});
