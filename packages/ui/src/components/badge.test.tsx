import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Badge } from './badge.js';

describe('<Badge />', () => {
  it('default variant uses achromatic gray-light bg + gray-dark text', () => {
    render(<Badge>PENDING</Badge>);
    const b = screen.getByText('PENDING');
    expect(b.className).toContain('bg-gray-light');
    expect(b.className).toContain('text-gray-dark');
  });

  it('active variant is the ONLY chromatic variant and uses the teal status accent', () => {
    render(<Badge variant="active">CALLING</Badge>);
    const b = screen.getByText('CALLING');
    expect(b.className).toContain('bg-status-active/15');
    expect(b.className).toContain('text-status-active');
  });

  it('muted variant uses the warm-stone treatment', () => {
    render(<Badge variant="muted">draft</Badge>);
    expect(screen.getByText('draft').className).toContain('bg-warm-stone/80');
  });

  it('outline variant uses light border + white bg', () => {
    render(<Badge variant="outline">tag</Badge>);
    const b = screen.getByText('tag');
    expect(b.className).toContain('border-border-light');
    expect(b.className).toContain('bg-white');
  });
});
