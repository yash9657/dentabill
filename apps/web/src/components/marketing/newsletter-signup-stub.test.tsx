import { render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { NewsletterSignupStub } from './newsletter-signup-stub.js';

describe('<NewsletterSignupStub />', () => {
  it('renders the email input + subscribe button', () => {
    render(<NewsletterSignupStub />);
    expect(screen.getByLabelText(/email address/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /subscribe/i })).toBeInTheDocument();
  });

  it('shows an inline error when submitted with an invalid email', async () => {
    const user = userEvent.setup();
    render(<NewsletterSignupStub />);
    await user.type(screen.getByLabelText(/email address/i), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /subscribe/i }));
    const error = await screen.findByRole('alert');
    expect(error).toHaveTextContent(/valid email/i);
    expect(screen.getByLabelText(/email address/i)).toHaveAttribute('aria-invalid', 'true');
  });

  it('flips into the success state after a valid submission', async () => {
    const user = userEvent.setup();
    render(<NewsletterSignupStub />);
    await user.type(screen.getByLabelText(/email address/i), 'biller@practice.com');
    await user.click(screen.getByRole('button', { name: /subscribe/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/we['’]ll keep you posted/i);
    expect(screen.queryByRole('button', { name: /subscribe/i })).not.toBeInTheDocument();
  });

  it('clears the error when the user resubmits with a valid email', async () => {
    const user = userEvent.setup();
    render(<NewsletterSignupStub />);
    const input = screen.getByLabelText(/email address/i);
    await user.type(input, 'bogus');
    await user.click(screen.getByRole('button', { name: /subscribe/i }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, 'biller@practice.com');
    await user.click(screen.getByRole('button', { name: /subscribe/i }));
    expect(await screen.findByRole('status')).toBeInTheDocument();
  });
});
