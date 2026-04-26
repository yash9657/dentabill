import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Label } from './label.js';

describe('<Label />', () => {
  it('renders the label text', () => {
    render(<Label htmlFor="email">Email address</Label>);
    expect(screen.getByText('Email address')).toBeInTheDocument();
  });

  it('forwards htmlFor', () => {
    render(<Label htmlFor="x">x</Label>);
    expect(screen.getByText('x')).toHaveAttribute('for', 'x');
  });

  it('uses caption type scale (14px / weight 500)', () => {
    render(<Label>x</Label>);
    expect(screen.getByText('x').className).toContain('text-caption');
  });
});
