import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CallsFilterBar } from './calls-filter-bar.js';

describe('<CallsFilterBar />', () => {
  it('renders Status + Payer chip groups with All chips and an aria-pressed toggle', () => {
    render(<CallsFilterBar filters={{}} onChange={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Payer' })).toBeInTheDocument();
    // The "All" chips inside Status + Payer groups should be active when no filter set.
    const allChips = screen.getAllByRole('button', { name: 'All' });
    expect(allChips).toHaveLength(2);
    for (const chip of allChips) expect(chip).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls onChange with a status filter when a status chip is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<CallsFilterBar filters={{}} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'On hold' }));
    expect(onChange).toHaveBeenCalledWith({ status: 'ON_HOLD' });
  });

  it('clears the status filter when clicking the active chip again via the All chip', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<CallsFilterBar filters={{ status: 'ON_HOLD' }} onChange={onChange} />);
    // Status group's All chip is the first one with name "All".
    const [statusAll] = screen.getAllByRole('button', { name: 'All' });
    if (!statusAll) throw new Error('no status All chip rendered');
    await user.click(statusAll);
    expect(onChange).toHaveBeenCalledWith({});
  });

  it('marks the active status chip with aria-pressed="true"', () => {
    render(<CallsFilterBar filters={{ status: 'COMPLETED' }} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Completed' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
