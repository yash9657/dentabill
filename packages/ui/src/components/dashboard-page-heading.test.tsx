import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { DashboardPageHeading } from './dashboard-page-heading.js';

describe('<DashboardPageHeading />', () => {
  it('renders an <h1> by default', () => {
    render(<DashboardPageHeading title="Claims" />);
    const h = screen.getByRole('heading', { level: 1, name: 'Claims' });
    expect(h.tagName).toBe('H1');
  });

  it('renders title with the card-heading typography (32px, weight 300)', () => {
    render(<DashboardPageHeading title="Dashboard" />);
    const h = screen.getByRole('heading', { name: 'Dashboard' });
    expect(h.className).toContain('text-[32px]');
    expect(h.className).toContain('font-light');
    expect(h.className).toContain('font-display');
  });

  it('renders an optional eyebrow at micro size, uppercase, warm-gray', () => {
    render(<DashboardPageHeading title="Overview" eyebrow="Section" />);
    const eyebrow = screen.getByText('Section');
    expect(eyebrow.className).toContain('text-micro');
    expect(eyebrow.className).toContain('text-gray-warm');
    expect(eyebrow.className).toContain('uppercase');
  });

  it('renders an optional description below the title in body text', () => {
    render(
      <DashboardPageHeading title="Claims" description="Track your insurance claim follow-ups" />,
    );
    const desc = screen.getByText('Track your insurance claim follow-ups');
    expect(desc.className).toContain('text-body');
    expect(desc.className).toContain('text-gray-dark');
  });

  it('supports the `level` prop to change heading level', () => {
    render(<DashboardPageHeading title="Subsection" level="h2" />);
    const h = screen.getByRole('heading', { level: 2, name: 'Subsection' });
    expect(h.tagName).toBe('H2');
    expect(h.className).toContain('font-display');
  });

  it('renders an optional actions slot (right-aligned on desktop)', () => {
    render(
      <DashboardPageHeading
        title="Settings"
        actions={<button data-testid="action-btn">Export</button>}
      />,
    );
    const btn = screen.getByTestId('action-btn');
    expect(btn).toBeInTheDocument();
  });

  it('merges className without losing core typography classes (twMerge)', () => {
    render(<DashboardPageHeading title="Test" className="custom-class" />);
    const header = screen.getByRole('heading', { name: 'Test' }).closest('header');
    expect(header?.className).toContain('custom-class');
    expect(header?.className).toContain('flex');
  });

  it('renders all parts together: eyebrow + title + description + actions', () => {
    render(
      <DashboardPageHeading
        title="Live Calls"
        eyebrow="Calls"
        description="Real-time payer interactions"
        actions={<span data-testid="action">Action</span>}
      />,
    );
    expect(screen.getByText('Calls')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Live Calls' })).toBeInTheDocument();
    expect(screen.getByText('Real-time payer interactions')).toBeInTheDocument();
    expect(screen.getByTestId('action')).toBeInTheDocument();
  });

  it('forwards refs to the underlying header element', () => {
    const ref = React.createRef<HTMLElement>();
    render(<DashboardPageHeading title="RefTest" ref={ref} />);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName).toBe('HEADER');
  });
});
