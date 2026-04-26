import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SectionDisplay } from './section-display.js';

describe('<SectionDisplay />', () => {
  it('renders an <h2> by default', () => {
    render(<SectionDisplay>Section</SectionDisplay>);
    const h = screen.getByRole('heading', { level: 2, name: 'Section' });
    expect(h.tagName).toBe('H2');
  });

  it('applies the section-heading typography role + light weight', () => {
    render(<SectionDisplay>Section</SectionDisplay>);
    const h = screen.getByRole('heading', { name: 'Section' });
    expect(h.className).toContain('text-section-heading');
    expect(h.className).toContain('font-display');
    expect(h.className).toContain('font-light');
  });

  it('supports `asChild` to render a different heading level', () => {
    render(
      <SectionDisplay asChild>
        <h3 data-testid="h3">As h3</h3>
      </SectionDisplay>,
    );
    const h = screen.getByTestId('h3');
    expect(h.tagName).toBe('H3');
    expect(h.className).toContain('text-section-heading');
  });
});
