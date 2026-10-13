import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CallsFilterBar } from './calls-filter-bar.js';

describe('<CallsFilterBar />', () => {
  it('labels both filters and defaults to all calls', () => {
    render(<CallsFilterBar filters={{}} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('');
    expect(screen.getByRole('combobox', { name: 'Payer' })).toHaveValue('');
  });
  it('filters calls while preserving the selected payer', async () => {
    const onChange = vi.fn();
    render(<CallsFilterBar filters={{ payer: 'CIGNA_DENTAL' }} onChange={onChange} />);
    await userEvent
      .setup()
      .selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'ON_HOLD');
    expect(onChange).toHaveBeenCalledWith({ status: 'ON_HOLD', payer: 'CIGNA_DENTAL' });
  });
  it('clears the selected status', async () => {
    const onChange = vi.fn();
    render(<CallsFilterBar filters={{ status: 'ON_HOLD' }} onChange={onChange} />);
    await userEvent.setup().selectOptions(screen.getByRole('combobox', { name: 'Status' }), '');
    expect(onChange).toHaveBeenCalledWith({});
  });
  it('shows the selected status', () => {
    render(<CallsFilterBar filters={{ status: 'COMPLETED' }} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveValue('COMPLETED');
  });
});
