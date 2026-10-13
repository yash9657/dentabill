import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { observationListFixture } from './claim-observations.fixtures.js';
import { ClaimObservations } from './claim-observations.js';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  auth: { orgId: 'org-a', userId: 'user-a', isLoaded: true },
}));
vi.mock('@clerk/nextjs', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../../lib/api-client.js', () => ({
  useDentaBillApi: () => ({
    client: { GET: mocks.get, POST: mocks.post },
    withAuthHeaders: async () => ({}),
  }),
}));

function mount() {
  const client = createDentaBillQueryClient();
  const view = render(
    <QueryProvider client={client}>
      <ClaimObservations claimId="claim-test" />
    </QueryProvider>,
  );
  return {
    ...view,
    refresh: () => {
      view.rerender(
        <QueryProvider client={client}>
          <ClaimObservations claimId="claim-test" />
        </QueryProvider>,
      );
    },
  };
}

function success<T>(data: T) {
  return { data, response: new Response(null, { status: 200 }) };
}

function failure(message: string) {
  return { error: { message }, response: new Response(null, { status: 409 }) };
}

beforeEach(() => {
  mocks.auth.orgId = 'org-a';
  mocks.auth.userId = 'user-a';
  mocks.auth.isLoaded = true;
  mocks.get.mockReset().mockResolvedValue(success(observationListFixture()));
  mocks.post.mockReset().mockResolvedValue(success({}));
});

