import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DashboardEmptyState } from './dashboard-empty-state.js';

describe('<DashboardEmptyState />', () => {
  it('renders eyebrow, title, body, preview, and primary CTA', () => {
    render(
      <DashboardEmptyState
        eyebrow="Claims"
        title="Bring in your open claims"
        body="Upload CSV."
        previewChildren={<div data-testid="preview" />}
        primaryCta={{ label: 'Import claims', href: '/dashboard/claims/import' }}
      />,
    );
    expect(screen.getByRole('region', { name: 'Claims' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: /bring in your open claims/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/upload csv/i)).toBeInTheDocument();
    expect(screen.getByTestId('preview')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /import claims/i })).toHaveAttribute(
      'href',
      '/dashboard/claims/import',
    );
  });

  it('renders the optional secondary CTA when provided', () => {
    render(
      <DashboardEmptyState
        eyebrow="x"
        title="y"
        body="z"
        previewChildren={null}
        primaryCta={{ label: 'a', href: '/a' }}
        secondaryCta={{ label: 'b', href: '/b' }}
      />,
    );
    expect(screen.getByRole('link', { name: 'a' })).toHaveAttribute('href', '/a');
    expect(screen.getByRole('link', { name: 'b' })).toHaveAttribute('href', '/b');
  });

  it('omits the secondary CTA when not provided', () => {
    render(
      <DashboardEmptyState
        eyebrow="x"
        title="y"
        body="z"
        previewChildren={null}
        primaryCta={{ label: 'only', href: '/only' }}
      />,
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });
});
