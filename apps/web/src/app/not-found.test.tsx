import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import NotFound from './not-found.js';

describe('<NotFound />', () => {
  it('renders the 404 marker and a back-home link', () => {
    render(<NotFound />);
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /page not found/i })).toBeInTheDocument();
    const home = screen.getByRole('link', { name: /back home/i });
    expect(home).toHaveAttribute('href', '/');
  });
});
