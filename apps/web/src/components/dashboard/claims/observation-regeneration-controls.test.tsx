import type { paths } from '@dentabill/api-sdk/types';
import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ObservationRegenerationControls } from './observation-regeneration-controls.js';

type Preview =
  paths['/v1/observations/{id}/regeneration-preview']['get']['responses'][200]['content']['application/json'];
type Status = NonNullable<Preview['activeAuthorization']>;
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn<(path: string, options: { body: unknown }) => Promise<unknown>>(),
}));
vi.mock('../../../lib/api-client.js', () => ({
  useDentaBillApi: () => ({
    client: { GET: mocks.get, POST: mocks.post },
    withAuthHeaders: async () => ({}),
  }),
}));

function status(overrides: Partial<Status> = {}): Status {
  return {
    id: 'saved-authorization',
    state: 'READY',
    createdAt: '2026-10-13T01:00:00.000Z',
    expiresAt: '2026-10-13T01:15:00.000Z',
    canResume: true,
    observationId: null,
    reasonCode: null,
    ...overrides,
  };
}
function preview(overrides: Partial<Preview> = {}): Preview {
  return {
    observationId: 'finding-one',
    claimId: 'claim-one',
    callId: 'call-one',
    canRegenerate: true,
    blockedReason: null,
    previewDigest: 'a'.repeat(64),
    dataClass: 'SYNTHETIC',
    nextGeneration: 2,
    claimVersion: '2026-10-13T00:00:00.000Z',
    source: {
      id: 'transcript.saved-event',
      version: 'b'.repeat(64),
      text: 'Payer: Corrected final transcript.',
    },
    release: {
      id: 'approved-synthetic-release',
      model: 'accounts/fixture/models/test',
      policyHash: 'c'.repeat(64),
      tokenAllowance: 16000,
      maxAttempts: 2,
      deadlineMs: 30000,
    },
    activeAuthorization: null,
    ...overrides,
  };
}
function ok<T>(data: T) {
  return { data, response: new Response(null, { status: 200 }) };
}
function mount() {
  const client = createDentaBillQueryClient();
  return render(
    <QueryProvider client={client}>
      <ObservationRegenerationControls observationId="finding-one" scope="org:user:claim-one" />
    </QueryProvider>,
  );
}
async function open() {
  const user = userEvent.setup();
  mount();
  await user.click(screen.getByRole('button', { name: 'New analysis' }));
  return user;
}
async function approve() {
  const user = await open();
  await user.type(
    await screen.findByRole('textbox', { name: /Reason for new analysis/ }),
    'The final transcript was corrected.',
  );
  await user.click(screen.getByRole('button', { name: 'Approve and generate' }));
  return user;
}
beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue(ok(preview()));
  mocks.post.mockReset().mockResolvedValue(ok(status()));
});

