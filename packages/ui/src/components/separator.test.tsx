import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Separator } from './separator.js';

describe('<Separator />', () => {
  it('uses the border-light token', () => {
    render(<Separator data-testid="s" />);
    expect(screen.getByTestId('s').className).toContain('bg-border-light');
  });

  it('horizontal orientation: h-px w-full', () => {
    render(<Separator data-testid="s" orientation="horizontal" />);
    const s = screen.getByTestId('s');
    expect(s.className).toContain('h-px');
    expect(s.className).toContain('w-full');
  });

  it('vertical orientation: h-full w-px', () => {
    render(<Separator data-testid="s" orientation="vertical" />);
    const s = screen.getByTestId('s');
    expect(s.className).toContain('h-full');
    expect(s.className).toContain('w-px');
  });
});
