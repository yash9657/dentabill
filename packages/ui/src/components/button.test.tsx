import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Button } from './button.js';

describe('<Button />', () => {
  it('renders a real <button> by default with type="button"', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn).toHaveAttribute('type', 'button');
  });

  it('applies the primary (black pill) classes by default', () => {
    render(<Button>Click</Button>);
    const btn = screen.getByRole('button', { name: 'Click' });
    expect(btn.className).toContain('bg-black');
    expect(btn.className).toContain('text-white');
    expect(btn.className).toContain('rounded-pill');
  });

  it('supports the warm-stone variant — the signature warm CTA from DESIGN.md', () => {
    render(<Button variant="warmStone">Get started</Button>);
    const btn = screen.getByRole('button', { name: 'Get started' });
    expect(btn.className).toContain('bg-warm-stone/80');
    expect(btn.className).toContain('rounded-warm-button');
    expect(btn.className).toContain('shadow-warm');
  });

  it('supports the secondary (white pill with card shadow) variant', () => {
    render(<Button variant="secondary">Learn more</Button>);
    const btn = screen.getByRole('button', { name: 'Learn more' });
    expect(btn.className).toContain('bg-white');
    expect(btn.className).toContain('shadow-card');
    expect(btn.className).toContain('rounded-pill');
  });

  it('renders as the child element when `asChild` is true (Slot pattern)', () => {
    render(
      <Button asChild>
        <a href="/sign-up">Sign up</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Sign up' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', '/sign-up');
    // The button styling propagates to the slotted element.
    expect(link.className).toContain('bg-black');
  });

  it('forwards refs to the underlying button', () => {
    const ref = React.createRef<HTMLButtonElement>();
    render(<Button ref={ref}>Ref</Button>);
    expect(ref.current).not.toBeNull();
    expect(ref.current?.tagName).toBe('BUTTON');
  });

  it('respects disabled state — pointer events off, opacity reduced', () => {
    render(<Button disabled>Cannot click</Button>);
    const btn = screen.getByRole('button', { name: 'Cannot click' });
    expect(btn).toBeDisabled();
    expect(btn.className).toContain('disabled:opacity-50');
  });

  it('merges caller className without losing variant classes (twMerge)', () => {
    render(<Button className="w-full">Wide</Button>);
    const btn = screen.getByRole('button', { name: 'Wide' });
    expect(btn.className).toContain('w-full');
    expect(btn.className).toContain('bg-black');
  });

  it('size="warm" applies the warm-stone CTA padding', () => {
    render(
      <Button variant="warmStone" size="warm">
        Start trial
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Start trial' });
    expect(btn.className).toContain('h-10');
    expect(btn.className).toContain('px-4');
  });
});
