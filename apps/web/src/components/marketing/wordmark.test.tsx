import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Wordmark } from './wordmark.js';

describe('<Wordmark />', () => {
  it('renders the literal "DentaBill" text', () => {
    render(<Wordmark data-testid="wm" />);
    expect(screen.getByTestId('wm')).toHaveTextContent('DentaBill');
  });

  it('applies the requested size class', () => {
    const { rerender } = render(<Wordmark size="sm" data-testid="wm" />);
    expect(screen.getByTestId('wm').className).toContain('text-base');
    rerender(<Wordmark size="lg" data-testid="wm" />);
    expect(screen.getByTestId('wm').className).toContain('text-xl');
  });

  it('forwards arbitrary HTML attributes', () => {
    render(<Wordmark id="brand" title="DentaBill" />);
    const span = screen.getByTitle('DentaBill');
    expect(span).toHaveAttribute('id', 'brand');
  });
});
