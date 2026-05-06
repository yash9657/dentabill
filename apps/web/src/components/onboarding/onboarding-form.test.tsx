import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { OnboardingForm } from './onboarding-form.js';

// Force the Clerk-aware render path under unit tests. The component
// branches on `process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and the
// other branch (`StubOnboardingForm`) intentionally does NOT call
// `useAuth`/`useUser`, so the Clerk-hook assertions below would never
// fire without this stub.
beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_dummy_for_unit_test');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

vi.mock('../../lib/api-client.js', () => ({
  useDentaBillApi: () => ({
    client: null,
    withAuthHeaders: async () => ({ authorization: 'Bearer test' }),
  }),
}));

const reloadMock = vi.fn();
const getTokenMock = vi.fn().mockResolvedValue('fresh-token');

vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: getTokenMock }),
  useUser: () => ({ user: { reload: reloadMock } }),
}));

const originalFetch = global.fetch;
const assignMock = vi.fn();

beforeEach(() => {
  pushMock.mockReset();
  refreshMock.mockReset();
  reloadMock.mockReset();
  getTokenMock.mockClear();
  assignMock.mockReset();
  // jsdom's window.location.assign is a stub that throws "navigation not
  // implemented"; replace with a vi.fn we can assert against.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign: assignMock, href: '' },
  });
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

  it('flips the NPI label between optional and required based on payer selection (Phase B)', async () => {
    const user = userEvent.setup();
    render(<OnboardingForm />);

    // Default: no payers selected, NPI is optional.
    expect(screen.getByLabelText(/^npi \(optional\)/i)).toBeInTheDocument();

    // Tick a non-dialable payer (Aetna) — still optional.
    await user.click(screen.getByRole('checkbox', { name: /aetna dental/i }));
    expect(screen.getByLabelText(/^npi \(optional\)/i)).toBeInTheDocument();

    // Tick Delta Dental PPO — flips to required.
    await user.click(screen.getByRole('checkbox', { name: /delta dental ppo/i }));
    expect(screen.getByLabelText(/^npi \(required\)/i)).toBeInTheDocument();

    // Untick Delta — back to optional (Aetna alone is fine).
    await user.click(screen.getByRole('checkbox', { name: /delta dental ppo/i }));
    expect(screen.getByLabelText(/^npi \(optional\)/i)).toBeInTheDocument();
  });

  it('blocks submit with empty NPI when a dialable payer is selected (Phase B)', async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as never;
    const user = userEvent.setup();
    render(<OnboardingForm />);

    await user.type(screen.getByLabelText(/practice name/i), 'Sunrise Family Dental');
    await user.click(screen.getByRole('checkbox', { name: /delta dental ppo/i }));
    await user.type(screen.getByLabelText(/zip code/i), '94110');
    // NPI left blank.
    await user.click(screen.getByRole('button', { name: /continue to dashboard/i }));

    expect(await screen.findByText(/NPI is required when accepting/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('redirects to /dashboard/overview after a successful 200 from the API', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        organizationId: 'org_seed',
        userId: 'user_seed',
        alreadyOnboarded: false,
      }),
    }) as never;
    const user = userEvent.setup();
    render(<OnboardingForm />);

    await user.type(screen.getByLabelText(/practice name/i), 'Sunrise Family Dental');
    await user.click(screen.getByRole('checkbox', { name: /delta dental ppo/i }));
    await user.type(screen.getByLabelText(/^npi/i), '1234567890');
    await user.type(screen.getByLabelText(/zip code/i), '94110');
    await user.click(screen.getByRole('button', { name: /continue to dashboard/i }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/dashboard/overview');
    });

    // Best-effort Clerk session refresh so any post-redirect reader of
    // publicMetadata sees the freshly-stamped value. The dashboard
    // layout's onboarding gate reads the DB and doesn't depend on this.
    expect(reloadMock).toHaveBeenCalled();
    expect(getTokenMock).toHaveBeenCalledWith({ skipCache: true });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toContain('/v1/onboarding');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test');
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
    await user.click(screen.getByRole('checkbox', { name: /cigna dental/i }));
    await user.type(screen.getByLabelText(/^npi/i), '1234567890');
    await user.type(screen.getByLabelText(/zip code/i), '94110');
    await user.click(screen.getByRole('button', { name: /continue to dashboard/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/server says no/i);
    expect(pushMock).not.toHaveBeenCalled();
  });
});
