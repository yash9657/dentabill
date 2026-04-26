import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Skeleton } from './skeleton.js';

describe('<Skeleton />', () => {
  it('uses the shimmer utility (achromatic per ADR-013, reduced-motion-safe)', () => {
    render(<Skeleton data-testid="s" />);
    expect(screen.getByTestId('s').className).toContain('shimmer');
  });

  it('forwards className', () => {
    render(<Skeleton data-testid="s" className="h-10 w-full" />);
    const s = screen.getByTestId('s');
    expect(s.className).toContain('h-10');
    expect(s.className).toContain('w-full');
  });
});
