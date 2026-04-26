import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AuthFallback } from './auth-fallback.js';

describe('<AuthFallback />', () => {
  it('renders the sign-in headline and CTA pair', () => {
    render(<AuthFallback mode="sign-in" />);
    expect(screen.getByRole('heading', { level: 2, name: /private beta/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request access/i })).toHaveAttribute(
      'href',
      '/contact',
    );
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/');
  });

  it('switches the headline + region label for sign-up mode', () => {
    render(<AuthFallback mode="sign-up" />);
    expect(screen.getByRole('heading', { level: 2, name: /on invite/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /sign up availability/i })).toBeInTheDocument();
  });

  it('uses no chromatic surface — achromatic + warm only (ADR-013)', () => {
    const { container } = render(<AuthFallback mode="sign-in" />);
    const html = container.innerHTML;
    expect(html).not.toMatch(/text-call-active|bg-call-active|text-blue|text-green|text-red/);
  });
});