describe('Versioned claim observations', () => {
  it('separates payer-reported money from verified payment and shows exact source evidence', async () => {
    const user = userEvent.setup();
    const version = observationListFixture().items[0]!.sources[0]!.version;
    mount();
    expect(await screen.findByText('Payment reported by payer')).toBeInTheDocument();
    expect(screen.getByText('Synthetic test data')).toBeInTheDocument();
    expect(screen.getByText('Payment receipt and posting are unverified.')).toBeInTheDocument();
    expect(screen.getByText('$80.00')).toBeInTheDocument();
    expect(screen.getAllByText(/Payer: Payment of \$80.00/)).toHaveLength(2);
    expect(screen.getByText(/does not submit a claim or verify a payment/)).toBeInTheDocument();
    expect(version).toMatch(/^[a-f0-9]{64}$/);
    expect(screen.getByTitle(version)).toHaveTextContent(version.slice(0, 12));
    await user.click(screen.getByText('Source and analysis details'));
    expect(screen.getByText(version, { exact: true })).toBeVisible();
  });

  it('binds review to the displayed digest and claim version with no financial transition', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Mark reviewed' }));
    expect(mocks.post).toHaveBeenCalledWith(
      '/v1/observations/{id}/review',
      expect.objectContaining({
        params: { path: { id: 'observation-test' } },
        body: {
          expectedDigest: '1'.repeat(64),
          expectedClaimVersion: '2026-10-13T00:00:00.000Z',
          decision: 'ACKNOWLEDGED',
        },
      }),
    );
    expect(JSON.stringify(mocks.post.mock.calls)).not.toContain('RESOLVED');
  });

  it('requires a dismissal reason and saves it with the exact evidence version', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Dismiss finding' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Add a reason');
    expect(mocks.post).not.toHaveBeenCalled();
    await user.type(
      screen.getByRole('textbox', { name: /Review note/ }),
      'Reported amount belongs to another claim.',
    );
    await user.click(screen.getByRole('button', { name: 'Dismiss finding' }));
    expect(mocks.post).toHaveBeenCalledWith(
      '/v1/observations/{id}/review',
      expect.objectContaining({
        body: expect.objectContaining({
          decision: 'DISMISSED',
          note: 'Reported amount belongs to another claim.',
        }),
      }),
    );
  });

  it.each([
    'CLAIM_CHANGED',
    'SUPERSEDED',
    'NEWER_CALL',
    'TRANSCRIPT_CHANGED',
    'NEWER_GENERATION',
  ] as const)('keeps %s evidence readable without offering review', async (staleReason) => {
    const data = observationListFixture();
    data.items[0]!.canReview = false;
    data.items[0]!.staleReason = staleReason;
    mocks.get.mockResolvedValue(success(data));
    mount();
    expect(await screen.findByText('Payment reported by payer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Mark reviewed' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss finding' })).not.toBeInTheDocument();
  });

  it.each([
    [
      'CLAIM_CHANGED',
      'The claim changed after this finding was generated. Review fresh evidence before acting.',
    ],
    ['NEWER_CALL', 'A newer call exists. Review its evidence before acting.'],
    ['TRANSCRIPT_CHANGED', 'The source transcript changed. Review fresh evidence before acting.'],
    ['NEWER_GENERATION', 'A newer analysis was approved. Check its saved request before acting.'],
  ] as const)(
    'keeps the recorded review and later %s warning visible together',
    async (staleReason, warning) => {
      const data = observationListFixture();
      data.items[0]!.canReview = false;
      data.items[0]!.staleReason = staleReason;
      data.items[0]!.review = {
        decision: 'ACKNOWLEDGED',
        note: 'Reviewed the original evidence.',
        reviewedAt: '2026-10-13T02:00:00.000Z',
        reviewedByUserId: 'user-a',
      };
      mocks.get.mockResolvedValue(success(data));
      mount();
      expect(await screen.findByText('Marked reviewed')).toBeInTheDocument();
      expect(screen.getByText('Reviewed the original evidence.')).toBeInTheDocument();
      expect(screen.getByText(warning)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Mark reviewed' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Dismiss finding' })).not.toBeInTheDocument();
      expect(mocks.post).not.toHaveBeenCalled();
    },
  );

  it('refreshes stale evidence after a rejected review and does not claim success', async () => {
    const user = userEvent.setup();
    const data = observationListFixture();
    mocks.post.mockImplementation(async () => {
      data.items[0]!.canReview = false;
      data.items[0]!.staleReason = 'CLAIM_CHANGED';
      mocks.get.mockResolvedValue(success(data));
      return failure('PRIVATE_PROVIDER_PAYLOAD');
    });
    mount();
    await user.click(await screen.findByRole('button', { name: 'Mark reviewed' }));
    expect(await screen.findByText(/The claim changed after this finding/)).toBeInTheDocument();
    expect(screen.queryByText('Marked reviewed')).not.toBeInTheDocument();
    expect(screen.queryByText(/PRIVATE_PROVIDER/)).not.toBeInTheDocument();
  });

  it('publishes a saved result without requesting model configuration or new inference', async () => {
    const user = userEvent.setup();
    const data = observationListFixture();
    data.items = [];
    data.publishableCalls = [{ callId: 'saved-call', createdAt: '2026-10-13T00:00:00.000Z' }];
    mocks.get.mockResolvedValue(success(data));
    mount();
    await user.click(await screen.findByRole('button', { name: 'Add saved findings' }));
    expect(mocks.post).toHaveBeenCalledWith(
      '/v1/calls/{id}/observations/publish',
      expect.objectContaining({ params: { path: { id: 'saved-call' } }, body: {} }),
    );
  });

  it('paginates historical findings with the server cursor', async () => {
    const user = userEvent.setup();
    const data = observationListFixture();
    data.hasMore = true;
    data.nextCursor = 'older-cursor';
    mocks.get
      .mockResolvedValueOnce(success(data))
      .mockResolvedValue(success({ ...observationListFixture(), items: [] }));
    mount();
    await user.click(await screen.findByRole('button', { name: 'Load earlier findings' }));
    expect(mocks.get).toHaveBeenLastCalledWith(
      '/v1/claims/{id}/observations',
      expect.objectContaining({
        params: { path: { id: 'claim-test' }, query: { limit: 10, cursor: 'older-cursor' } },
      }),
    );
  });

  it('resets sensitive review notes and findings when organization scope changes', async () => {
    const user = userEvent.setup();
    const view = mount();
    await user.type(
      await screen.findByRole('textbox', { name: /Review note/ }),
      'Private old practice note',
    );
    mocks.auth.orgId = 'org-b';
    mocks.get.mockResolvedValue(success({ ...observationListFixture(), items: [] }));
    view.refresh();
    await screen.findByText(/No versioned findings yet/);
    expect(screen.queryByDisplayValue('Private old practice note')).not.toBeInTheDocument();
    expect(screen.queryByText('Payment reported by payer')).not.toBeInTheDocument();
  });

  it('renders untrusted transcript markup as text', async () => {
    const data = observationListFixture();
    data.items[0]!.sources[0]!.text = '<img src=x onerror=alert(1)>';
    mocks.get.mockResolvedValue(success(data));
    const view = mount();
    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(view.container.querySelector('img')).toBeNull();
  });

  it('retries a failed list fetch without exposing its private response', async () => {
    mocks.get.mockResolvedValueOnce(failure('PRIVATE'));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry findings' }));
    await waitFor(() => {
      expect(screen.getByText('Payment reported by payer')).toBeInTheDocument();
    });
    expect(screen.queryByText('PRIVATE')).not.toBeInTheDocument();
  });
});
