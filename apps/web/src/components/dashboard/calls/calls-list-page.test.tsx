import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const getMock = vi.fn();

vi.mock('../../../lib/api-client.js', () => ({
  useDentaBillApi: () => ({
    client: { GET: getMock, POST: vi.fn(), PATCH: vi.fn() },
    withAuthHeaders: async () => ({}),
  }),
}));

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 56,
        size: 56,
        end: (index + 1) * 56,
        key: index,
        lane: 0,
      })),
    getTotalSize: () => count * 56,
  }),
}));

import { CallsListPage } from './calls-list-page.js';

beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_dummy');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('<CallsListPage /> (P3-T24)', () => {
  it('renders the empty state when /v1/calls returns zero items', async () => {
    getMock.mockResolvedValueOnce({ data: { items: [], nextCursor: null, hasMore: false } });
    render(
      <QueryProvider client={createDentaBillQueryClient()}>
        <CallsListPage />
      </QueryProvider>,
    );
    expect(await screen.findByText(/no calls match these filters/i)).toBeInTheDocument();
  });

  it('renders rows when the API returns calls and the heading is correct', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        items: [
          {
            id: 'call_1',
            claimId: 'claim_1',
            retellCallId: 'rcid_1',
            retellAgentId: null,
            status: 'NAVIGATING_IVR',
            attemptNumber: 1,
            ivrNavigated: false,
            humanReached: false,
            holdTimeSeconds: null,
            startedAt: '2026-04-29T10:00:00.000Z',
            endedAt: null,
            durationSeconds: null,
            dlqReason: null,
            cancelRequestedAt: null,
            createdAt: '2026-04-29T10:00:00.000Z',
          },
        ],
        nextCursor: null,
        hasMore: false,
      },
    });
    render(
      <QueryProvider client={createDentaBillQueryClient()}>
        <CallsListPage />
      </QueryProvider>,
    );
    expect(await screen.findByRole('heading', { name: /Live payer calls/ })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('Navigating IVR')).toBeInTheDocument();
    });
  });

  it('falls back to the auth empty-state when Clerk keys are absent', () => {
    vi.unstubAllEnvs();
    render(
      <QueryProvider client={createDentaBillQueryClient()}>
        <CallsListPage />
      </QueryProvider>,
    );
    expect(screen.getByRole('heading', { name: /Live payer calls land here/ })).toBeInTheDocument();
    vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_dummy');
  });
});
