import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OnboardingForm } from './onboarding-form.js';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

const originalFetch = global.fetch;

beforeEach(() => {
  pushMock.mockReset();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('<OnboardingForm />', () => {
  it('shows inline validation when submitted empty', async () => {
    const user = userEvent.setup();
    render(<OnboardingForm />);
    await user.click(screen.getByRole('button', { name: /continue to dashboard/i }));
    expect(await screen.findByText(/tell us the practice name/i)).toBeInTheDocument();
    expect(await screen.findByText(/use a 5-digit us zip code/i)).toBeInTheDocument();
    expect(await screen.findByText(/select at least one payer/i)).toBeInTheDocument();
  });

  it('redirects to /dashboard/overview after a successful 204', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 204 }) as never;
    const user = userEvent.setup();
    render(<OnboardingForm />);

    await user.type(screen.getByLabelText(/practice name/i), 'Sunrise Family Dental');
    await user.type(screen.getByLabelText(/zip code/i), '94110');
    await user.click(screen.getByRole('checkbox', { name: /delta dental ppo/i }));
    await user.click(screen.getByRole('button', { name: /continue to dashboard/i }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/dashboard/overview');
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      practiceName: 'Sunrise Family Dental',
      zip: '94110',
      acceptedPayers: ['Delta Dental PPO'],
    });
  });

  it('surfaces an inline error on a 4xx response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'Server says no.' }),
    }) as never;
    const user = userEvent.setup();
    render(<OnboardingForm />);

    await user.type(screen.getByLabelText(/practice name/i), 'Sunrise Family Dental');
    await user.type(screen.getByLabelText(/zip code/i), '94110');
    await user.click(screen.getByRole('checkbox', { name: /cigna dental/i }));
    await user.click(screen.getByRole('button', { name: /continue to dashboard/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/server says no/i);
    expect(pushMock).not.toHaveBeenCalled();
  });
});
