import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { ClaimsListPage } from './claims-list-page.js';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        start: index * 60,
        size: 60,
        end: (index + 1) * 60,
        key: index,
        lane: 0,
      })),
    getTotalSize: () => count * 60,
  }),
}));

vi.mock('../../../lib/api-client.js', () => ({
  useDentaBillApi: () => ({
    client: {
      GET: vi.fn(async () => ({
        data: {
          items: [
            {
              id: 'a',
              organizationId: 'org_a',
              patientDOBHash: 'h',
              patientDOBLast4: '1990',
              claimNumber: 'CL-LIST-1',
              cdtCodes: [],
              claimAmount: '100.00',
              payerCode: 'DELTA_DENTAL_PPO',
              serviceDate: '2026-01-15T00:00:00.000Z',
              submittedDate: null,
              status: 'PENDING',
              priority: 50,
              retryCount: 0,
              maxRetries: 3,
              createdAt: '2026-01-15T00:00:00.000Z',
              updatedAt: '2026-01-15T00:00:00.000Z',
            },
          ],
          nextCursor: null,
          hasMore: false,
        },
      })),
    },
    withAuthHeaders: async () => ({}),
  }),
}));

beforeAll(() => {
  vi.stubEnv('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', 'pk_test_dummy_for_unit_test');
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe('<ClaimsListPage />', () => {
  it('renders the heading and a row from the mocked SDK response', async () => {
    const client = createDentaBillQueryClient();
    render(
      <QueryProvider client={client}>
        <ClaimsListPage />
      </QueryProvider>,
    );
    expect(screen.getByRole('heading', { name: /open claims queue/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('CL-LIST-1')).toBeInTheDocument();
    });
  });
});
