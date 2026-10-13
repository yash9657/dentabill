import type { paths } from '@dentabill/api-sdk/types';
import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { focusManager } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CallAnalysisStatus } from './call-analysis-status.js';

type Status =
  paths['/v1/calls/{id}/summary/status']['get']['responses'][200]['content']['application/json'];
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  auth: { orgId: 'org-a', userId: 'user-a', isLoaded: true },
}));
vi.mock('@clerk/nextjs', () => ({ useAuth: () => mocks.auth }));
vi.mock('../../../lib/api-client.js', () => ({
  useDentaBillApi: () => ({
    client: { GET: mocks.get, POST: mocks.post },
    withAuthHeaders: async () => ({ authorization: 'Bearer synthetic-fixture' }),
  }),
}));
const call = { id: 'call-one', claimId: 'claim-one', status: 'COMPLETED' as const };
function status(overrides: Partial<Status> = {}): Status {
  return {
    callId: call.id,
    generation: 1,
    state: 'RESERVED',
    summaryId: null,
    provider: 'FIREWORKS',
    observationId: null,
    reviewRequired: false,
    canRetry: false,
    lastErrorCode: null,
    updatedAt: '2026-10-13T00:00:00.000Z',
    ...overrides,
  };
}
function ok<T>(data: T, code = 200) {
  return { data, response: new Response(null, { status: code }) };
}
function mount(callStatus: 'COMPLETED' | 'ON_HOLD' = 'COMPLETED') {
  const client = createDentaBillQueryClient();
  const ui = () => (
    <QueryProvider client={client}>
      <CallAnalysisStatus call={{ ...call, status: callStatus }} />
    </QueryProvider>
  );
  const view = render(ui());
  return {
    client,
    ...view,
    refresh: () => {
      view.rerender(ui());
    },
  };
}
async function tick(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
beforeEach(() => {
  mocks.auth.orgId = 'org-a';
  mocks.auth.userId = 'user-a';
  mocks.auth.isLoaded = true;
  mocks.get.mockReset().mockResolvedValue(ok(status()));
  mocks.post
    .mockReset()
    .mockResolvedValue(
      ok(
        { callId: call.id, jobId: 'job-one', retryNumber: 1, queuedAt: '2026-10-13T00:00:00.000Z' },
        202,
      ),
    );
});
afterEach(() => {
  focusManager.setFocused(undefined);
  vi.useRealTimers();
});

describe('Post-call analysis status', () => {
  it('does not request analysis status before a call ends or authentication loads', () => {
    const view = mount('ON_HOLD');
    expect(mocks.get).not.toHaveBeenCalled();
    view.unmount();
    mocks.auth.isLoaded = false;
    mount();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('links published native findings and invalidates only this practice, user, and claim', async () => {
    mocks.get.mockResolvedValue(ok(status({ state: 'APPLIED', observationId: 'observation-one' })));
    const { client } = mount();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    expect(await screen.findByText('Findings are ready for review.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Review claim findings' })).toHaveAttribute(
      'href',
      '/dashboard/claims/claim-one#claim-findings-heading',
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['claim-observations', 'org-a:user-a:claim-one'],
      exact: true,
    });
    expect(screen.getByText(/do not verify payment or change claim finances/)).toBeVisible();
    expect(mocks.get).toHaveBeenCalledWith(
      '/v1/calls/{id}/summary/status',
      expect.objectContaining({ params: { path: { id: call.id } } }),
    );
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('distinguishes a saved synthetic summary from native findings', async () => {
    mocks.get.mockResolvedValue(
      ok(status({ state: 'APPLIED', provider: 'SYNTHETIC', summaryId: 'summary-one' })),
    );
    mount();
    expect(await screen.findByText('The earlier call summary is saved.')).toBeVisible();
    expect(screen.getByText('Synthetic analysis')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Review claim findings' })).not.toBeInTheDocument();
  });

  it('stops checking an unrequested analysis after three reads and permits explicit refresh', async () => {
    vi.useFakeTimers();
    mocks.get.mockResolvedValue(ok(status({ state: 'NOT_REQUESTED', provider: null })));
    mount();
    await tick();
    await tick(60_000);
    expect(mocks.get).toHaveBeenCalledTimes(3);
    expect(mocks.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh analysis status' }));
    await tick();
    expect(mocks.get).toHaveBeenCalledTimes(4);
  });

  it('bounds pending polling and does not poll while the page is hidden', async () => {
    vi.useFakeTimers();
    mount();
    await tick();
    focusManager.setFocused(false);
    await tick(10_000);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    focusManager.setFocused(true);
    for (let i = 0; i < 16; i++) await tick(5000);
    const stoppedCount = mocks.get.mock.calls.length;
    expect(stoppedCount).toBeLessThanOrEqual(12);
    expect(stoppedCount).toBeGreaterThan(1);
    await tick(60_000);
    expect(mocks.get).toHaveBeenCalledTimes(stoppedCount);
  });

  it('does not let an older summary hide pending native work or stop its status checks', async () => {
    vi.useFakeTimers();
    mocks.get.mockResolvedValue(ok(status({ provider: 'FIREWORKS', summaryId: 'older-summary' })));
    mount();
    await tick();
    expect(screen.getByText('Analysis is waiting to finish.')).toBeVisible();
    expect(screen.queryByText('The earlier call summary is saved.')).not.toBeInTheDocument();
    await tick(5000);
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it.each(['UNKNOWN', 'REJECTED', 'APPLIED'] as const)(
    'does not poll terminal %s work or submit inference',
    async (state) => {
      vi.useFakeTimers();
      mocks.get.mockResolvedValue(ok(status({ state })));
      mount();
      await tick();
      await tick(60_000);
      expect(mocks.get).toHaveBeenCalledTimes(1);
      expect(mocks.post).not.toHaveBeenCalled();
    },
  );

  it('stops polling when durable review is required', async () => {
    vi.useFakeTimers();
    mocks.get.mockResolvedValue(ok(status({ state: 'SUBMITTING', reviewRequired: true })));
    mount();
    await tick();
    await tick(60_000);
    expect(mocks.get).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/needs attention from an owner/)).toBeVisible();
  });

  it.each([
    ['owner', true],
    ['billing staff', false],
  ] as const)(
    'explains saved raw recovery to %s without calling it unknown acceptance',
    async (_role, canRetry) => {
      mocks.get.mockResolvedValue(
        ok(status({ state: 'UNKNOWN', reviewRequired: false, canRetry })),
      );
      mount();
      expect(
        await screen.findByText(
          'A saved response is available. An owner or administrator can finish processing.',
        ),
      ).toBeVisible();
      if (canRetry) expect(screen.getByRole('button', { name: 'Retry processing' })).toBeVisible();
      else
        expect(screen.queryByRole('button', { name: 'Retry processing' })).not.toBeInTheDocument();
      expect(screen.queryByText(/needs investigation|needs attention/)).not.toBeInTheDocument();
      expect(mocks.post).not.toHaveBeenCalled();
    },
  );

  it('offers retry only when the server grants permission and sends no model or source input', async () => {
    const user = userEvent.setup();
    mocks.get.mockResolvedValue(ok(status({ canRetry: true })));
    mount();
    await user.click(await screen.findByRole('button', { name: 'Retry processing' }));
    expect(await screen.findByText(/Processing was requested/)).toBeVisible();
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(mocks.post).toHaveBeenCalledWith('/v1/calls/{id}/summary/retry', {
      params: { path: { id: call.id } },
      headers: { authorization: 'Bearer synthetic-fixture' },
    });
    expect(screen.queryByRole('button', { name: 'Retry processing' })).not.toBeInTheDocument();
  });

  it('does not offer billing staff a retry when canRetry is false', async () => {
    mount();
    await screen.findByText('Analysis is waiting to finish.');
    expect(screen.queryByRole('button', { name: 'Retry processing' })).not.toBeInTheDocument();
  });

  it('allows an authorized delivery retry to settle review without claiming findings exist', async () => {
    const user = userEvent.setup();
    mocks.get.mockResolvedValue(
      ok(status({ state: 'UNKNOWN', reviewRequired: true, canRetry: true })),
    );
    mocks.post.mockImplementation(async () => {
      mocks.get.mockResolvedValue(
        ok(status({ state: 'UNKNOWN', reviewRequired: true, canRetry: false })),
      );
      return ok({ callId: call.id }, 202);
    });
    mount();
    expect(await screen.findByText(/needs attention from an owner/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Retry processing' }));
    await screen.findByText(/Processing was requested/);
    expect(screen.queryByRole('link', { name: 'Review claim findings' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry processing' })).not.toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledOnce();
  });

  it('replaces retry confirmation with the published result when processing completes', async () => {
    const user = userEvent.setup();
    mocks.get.mockResolvedValue(ok(status({ canRetry: true })));
    mocks.post.mockImplementation(async () => {
      mocks.get.mockResolvedValue(
        ok(status({ state: 'APPLIED', observationId: 'observation-one' })),
      );
      return ok({ callId: call.id }, 202);
    });
    mount();
    await user.click(await screen.findByRole('button', { name: 'Retry processing' }));
    await screen.findByRole('link', { name: 'Review claim findings' });
    expect(screen.queryByText(/Processing was requested/)).not.toBeInTheDocument();
  });

  it('requires a successful status refresh after an unconfirmed retry, without retrying automatically', async () => {
    const user = userEvent.setup();
    mocks.get.mockResolvedValue(ok(status({ canRetry: true })));
    mocks.post.mockRejectedValue(new Error('PRIVATE_PROVIDER_ERROR'));
    mount();
    await user.click(await screen.findByRole('button', { name: 'Retry processing' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Refresh status before trying again',
    );
    expect(screen.queryByText(/PRIVATE_PROVIDER/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry processing' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refresh analysis status' }));
    expect(await screen.findByRole('button', { name: 'Retry processing' })).toBeVisible();
    expect(mocks.post).toHaveBeenCalledOnce();
  });

  it('handles a permission change without exposing server error text', async () => {
    const user = userEvent.setup();
    mocks.get.mockResolvedValue(ok(status({ canRetry: true })));
    mocks.post.mockResolvedValue({
      response: new Response(null, { status: 403 }),
      error: { message: 'PRIVATE_ERROR' },
    });
    mount();
    await user.click(await screen.findByRole('button', { name: 'Retry processing' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only a practice owner or administrator',
    );
    expect(screen.queryByText(/PRIVATE_ERROR/)).not.toBeInTheDocument();
  });

  it.each(['http', 'scope'] as const)(
    'fails closed for a %s mismatch without exposing response content',
    async (failure) => {
      mocks.get.mockResolvedValue(
        failure === 'http'
          ? { response: new Response(null, { status: 403 }), error: { message: 'PRIVATE_ERROR' } }
          : ok(status({ callId: 'another-call', observationId: 'other-observation' })),
      );
      mount();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Analysis status could not be checked',
      );
      expect(screen.queryByText(/PRIVATE_ERROR/)).not.toBeInTheDocument();
      expect(screen.queryByRole('link')).not.toBeInTheDocument();
    },
  );

  it('clears cached results and retry feedback when practice or user scope changes', async () => {
    mocks.get.mockResolvedValueOnce(
      ok(status({ state: 'APPLIED', observationId: 'observation-one' })),
    );
    const view = mount();
    await screen.findByRole('link', { name: 'Review claim findings' });
    mocks.get.mockImplementation(() => new Promise(() => undefined));
    mocks.auth.orgId = 'org-b';
    view.refresh();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.get).toHaveBeenCalledTimes(2);
    });
    mocks.auth.userId = 'user-b';
    view.refresh();
    await waitFor(() => {
      expect(mocks.get).toHaveBeenCalledTimes(3);
    });
    expect(view.client.getQueryData(['call-analysis', 'org-b:user-b:call-one'])).toBeUndefined();
  });
});
