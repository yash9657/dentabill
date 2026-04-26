import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OverviewEmptySection } from './overview-empty-section.js';

describe('<OverviewEmptySection />', () => {
  it('renders eyebrow, heading, body, and a CTA pointing at the supplied href', () => {
    render(
      <OverviewEmptySection
        eyebrow="Recent claims"
        heading="Nothing in the queue yet"
        body="Upload a CSV to get started."
        ctaLabel="Open claims"
        ctaHref="/dashboard/claims"
      />,
    );
    expect(screen.getByText(/recent claims/i)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: /nothing in the queue yet/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/upload a csv to get started/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open claims/i })).toHaveAttribute(
      'href',
      '/dashboard/claims',
    );
  });

  it('uses no chromatic surface — achromatic + warm only (ADR-013)', () => {
    const { container } = render(
      <OverviewEmptySection eyebrow="x" heading="y" body="z" ctaLabel="open" ctaHref="/x" />,
    );
    expect(container.innerHTML).not.toMatch(/text-call-active|bg-call-active|text-blue|text-red/);
  });
});
