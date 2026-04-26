import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import Loading from './loading.js';

describe('<Loading />', () => {
  it('renders a status region announcing the loading state', () => {
    render(<Loading />);
    const status = screen.getByRole('status', { name: /loading/i });
    expect(status).toBeInTheDocument();
  });
});
