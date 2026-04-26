import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatusDot } from './status-dot.js';

describe('<StatusDot />', () => {
  it('renders an <span> with the idle (achromatic) variant by default', () => {
    render(<StatusDot data-testid="dot" />);
    const dot = screen.getByTestId('dot');
    expect(dot.tagName).toBe('SPAN');
    expect(dot.className).toContain('bg-gray-light');
    expect(dot.className).toContain('rounded-pill');
  });

  it('the `active` variant — and ONLY active — uses the teal status accent + pulse', () => {
    render(<StatusDot variant="active" data-testid="dot" />);
    const dot = screen.getByTestId('dot');
    // Per ADR-013, the muted teal accent appears only on active call states.
    expect(dot.className).toContain('bg-status-active');
    // Pulse is gated on motion-safe so reduced-motion users don't get the
    // animation (WCAG / ADR-021).
    expect(dot.className).toContain('motion-safe:status-pulse');
  });

  it('non-active variants stay achromatic (no teal leak)', () => {
    const variants = ['idle', 'pending', 'success', 'warning', 'error'] as const;
    for (const variant of variants) {
      const { unmount } = render(<StatusDot variant={variant} data-testid="dot" />);
      const dot = screen.getByTestId('dot');
      expect(dot.className, `variant ${variant} must not use status-active`).not.toContain(
        'bg-status-active',
      );
      expect(dot.className, `variant ${variant} must not pulse`).not.toContain('status-pulse');
      unmount();
    }
  });

  it('size="lg" uses the larger 2.5x2.5 footprint', () => {
    render(<StatusDot size="lg" data-testid="dot" />);
    const dot = screen.getByTestId('dot');
    expect(dot.className).toContain('h-2.5');
    expect(dot.className).toContain('w-2.5');
  });

  it('forwards aria-label so the dot can announce its state', () => {
    render(<StatusDot variant="active" aria-label="Status: calling" data-testid="dot" />);
    const dot = screen.getByTestId('dot');
    expect(dot).toHaveAttribute('aria-label', 'Status: calling');
  });
});
