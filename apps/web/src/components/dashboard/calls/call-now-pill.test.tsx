import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClaimStatus } from '../../../lib/claims/types.js';

import { CallNowPill } from './call-now-pill.js';

const postMock = vi.fn();

vi.mock('../../../lib/api-client.js', () => ({
  useDentaBillApi: () => ({
    client: { POST: postMock, GET: vi.fn(), PATCH: vi.fn() },
    withAuthHeaders: async () => ({}),
  }),
}));

beforeEach(() => {
  postMock.mockReset();
});

function renderPill(props: {
  claimId?: string;
  claimStatus: ClaimStatus;
  variant?: 'detail' | 'compact';
}): { user: ReturnType<typeof userEvent.setup> } {
  const user = userEvent.setup();
  const client = createDentaBillQueryClient();
  render(
    <QueryProvider client={client}>
      <CallNowPill
        claimId={props.claimId ?? 'claim_a'}
        claimStatus={props.claimStatus}
        {...(props.variant ? { variant: props.variant } : {})}
      />
    </QueryProvider>,
  );
  return { user };
}

describe('CallNowPill (P3-T22)', () => {
  it('renders nothing when the claim status is not queue-eligible', () => {
    const { container } = render(
      <QueryProvider client={createDentaBillQueryClient()}>
        <CallNowPill claimId="claim_a" claimStatus="COMPLETED" />
      </QueryProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the Pill for PENDING claims with an explicit aria-label', () => {
    renderPill({ claimStatus: 'PENDING' });
    const button = screen.getByRole('button', { name: /Call now for claim claim_a/ });
    expect(button).toBeEnabled();
  });

  it('renders the Pill for NEEDS_INFO and FAILED (operator can retry)', () => {
    const { unmount } = render(
      <QueryProvider client={createDentaBillQueryClient()}>
        <CallNowPill claimId="claim_a" claimStatus="NEEDS_INFO" />
      </QueryProvider>,
    );
    expect(screen.getByRole('button', { name: /Call now for claim/ })).toBeEnabled();
    unmount();

    render(
      <QueryProvider client={createDentaBillQueryClient()}>
        <CallNowPill claimId="claim_a" claimStatus="FAILED" />
      </QueryProvider>,
    );
    expect(screen.getByRole('button', { name: /Call now for claim/ })).toBeEnabled();
  });

  it('hides for IN_QUEUE / CALLING (call is already in flight)', () => {
    const { container, rerender } = render(
      <QueryProvider client={createDentaBillQueryClient()}>
        <CallNowPill claimId="claim_a" claimStatus="IN_QUEUE" />
      </QueryProvider>,
    );
    expect(container).toBeEmptyDOMElement();

    rerender(
      <QueryProvider client={createDentaBillQueryClient()}>
        <CallNowPill claimId="claim_a" claimStatus="CALLING" />
      </QueryProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('on click, POSTs to /v1/claims/:id/calls and shows a success message', async () => {
    postMock.mockResolvedValueOnce({
      data: { callSessionId: 'call_abc', queuedAt: '2026-04-29T10:00:00.000Z' },
    });
    const { user } = renderPill({ claimStatus: 'PENDING' });
    await user.click(screen.getByRole('button', { name: /Call now for claim/ }));
    await waitFor(() => {
      expect(postMock).toHaveBeenCalledWith('/v1/claims/{id}/calls', {
        params: { path: { id: 'claim_a' } },
        headers: {},
        body: {},
      });
    });
    expect(await screen.findByTestId('call-now-pill-success')).toHaveTextContent(
      /Queued. The call will start shortly\./,
    );
  });

  it('disables the button while pending and re-enables after the response', async () => {
    let resolve: ((value: unknown) => void) | undefined;
    postMock.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const { user } = renderPill({ claimStatus: 'PENDING' });
    const button = screen.getByRole('button', { name: /Call now for claim/ });
    await user.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    resolve?.({ data: { callSessionId: 'call_abc', queuedAt: '2026-04-29T10:00:00.000Z' } });
    await waitFor(() => expect(button).toBeEnabled());
  });

  it('surfaces PAYER_HOURS_CLOSED with the server message verbatim', async () => {
    postMock.mockResolvedValueOnce({
      error: {
        code: 'PAYER_HOURS_CLOSED',
        message:
          'DELTA_DENTAL_PPO provider line is closed (after_hours). Next opening: 2026-04-30T13:00:00.000Z.',
      },
    });
    const { user } = renderPill({ claimStatus: 'PENDING' });
    await user.click(screen.getByRole('button', { name: /Call now for claim/ }));
    const error = await screen.findByTestId('call-now-pill-error');
    expect(error).toHaveTextContent(/provider line is closed \(after_hours\)/);
    // Pill stays enabled — the user may simply be reading the message.
    expect(screen.getByRole('button', { name: /Call now for claim/ })).toBeEnabled();
  });

  it('falls back to a generic message when the server omits one', async () => {
    postMock.mockResolvedValueOnce({
      error: { code: 'INVALID_STATE_TRANSITION' },
    });
    const { user } = renderPill({ claimStatus: 'PENDING' });
    await user.click(screen.getByRole('button', { name: /Call now for claim/ }));
    const error = await screen.findByTestId('call-now-pill-error');
    expect(error).toHaveTextContent(/cannot be queued from its current status/);
  });

  it('renders the compact variant for table rows with smaller paddings', () => {
    renderPill({ claimStatus: 'PENDING', variant: 'compact' });
    const button = screen.getByRole('button', { name: /Call now for claim/ });
    // The Pill primitive applies size="sm" → h-8 (vs h-10 default). We don't
    // assert on Tailwind class strings — that couples the test to the
    // primitive's internals — but we confirm the icon got the smaller variant.
    const icon = button.querySelector('svg');
    expect(icon).toBeTruthy();
    expect(icon?.getAttribute('class') ?? '').toMatch(/h-3\.5/);
  });
});
