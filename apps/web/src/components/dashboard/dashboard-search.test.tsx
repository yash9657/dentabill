import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardSearch } from './dashboard-search.js';

// jsdom omits the dialog imperative API, so stub it before each test.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

describe('<DashboardSearch />', () => {
  it('renders a responsive trigger', () => {
    render(<DashboardSearch />);
    const triggers = screen.getAllByRole('button', { name: /open command palette/i });
    expect(triggers).toHaveLength(1);
  });

  it('opens the command palette dialog when the trigger is clicked', async () => {
    const user = userEvent.setup();
    render(<DashboardSearch />);
    const trigger = screen.getAllByRole('button', { name: /open command palette/i })[0]!;
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeInTheDocument();
  });

  it('opens the palette via the cmd+k keyboard shortcut', async () => {
    const user = userEvent.setup();
    render(<DashboardSearch />);
    await user.keyboard('{Meta>}k{/Meta}');
    expect(screen.getByRole('dialog', { name: /command palette/i })).toBeInTheDocument();
  });
});

it('filters actual navigation destinations and closes when one is selected', async () => {
  const user = userEvent.setup();
  render(<DashboardSearch />);
  await user.click(screen.getByRole('button', { name: /open command palette/i }));
  await user.type(screen.getByRole('searchbox', { name: 'Find a page' }), 'import');
  const link = screen.getByRole('link', { name: /import claims/i });
  expect(link).toHaveAttribute('href', '/dashboard/claims/import');
  expect(screen.queryByRole('link', { name: /Reports/ })).not.toBeInTheDocument();
  await user.click(link);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('finds the cash evidence inbox by account source task', async () => {
  const user = userEvent.setup();
  render(<DashboardSearch />);
  await user.click(screen.getByRole('button', { name: /open command palette/i }));
  await user.type(screen.getByRole('searchbox', { name: 'Find a page' }), 'account');
  expect(screen.getByRole('link', { name: /Cash evidence/ })).toHaveAttribute(
    'href',
    '/dashboard/cash-evidence',
  );
});

it('finds the remittance batch workflow by provider adjustment task', async () => {
  const user = userEvent.setup();
  render(<DashboardSearch />);
  await user.click(screen.getByRole('button', { name: /open command palette/i }));
  await user.type(screen.getByRole('searchbox', { name: 'Find a page' }), 'provider adjustments');
  expect(screen.getByRole('link', { name: /Remittance batches/ })).toHaveAttribute(
    'href',
    '/dashboard/remittance-batches',
  );
});

it('finds cash reconciliation through reservation release work', async () => {
  const user = userEvent.setup();
  render(<DashboardSearch />);
  await user.click(screen.getByRole('button', { name: /open command palette/i }));
  await user.type(screen.getByRole('searchbox', { name: 'Find a page' }), 'release reservations');
  expect(screen.getByRole('link', { name: /Cash reconciliation/ })).toHaveAttribute(
    'href',
    '/dashboard/cash-reconciliations',
  );
});

it('finds posting evidence through PMS receipt observation work', async () => {
  const user = userEvent.setup();
  render(<DashboardSearch />);
  await user.click(screen.getByRole('button', { name: /open command palette/i }));
  await user.type(screen.getByRole('searchbox', { name: 'Find a page' }), 'PMS receipt');
  expect(screen.getByRole('link', { name: /Posting evidence/ })).toHaveAttribute(
    'href',
    '/dashboard/posting-evidence',
  );
});