describe('Explicit observation regeneration', () => {
  it('loads an exact preview only after expansion, without sending model work', async () => {
    const user = userEvent.setup();
    mount();
    expect(mocks.get).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'New analysis' }));
    expect(await screen.findByText('Generation 2')).toBeVisible();
    expect(mocks.get).toHaveBeenCalledWith(
      '/v1/observations/{id}/regeneration-preview',
      expect.objectContaining({ params: { path: { id: 'finding-one' } } }),
    );
    expect(screen.getByText('2026-10-13T00:00:00.000Z')).toBeVisible();
    expect(screen.getByText(/16,000 tokens per attempt/)).toBeVisible();
    expect(screen.getByText(/not a price estimate/)).toBeVisible();
    expect(screen.getByText(/does not verify payment or change claim finances/)).toBeVisible();
    await user.click(screen.getByText('Exact source for this analysis'));
    expect(screen.getByText('Payer: Corrected final transcript.')).toBeVisible();
    expect(screen.getByText(`Transcript version ${'b'.repeat(64)}`)).toBeVisible();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('explains a stored-role refusal without exposing the response or offering approval', async () => {
    mocks.get.mockResolvedValue({
      error: { message: 'PRIVATE_ROLE_DETAIL' },
      response: new Response(null, { status: 403 }),
    });
    await open();
    expect(await screen.findByRole('alert')).toHaveTextContent('A practice owner or administrator');
    expect(screen.queryByText(/PRIVATE_ROLE/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve and generate' })).not.toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it.each([
    ['CONFIGURATION_UNAVAILABLE', /not configured/],
    ['RELEASE_UNAVAILABLE', /No approved model release/],
    ['SOURCE_UNAVAILABLE', /final source transcript is required/],
    ['WORK_NOT_READY', /Earlier analysis needs attention/],
  ] as const)(
    'keeps %s unavailable without a spending action',
    async (blockedReason, explanation) => {
      mocks.get.mockResolvedValue(
        ok(preview({ canRegenerate: false, blockedReason, previewDigest: null })),
      );
      await open();
      expect(await screen.findByText(explanation)).toBeVisible();
      expect(
        screen.queryByRole('button', { name: 'Approve and generate' }),
      ).not.toBeInTheDocument();
      expect(mocks.post).not.toHaveBeenCalled();
    },
  );

  it('requires a reason then sends only the frozen digest, reason, and request key', async () => {
    const user = await open();
    await user.click(await screen.findByRole('button', { name: 'Approve and generate' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Add a reason');
    expect(mocks.post).not.toHaveBeenCalled();
    await user.type(
      screen.getByRole('textbox', { name: /Reason for new analysis/ }),
      '  Corrected source.  ',
    );
    await user.click(screen.getByRole('button', { name: 'Approve and generate' }));
    await screen.findByText(/Your approval is saved/);
    expect(mocks.post).toHaveBeenCalledOnce();
    expect(mocks.post).toHaveBeenCalledWith(
      '/v1/observations/{id}/regenerate',
      expect.objectContaining({
        params: { path: { id: 'finding-one' } },
        body: {
          expectedPreviewDigest: 'a'.repeat(64),
          idempotencyKey: expect.stringMatching(/^[a-f0-9-]{36}$/),
          reason: 'Corrected source.',
        },
      }),
    );
    expect(screen.queryByRole('button', { name: 'Approve and generate' })).not.toBeInTheDocument();
  });

  it('recovers an accepted request after a lost response and resumes only that authorization', async () => {
    mocks.post.mockRejectedValueOnce(new Error('PRIVATE_PROVIDER_BODY'));
    const user = await approve();
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the saved request');
    expect(screen.queryByText(/PRIVATE_PROVIDER/)).not.toBeInTheDocument();
    expect(mocks.post).toHaveBeenCalledOnce();
    mocks.get.mockResolvedValue(
      ok(preview({ canRegenerate: false, activeAuthorization: status() })),
    );
    await user.click(screen.getByRole('button', { name: 'Check saved request' }));
    await user.click(await screen.findByRole('button', { name: 'Resume saved request' }));
    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledTimes(2);
    });
    expect(mocks.post).toHaveBeenLastCalledWith(
      '/v1/observation-regenerations/{id}/resume',
      expect.objectContaining({ params: { path: { id: 'saved-authorization' } }, body: {} }),
    );
  });

  it('retries an unconfirmed approval only explicitly with the same body and key after the preview changes', async () => {
    mocks.post.mockRejectedValueOnce(new Error('Disconnected'));
    const user = await approve();
    await screen.findByRole('alert');
    const original = structuredClone(mocks.post.mock.calls[0]?.[1]?.body);
    mocks.get.mockResolvedValue(ok(preview({ previewDigest: 'd'.repeat(64) })));
    await user.click(screen.getByRole('button', { name: 'Check saved request' }));
    expect(mocks.post).toHaveBeenCalledOnce();
    await user.click(await screen.findByRole('button', { name: 'Retry saved approval' }));
    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledTimes(2);
    });
    expect(mocks.post.mock.calls[1]?.[1]?.body).toEqual(original);
  });

  it('discovers saved authorization after reload without permitting a new generation', async () => {
    mocks.get.mockResolvedValue(
      ok(
        preview({
          canRegenerate: false,
          activeAuthorization: status({ state: 'RUNNING', canResume: false }),
        }),
      ),
    );
    await open();
    expect(await screen.findByText(/saved request is in progress/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Approve and generate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume saved request' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check saved request' })).toBeVisible();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('can resume a saved response after approval expiry when the server explicitly permits it', async () => {
    mocks.get.mockResolvedValue(
      ok(
        preview({
          canRegenerate: false,
          activeAuthorization: status({ state: 'EXPIRED', canResume: true }),
        }),
      ),
    );
    const user = await open();
    expect(await screen.findByText(/approval expired/)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Resume saved request' }));
    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledOnce();
    });
    expect(mocks.post.mock.calls[0]?.[0]).toBe('/v1/observation-regenerations/{id}/resume');
  });

  it('retains the frozen intent across panel close/reopen after a network failure', async () => {
    mocks.post.mockRejectedValueOnce(new Error('Disconnected'));
    const user = await approve();
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'New analysis' }));
    await user.click(screen.getByRole('button', { name: 'New analysis' }));
    expect(screen.queryByRole('button', { name: 'Approve and generate' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check saved request' })).toBeVisible();
    expect(mocks.post).toHaveBeenCalledOnce();
  });

  it('requires an explicit fresh preview and new approval after a proven-unsent failure', async () => {
    const old = status({ state: 'PROVEN_UNSENT_FAILED', canResume: false });
    mocks.get.mockResolvedValue(ok(preview({ activeAuthorization: old })));
    const user = await open();
    expect(await screen.findByText(/ended before a model request was sent/)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Approve and generate' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review another request' }));
    const reason = await screen.findByRole('textbox', { name: /Reason for new analysis/ });
    expect(reason).toHaveValue('');
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.post).not.toHaveBeenCalled();
    await user.type(reason, 'Approve a new attempt after the earlier unsent request.');
    await user.click(screen.getByRole('button', { name: 'Approve and generate' }));
    await waitFor(() => {
      expect(mocks.post).toHaveBeenCalledOnce();
    });
    expect(mocks.post.mock.calls[0]?.[0]).toBe('/v1/observations/{id}/regenerate');
  });

  it.each(['RUNNING', 'REVIEW_REQUIRED', 'UNAVAILABLE'] as const)(
    'never resets %s work even if a preview advertises new generation availability',
    async (state) => {
      mocks.get.mockResolvedValue(
        ok(preview({ activeAuthorization: status({ state, canResume: false }) })),
      );
      await open();
      await screen.findByRole('button', { name: 'Check saved request' });
      expect(
        screen.queryByRole('button', { name: 'Review another request' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Approve and generate' }),
      ).not.toBeInTheDocument();
      expect(mocks.post).not.toHaveBeenCalled();
    },
  );

  it('does not discard a saved intent when another request becomes active during a refresh', async () => {
    mocks.get.mockResolvedValueOnce(
      ok(preview({ activeAuthorization: status({ state: 'FAILED', canResume: false }) })),
    );
    mocks.get.mockResolvedValue(
      ok(
        preview({
          canRegenerate: false,
          activeAuthorization: status({ state: 'RUNNING', canResume: false }),
        }),
      ),
    );
    const user = await open();
    await user.click(await screen.findByRole('button', { name: 'Review another request' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A new approval is not available');
    expect(screen.queryByRole('button', { name: 'Approve and generate' })).not.toBeInTheDocument();
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it('shows a fixed error for failed preview fetch without automatically retrying', async () => {
    mocks.get.mockRejectedValue(new Error('PRIVATE_NETWORK_DETAILS'));
    await open();
    expect(await screen.findByRole('alert')).toHaveTextContent('preview could not be loaded');
    expect(screen.queryByText(/PRIVATE_NETWORK/)).not.toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledOnce();
    expect(mocks.post).not.toHaveBeenCalled();
  });
});
