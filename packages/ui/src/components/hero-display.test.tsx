import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { HeroDisplay } from './hero-display.js';

describe('<HeroDisplay />', () => {
  it('renders an <h1> by default', () => {
    render(<HeroDisplay>Whisper-thin</HeroDisplay>);
    const h = screen.getByRole('heading', { level: 1, name: 'Whisper-thin' });
    expect(h.tagName).toBe('H1');
  });

  it('applies the hero typography role + extralight weight (ADR-013)', () => {
    render(<HeroDisplay>Hero</HeroDisplay>);
    const h = screen.getByRole('heading', { name: 'Hero' });
    expect(h.className).toContain('text-hero');
    expect(h.className).toContain('font-display');
    expect(h.className).toContain('font-normal');
  });

  it('renders as the child element when `asChild` is true', () => {
    render(
      <HeroDisplay asChild>
        <h2 data-testid="h2">As h2</h2>
      </HeroDisplay>,
    );
    const h = screen.getByTestId('h2');
    expect(h.tagName).toBe('H2');
    // Hero typography propagates through the Slot.
    expect(h.className).toContain('text-hero');
  });

  it('merges caller className without losing typography classes', () => {
    render(<HeroDisplay className="text-center">Centered</HeroDisplay>);
    const h = screen.getByRole('heading', { name: 'Centered' });
    expect(h.className).toContain('text-center');
    expect(h.className).toContain('font-normal');
  });
});
