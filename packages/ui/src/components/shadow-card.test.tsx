import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ShadowCard } from './shadow-card.js';

describe('<ShadowCard />', () => {
  it('renders the neutral tone with the layered card shadow by default', () => {
    render(<ShadowCard data-testid="card">Content</ShadowCard>);
    const card = screen.getByTestId('card');
    expect(card.className).toContain('bg-white');
    expect(card.className).toContain('shadow-card-layered');
    expect(card.className).toContain('rounded-section');
  });

  it('renders the warm tone with the warm-tinted shadow + warm-stone surface', () => {
    render(
      <ShadowCard tone="warm" data-testid="card">
        Featured
      </ShadowCard>,
    );
    const card = screen.getByTestId('card');
    expect(card.className).toContain('bg-warm-stone/80');
    expect(card.className).toContain('shadow-warm');
  });

  it('respects padding="roomy" for spacious surfaces', () => {
    render(
      <ShadowCard padding="roomy" data-testid="card">
        Roomy
      </ShadowCard>,
    );
    const card = screen.getByTestId('card');
    expect(card.className).toContain('p-6');
  });

  it('merges caller className without losing tone/padding classes', () => {
    render(
      <ShadowCard className="max-w-md" data-testid="card">
        Sized
      </ShadowCard>,
    );
    const card = screen.getByTestId('card');
    expect(card.className).toContain('max-w-md');
    expect(card.className).toContain('bg-white');
  });
});
