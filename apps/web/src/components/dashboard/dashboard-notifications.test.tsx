import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardNotifications } from './dashboard-notifications.js';

// jsdom omits the dialog imperative API, so stub it before each test.
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = vi.fn(function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  });
  HTMLDialogElement.prototype.close = vi.fn(function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  });
});

describe('<DashboardNotifications />', () => {
  it('renders the bell trigger', () => {
    render(<DashboardNotifications />);
    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument();
  });

  it('opens the notifications dialog when the bell is clicked', async () => {
    const user = userEvent.setup();
    render(<DashboardNotifications />);
    await user.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByRole('dialog', { name: /notifications/i })).toBeInTheDocument();
  });
});
