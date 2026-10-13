import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Pill } from './pill.js';

describe('<Pill />', () => {
  it('renders an <a> by default — Pill is the navigation primitive', () => {
    render(<Pill href="/start">Get started</Pill>);
    const link = screen.getByRole('link', { name: 'Get started' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/start');
  });

  it('applies the black variant by default', () => {
    render(<Pill href="/x">CTA</Pill>);
    const link = screen.getByRole('link', { name: 'CTA' });
    expect(link.className).toContain('bg-brand');
    expect(link.className).toContain('text-white');
    expect(link.className).toContain('rounded-standard');
  });

  it('renders the warm-stone signature variant with the warm shadow', () => {
    render(
      <Pill href="/start" variant="warmStone">
        Featured
      </Pill>,
    );
    const link = screen.getByRole('link', { name: 'Featured' });
    expect(link.className).toContain('bg-brand-soft');
    expect(link.className).toContain('rounded-standard');
    expect(link.className).toContain('bg-brand-soft');
  });

  it('renders the white-shadow variant with the layered card shadow', () => {
    render(
      <Pill href="/x" variant="whiteShadow">
        Secondary
      </Pill>,
    );
    const link = screen.getByRole('link', { name: 'Secondary' });
    expect(link.className).toContain('bg-white');
    expect(link.className).toContain('border-border-light');
  });

  it('renders a trailing arrow when `withArrow` is set, marked aria-hidden', () => {
    render(
      <Pill href="/x" withArrow>
        Continue
      </Pill>,
    );
    const link = screen.getByRole('link', { name: 'Continue' });
    const svg = link.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden');
  });

  it('does not render an arrow by default', () => {
    render(<Pill href="/x">Plain</Pill>);
    const link = screen.getByRole('link', { name: 'Plain' });
    expect(link.querySelector('svg')).toBeNull();
  });

  it('renders as the child element when `asChild` is true (Next.js <Link> integration)', () => {
    render(
      <Pill asChild>
        <a href="/sign-up" data-testid="custom-anchor">
          Sign up
        </a>
      </Pill>,
    );
    const link = screen.getByTestId('custom-anchor');
    expect(link.tagName).toBe('A');
    expect(link.className).toContain('bg-brand');
  });

  it('forwards refs to the underlying anchor', () => {
    const ref = React.createRef<HTMLAnchorElement>();
    render(
      <Pill ref={ref} href="/x">
        Ref
      </Pill>,
    );
    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName).toBe('A');
  });
});
