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
  it('renders both the desktop trigger and the mobile icon trigger', () => {
    render(<DashboardSearch />);
    const triggers = screen.getAllByRole('button', { name: /open command palette/i });
    expect(triggers.length).toBeGreaterThanOrEqual(2);
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
