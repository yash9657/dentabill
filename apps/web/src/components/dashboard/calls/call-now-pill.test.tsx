import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ClaimStatus, PayerCode } from '../../../lib/claims/types.js';

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
  payerCode?: PayerCode;
}): { user: ReturnType<typeof userEvent.setup> } {
  const user = userEvent.setup();
  const client = createDentaBillQueryClient();
  render(
    <QueryProvider client={client}>
      <CallNowPill
        claimId={props.claimId ?? 'claim_a'}
        claimStatus={props.claimStatus}
        {...(props.variant ? { variant: props.variant } : {})}
        {...(props.payerCode ? { payerCode: props.payerCode } : {})}
      />
    </QueryProvider>,
  );
  return { user };
}

describe('CallNowPill (P3-T22)', () => {
  it('renders a quiet "Completed" badge (no button) when the claim is past its lifecycle', () => {
    render(
      <QueryProvider client={createDentaBillQueryClient()}>
        <CallNowPill claimId="claim_a" claimStatus="COMPLETED" />
      </QueryProvider>,
    );
    expect(screen.getByTestId('call-now-pill-no-action')).toHaveTextContent(/Completed/);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders the Pill for PENDING claims with an explicit aria-label', () => {
    renderPill({ claimStatus: 'PENDING' });
    const button = screen.getByRole('button', { name: /Call now for claim claim_a/ });
    expect(button).toBeEnabled();
  });

  it('renders the Pill for NEEDS_INFO (operator can retry after gathering info)', () => {
    render(
      <QueryProvider client={createDentaBillQueryClient()}>
        <CallNowPill claimId="claim_a" claimStatus="NEEDS_INFO" />
      </QueryProvider>,
    );
    expect(screen.getByRole('button', { name: /Call now for claim/ })).toBeEnabled();
  });

  it('renders the Pill for APPEALING and MANUAL_REVIEW with a "Retry call" label', () => {
    const { unmount } = render(
      <QueryProvider client={createDentaBillQueryClient()}>
        <CallNowPill claimId="claim_a" claimStatus="MANUAL_REVIEW" />
      </QueryProvider>,
    );
    const manualReviewBtn = screen.getByRole('button', { name: /Call now for claim/ });
    expect(manualReviewBtn).toBeEnabled();
    expect(manualReviewBtn).toHaveTextContent(/Retry call/);
    unmount();

    render(
      <QueryProvider client={createDentaBillQueryClient()}>
        <CallNowPill claimId="claim_a" claimStatus="APPEALING" />
      </QueryProvider>,
    );
    expect(screen.getByRole('button', { name: /Call now for claim/ })).toHaveTextContent(
      /Retry call/,
    );
  });

  it.each(['MANUAL_REVIEW', 'APPEALING'] as const)(
    'links %s table rows to review without dialing',
    async (claimStatus) => {
      renderPill({ claimStatus, variant: 'compact' });
      const link = screen.getByRole('link', { name: 'Review call for claim claim_a' });
      expect(link).toHaveAttribute('href', '/dashboard/claims/claim_a');
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
      expect(postMock).not.toHaveBeenCalled();
    },
  );

  it('renders a non-action "Failed" badge for FAILED — the API rejects FAILED → IN_QUEUE, manual status edit is the path back', () => {
    render(
      <QueryProvider client={createDentaBillQueryClient()}>
        <CallNowPill claimId="claim_a" claimStatus="FAILED" />
      </QueryProvider>,
    );
    const badge = screen.getByTestId('call-now-pill-no-action');
    expect(badge).toHaveTextContent(/Failed/);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders "Manual review only" badge for non-Phase-3 payers (e.g. UNKNOWN)', () => {
    render(
      <QueryProvider client={createDentaBillQueryClient()}>
        <CallNowPill claimId="claim_a" claimStatus="PENDING" payerCode="UNKNOWN" />
      </QueryProvider>,
    );
    const badge = screen.getByTestId('call-now-pill-manual-review');
    expect(badge).toHaveTextContent(/Manual review only/);
    // Non-interactive — must NOT render as a button or link.
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders the badge for AETNA / GUARDIAN / DELTA_DENTAL_PREMIER (not Phase-3 dialable)', () => {
    const { unmount } = render(
      <QueryProvider client={createDentaBillQueryClient()}>
        <CallNowPill claimId="claim_a" claimStatus="PENDING" payerCode="AETNA_DENTAL" />
      </QueryProvider>,
    );
    expect(screen.getByTestId('call-now-pill-manual-review')).toBeInTheDocument();
    unmount();

    render(
      <QueryProvider client={createDentaBillQueryClient()}>
        <CallNowPill claimId="claim_a" claimStatus="PENDING" payerCode="DELTA_DENTAL_PREMIER" />
      </QueryProvider>,
    );
    expect(screen.getByTestId('call-now-pill-manual-review')).toBeInTheDocument();
  });

  it('renders the call button for Phase-3 dialable payers (Delta PPO / Cigna / MetLife)', () => {
    const { unmount } = render(
      <QueryProvider client={createDentaBillQueryClient()}>
        <CallNowPill claimId="claim_a" claimStatus="PENDING" payerCode="DELTA_DENTAL_PPO" />
      </QueryProvider>,
    );
    expect(screen.getByRole('button', { name: /Call now for claim/ })).toBeEnabled();
    expect(screen.queryByTestId('call-now-pill-manual-review')).toBeNull();
    unmount();

    render(
      <QueryProvider client={createDentaBillQueryClient()}>
        <CallNowPill claimId="claim_a" claimStatus="PENDING" payerCode="METLIFE_DENTAL" />
      </QueryProvider>,
    );
    expect(screen.getByRole('button', { name: /Call now for claim/ })).toBeEnabled();
  });

  it('renders a live "Queued" / "Calling" badge for IN_QUEUE / CALLING (call is in flight)', () => {
    const { rerender } = render(
      <QueryProvider client={createDentaBillQueryClient()}>
        <CallNowPill claimId="claim_a" claimStatus="IN_QUEUE" />
      </QueryProvider>,
    );
    expect(screen.getByTestId('call-now-pill-no-action')).toHaveTextContent(/Queued/);
    expect(screen.queryByRole('button')).toBeNull();

    rerender(
      <QueryProvider client={createDentaBillQueryClient()}>
        <CallNowPill claimId="claim_a" claimStatus="CALLING" />
      </QueryProvider>,
    );
    expect(screen.getByTestId('call-now-pill-no-action')).toHaveTextContent(/Calling/);
  });

  it('renders a quiet status badge for terminal states (COMPLETED / RESOLVED / DENIED) — no empty cells', () => {
    const states = ['COMPLETED', 'RESOLVED', 'DENIED', 'WRITTEN_OFF'] as const;
    for (const status of states) {
      const { unmount } = render(
        <QueryProvider client={createDentaBillQueryClient()}>
          <CallNowPill claimId="claim_a" claimStatus={status} />
        </QueryProvider>,
      );
      expect(screen.getByTestId('call-now-pill-no-action')).toBeInTheDocument();
      expect(screen.queryByRole('button')).toBeNull();
      unmount();
    }
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
      /Call request accepted\./,
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

  it('compact: on MISSING_PROVIDER_NPI replaces the button with a deep link to settings', async () => {
    postMock.mockResolvedValueOnce({
      error: {
        code: 'MISSING_PROVIDER_NPI',
        message: 'Add your practice NPI in Settings before placing calls.',
      },
    });
    const { user } = renderPill({ claimStatus: 'PENDING', variant: 'compact' });
    await user.click(screen.getByRole('button', { name: /Call now for claim/ }));
    const link = await screen.findByRole('link', { name: /Add practice NPI/ });
    expect(link).toHaveAttribute('href', '/dashboard/settings/organization?focus=npi');
    // The original button is gone — replaced with the link.
    expect(screen.queryByRole('button', { name: /Call now for claim/ })).toBeNull();
  });

  it('detail: on MISSING_PROVIDER_NPI shows the message AND a deep link to settings', async () => {
    postMock.mockResolvedValueOnce({
      error: {
        code: 'MISSING_PROVIDER_NPI',
        message: 'Add your practice NPI in Settings before placing calls.',
      },
    });
    const { user } = renderPill({ claimStatus: 'PENDING' });
    await user.click(screen.getByRole('button', { name: /Call now for claim/ }));
    const error = await screen.findByTestId('call-now-pill-error');
    expect(error).toHaveTextContent(/Add your practice NPI/);
    const link = screen.getByRole('link', { name: /Add NPI in settings/ });
    expect(link).toHaveAttribute('href', '/dashboard/settings/organization?focus=npi');
  });

  it('does not render Phase-related text when showing supported payers', () => {
    renderPill({ claimStatus: 'PENDING', payerCode: 'DELTA_DENTAL_PPO' });
    expect(screen.queryByText(/Phase [0-9]/i)).not.toBeInTheDocument();
  });

  it('does not render Phase-related text in the manual review tooltip for unsupported payers', () => {
    renderPill({ claimStatus: 'PENDING', payerCode: 'UNKNOWN' });
    const badge = screen.getByTestId('call-now-pill-manual-review');
    // The badge exists with a title attribute instead of showing Phase text
    expect(badge).toHaveAttribute('title');
    expect(badge.getAttribute('title')).toMatch(/DentaBill currently dials/);
  });
});
