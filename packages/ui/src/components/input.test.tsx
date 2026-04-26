import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { describe, expect, it } from 'vitest';

import { Input } from './input.js';

describe('<Input />', () => {
  it('renders a real <input>', () => {
    render(<Input aria-label="email" />);
    expect(screen.getByLabelText('email').tagName).toBe('INPUT');
  });

  it('forwards type attribute', () => {
    render(<Input type="password" aria-label="pw" />);
    expect(screen.getByLabelText('pw')).toHaveAttribute('type', 'password');
  });

  it('uses warm-tinted placeholder color (not cool gray) per DESIGN.md', () => {
    render(<Input aria-label="x" placeholder="email…" />);
    const inp = screen.getByLabelText('x');
    expect(inp.className).toContain('placeholder:text-gray-warm');
  });

  it('forwards refs', () => {
    const ref = React.createRef<HTMLInputElement>();
    render(<Input ref={ref} aria-label="x" />);
    expect(ref.current).not.toBeNull();
  });

  it('disabled state collapses pointer events', () => {
    render(<Input disabled aria-label="x" />);
    expect(screen.getByLabelText('x')).toBeDisabled();
  });

  it('merges caller className', () => {
    render(<Input className="font-mono" aria-label="x" />);
    expect(screen.getByLabelText('x').className).toContain('font-mono');
  });
});
