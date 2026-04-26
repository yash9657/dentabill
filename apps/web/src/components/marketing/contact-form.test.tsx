import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ContactForm } from './contact-form.js';

const realFetch = globalThis.fetch;

describe('<ContactForm />', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('renders all five form fields with their labels', () => {
    render(<ContactForm />);
    expect(screen.getByLabelText(/your name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/work email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/practice name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/claims followed up per week/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/what is on your mind/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^send$/i })).toBeInTheDocument();
  });

  it('shows inline validation errors when submitting empty', async () => {
    const user = userEvent.setup();
    render(<ContactForm />);
    await user.click(screen.getByRole('button', { name: /^send$/i }));
    expect(await screen.findByText(/tell us your name/i)).toBeInTheDocument();
    expect(screen.getByText(/valid work email/i)).toBeInTheDocument();
    expect(screen.getByText(/tell us the practice name/i)).toBeInTheDocument();
    expect(screen.getByText(/at least a sentence/i)).toBeInTheDocument();
  });

  it('flips into the success state after a valid 204 response', async () => {
    const user = userEvent.setup();
    render(<ContactForm />);
    await user.type(screen.getByLabelText(/your name/i), 'Alex Garcia');
    await user.type(screen.getByLabelText(/work email/i), 'alex@yourpractice.com');
    await user.type(screen.getByLabelText(/practice name/i), 'Sunrise Family Dental');
    await user.type(
      screen.getByLabelText(/what is on your mind/i),
      'We follow up on around eighty claims a week with Delta and Cigna.',
    );
    await user.click(screen.getByRole('button', { name: /^send$/i }));
    expect(await screen.findByRole('status')).toHaveTextContent(/will be in touch/i);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/v1/contact',
      expect.objectContaining({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  it('surfaces a 429 message inline when the server rate-limits', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: 'rate limited' }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const user = userEvent.setup();
    render(<ContactForm />);
    await user.type(screen.getByLabelText(/your name/i), 'Alex Garcia');
    await user.type(screen.getByLabelText(/work email/i), 'alex@yourpractice.com');
    await user.type(screen.getByLabelText(/practice name/i), 'Sunrise Family Dental');
    await user.type(
      screen.getByLabelText(/what is on your mind/i),
      'We follow up on around eighty claims a week with Delta and Cigna.',
    );
    await user.click(screen.getByRole('button', { name: /^send$/i }));
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/rate limited/i);
    });
  });
});
