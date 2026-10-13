import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ClaimsFilterBar } from './claims-filter-bar.js';

describe('<ClaimsFilterBar />', () => {
  it('provides labeled search, status and payer controls', () => {
    render(<ClaimsFilterBar filters={{}} onChange={vi.fn()} />);
    expect(screen.getByRole('searchbox', { name: /search claim number/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Payer' })).toHaveValue('');
  });
  it('changes status without discarding the payer', async () => {
    const onChange = vi.fn();
    render(<ClaimsFilterBar filters={{ payer: 'CIGNA_DENTAL' }} onChange={onChange} />);
    await userEvent
      .setup()
      .selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'DENIED');
    expect(onChange).toHaveBeenCalledWith({ payer: 'CIGNA_DENTAL', status: 'DENIED' });
  });
  it('removes a status when all statuses is selected', async () => {
    const onChange = vi.fn();
    render(<ClaimsFilterBar filters={{ status: 'CALLING' }} onChange={onChange} />);
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Status' }), '');
    expect(onChange).toHaveBeenCalledWith({});
  });
  it('clears all filters with one action', async () => {
    const onChange = vi.fn();
    render(
      <ClaimsFilterBar
        filters={{ payer: 'CIGNA_DENTAL', status: 'DENIED', search: '104' }}
        onChange={onChange}
      />,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onChange).toHaveBeenCalledWith({});
  });
});
