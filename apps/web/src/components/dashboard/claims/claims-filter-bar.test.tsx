import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { ClaimsFilters } from '../../../lib/claims/types.js';

import { ClaimsFilterBar } from './claims-filter-bar.js';

function ControlledHarness({
  initial,
  onChange,
}: {
  readonly initial?: ClaimsFilters;
  readonly onChange?: (next: ClaimsFilters) => void;
}): React.ReactElement {
  const [filters, setFilters] = React.useState<ClaimsFilters>(initial ?? {});
  return (
    <ClaimsFilterBar
      filters={filters}
      onChange={(next) => {
        setFilters(next);
        onChange?.(next);
      }}
    />
  );
}

describe('<ClaimsFilterBar />', () => {
  it('renders search input and chip groups for status and payer', () => {
    render(<ClaimsFilterBar filters={{}} onChange={() => undefined} />);
    expect(screen.getByRole('searchbox', { name: /search claim number/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /status/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /payer/i })).toBeInTheDocument();
  });

  it('emits a status filter when a status chip is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ClaimsFilterBar filters={{}} onChange={onChange} />);
    const denied = screen.getByRole('button', { name: 'Denied' });
    await user.click(denied);
    expect(onChange).toHaveBeenCalledWith({ status: 'DENIED' });
  });

  it('clears a status filter when "All" is clicked', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ClaimsFilterBar filters={{ status: 'CALLING' }} onChange={onChange} />);
    const allChips = screen
      .getByRole('group', { name: /status/i })
      .querySelectorAll('button[aria-pressed]');
    const allChip = Array.from(allChips).find((b) => b.textContent === 'All');
    expect(allChip).toBeDefined();
    await user.click(allChip as HTMLElement);
    expect(onChange).toHaveBeenCalledWith({});
  });

  it('marks the active payer chip with aria-pressed=true', () => {
    render(<ClaimsFilterBar filters={{ payer: 'CIGNA_DENTAL' }} onChange={() => undefined} />);
    const cigna = screen.getByRole('button', { name: 'Cigna Dental' });
    expect(cigna).toHaveAttribute('aria-pressed', 'true');
  });

  it('emits a search filter trimmed of whitespace', async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<ControlledHarness onChange={onChange} />);
    const input = screen.getByRole('searchbox', { name: /search claim number/i });
    await user.type(input, '  CL-9 ');
    const lastCall = onChange.mock.calls.at(-1)?.[0] as { search?: string };
    expect(lastCall.search).toBe('CL-9');
  });
});
