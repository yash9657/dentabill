import { transferableAbortController } from 'node:util';

import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  NotificationDetail,
  NotificationList,
} from '../../../../lib/operations/use-notifications.js';

import { OperationsPage } from './operations-page.js';
import {
  notificationDetailFixture,
  notificationFixture,
  notificationInstant,
  notificationListFixture,
} from './review-notifications.fixtures.js';

const auth = vi.hoisted((): { userId: string | null; orgId: string | null; isLoaded: boolean } => ({
  userId: 'user_a',
  orgId: 'org_a',
  isLoaded: true,
}));
const fetchMock = vi.hoisted(() => vi.fn<typeof fetch>());
const headersMock = vi.hoisted(() => vi.fn<() => Promise<Record<string, string>>>());
vi.mock('@clerk/nextjs', () => ({ useAuth: () => auth }));
vi.mock('../../../../lib/api-client.js', async () => {
  const { createApiClient } = await import('@dentabill/api-sdk');
  const client = createApiClient({ baseUrl: 'http://synthetic.invalid', fetch: fetchMock });
  return { useDentaBillApi: () => ({ client, withAuthHeaders: headersMock }) };
});

interface RecordedRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  authorization: string | null;
}
let requests: RecordedRequest[];
let role: 'OWNER' | 'ADMIN' | 'BILLING_STAFF';
let list: NotificationList;
let detail: NotificationDetail;
let handler: ((request: RecordedRequest) => Promise<Response | undefined>) | undefined;
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function notifyRequests() {
  return requests.filter((request) => request.path.includes('/notifications'));
}
function renderView() {
  const client = createDentaBillQueryClient();
  const view = () => (
    <QueryProvider client={client}>
      <OperationsPage />
    </QueryProvider>
  );
  const result = render(view());
  return {
    client,
    user: userEvent.setup(),
    rerender: () => {
      result.rerender(view());
    },
  };
}
async function inspect(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole('button', { name: 'Inspect notification notification_synthetic_a' }),
  );
  return screen.findByRole('region', { name: 'Notification history' });
}

beforeEach(() => {
  vi.stubGlobal('AbortController', function NativeAbortController() {
    return transferableAbortController();
  });
  auth.userId = 'user_a';
  auth.orgId = 'org_a';
  auth.isLoaded = true;
  role = 'OWNER';
  requests = [];
  list = notificationListFixture();
  detail = notificationDetailFixture();
  handler = undefined;
  headersMock.mockReset().mockImplementation(async () => ({
    authorization: `Bearer ${auth.userId ?? 'anonymous'}:${auth.orgId ?? 'personal'}`,
  }));
  fetchMock.mockReset().mockImplementation(async (input, init) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const record = {
      method: req.method,
      path: url.pathname,
      query: url.searchParams,
      authorization: req.headers.get('authorization'),
    };
    requests.push(record);
    const override = await handler?.(record);
    if (override) return override;
    if (record.path === '/v1/me')
      return json({
        user: {
          id: 'internal_user_a',
          email: 'synthetic@example.invalid',
          name: 'Synthetic',
          role,
        },
        organization: {
          id: 'internal_org_a',
          name: 'Synthetic practice',
          npi: null,
          plan: 'TRIAL',
        },
      });
    if (record.path === '/v1/operations/notifications') return json(list);
    if (record.path.startsWith('/v1/operations/notifications/')) return json(detail);
    if (record.path === '/v1/operations')
      return json({
        sampledAt: notificationInstant,
        thresholds: { deliveryAgeSeconds: 300, observationAgeSeconds: 120 },
        counts: {
          pending: 0,
          agedPending: 0,
          quarantined: 0,
          acceptedOverdue: 0,
          observationReview: 0,
          uncertainCalls: 0,
          legacyReadyWithoutDelivery: 0,
        },
        oldestPendingAt: null,
        oldestQuarantinedAt: null,
      });
    if (record.path === '/v1/operations/outbox' || record.path === '/v1/operations/calls')
      return json({ items: [], hasMore: false, nextCursor: null });
    throw new Error('Unexpected synthetic request');
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Review notification Operations integration through the SDK transport', () => {
  it.each(['OWNER', 'ADMIN'] as const)(
    'lets %s read stored alerts without exposing sending controls',
    async (selectedRole) => {
      role = selectedRole;
      renderView();
      const section = await screen.findByRole('region', { name: 'Review notifications' });
      await within(section).findByRole('button', { name: /Inspect notification/ });
      expect(
        within(section).getByText(
          'Review alerts are stored here. External email delivery is unavailable.',
        ),
      ).toBeInTheDocument();
      expect(within(section).getByText(/neither confirms email delivery/)).toBeInTheDocument();
      expect(
        within(section).queryByRole('button', { name: /send|retry|rebind/i }),
      ).not.toBeInTheDocument();
      expect(notifyRequests()[0]).toMatchObject({
        method: 'GET',
        authorization: 'Bearer user_a:org_a',
      });
      expect(notifyRequests()[0]?.query.get('state')).toBe('ALL');
      expect(notifyRequests()[0]?.query.get('limit')).toBe('20');
      expect(requests.every((r) => r.method === 'GET')).toBe(true);
    },
  );
  it('does not request notifications for billing staff', async () => {
    role = 'BILLING_STAFF';
    renderView();
    await screen.findByText('Operations is available to practice owners and admins.');
    expect(requests.map((r) => r.path)).toEqual(['/v1/me']);
  });
  it('closes the role gate when profile access fails and hides server error text', async () => {
    handler = async (r) =>
      r.path === '/v1/me' ? json({ message: 'secret@example.invalid' }, 403) : undefined;
    renderView();
    await screen.findByText('Couldn’t confirm your access. Refresh the page to try again.');
    expect(notifyRequests()).toHaveLength(0);
    expect(screen.queryByText(/secret@example/)).not.toBeInTheDocument();
  });
  it('keeps pending auth and signed-out sessions out of the API', async () => {
    auth.isLoaded = false;
    const view = renderView();
    expect(screen.getByRole('status', { name: 'Loading operations access' })).toBeInTheDocument();
    auth.isLoaded = true;
    auth.userId = null;
    view.rerender();
    expect(screen.getByText('Sign in to view operations.')).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });
  it('shows exact scoped claim/call links and safe source metadata', async () => {
    renderView();
    await screen.findByRole('button', { name: /Inspect notification/ });
    expect(screen.getByRole('link', { name: 'Open linked claim' })).toHaveAttribute(
      'href',
      '/dashboard/claims/claim_synthetic_a',
    );
    expect(screen.getByRole('link', { name: 'Open linked call' })).toHaveAttribute(
      'href',
      '/dashboard/calls/call_synthetic_a',
    );
    expect(screen.getByText(/Age 1 hr · 1 attempt · Generation 2/)).toBeInTheDocument();
    expect(screen.getByText('Template: review-available.v1')).toBeInTheDocument();
  });
  it('does not infer links when scoped IDs are unavailable', async () => {
    handler = async (r) =>
      r.path === '/v1/operations/notifications'
        ? json({
            ...list,
            items: [
              {
                ...notificationFixture({ recipientBinding: 'MISSING' }),
                claimId: null,
                callId: null,
              },
            ],
          })
        : undefined;
    renderView();
    await screen.findByText('No scoped claim or call link available.');
    expect(screen.queryByRole('link', { name: /Open linked/ })).not.toBeInTheDocument();
    expect(screen.getByText('Simulated · Recipient missing')).toBeInTheDocument();
  });
  it('treats ambiguous quarantined work and changed recipients as read-only', async () => {
    list = notificationListFixture([
      notificationFixture({
        state: 'QUARANTINED',
        ambiguous: true,
        recipientBinding: 'CHANGED',
        attemptCount: 5,
      }),
    ]);
    renderView();
    await screen.findByText('Submission outcome is uncertain. Do not assume delivery.');
    expect(screen.getByText('Quarantined · Recipient changed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry|send|rebind/i })).not.toBeInTheDocument();
  });
  it('filters without leaking selected history or cursor from the prior state', async () => {
    const { user } = renderView();
    await inspect(user);
    await user.selectOptions(screen.getByLabelText('Notification status'), 'BLOCKED');
    await waitFor(() => {
      expect(notifyRequests().at(-1)?.query.get('state')).toBe('BLOCKED');
    });
    expect(notifyRequests().at(-1)?.query.get('cursor')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Notification history' })).not.toBeInTheDocument();
  });
  it('pages with the exact cursor and preserves loaded rows after a page failure', async () => {
    list = notificationListFixture(undefined, { hasMore: true, nextCursor: 'synthetic_cursor' });
    handler = async (r) =>
      r.query.get('cursor') ? json({ message: 'payload forbidden' }, 500) : undefined;
    const { user } = renderView();
    await user.click(await screen.findByRole('button', { name: 'Load more notifications' }));
    await screen.findByText('Review notifications could not be loaded. Refresh work to try again.');
    expect(screen.getByRole('button', { name: /Inspect notification/ })).toBeInTheDocument();
    expect(notifyRequests().at(-1)?.query.get('cursor')).toBe('synthetic_cursor');
    expect(screen.queryByText('payload forbidden')).not.toBeInTheDocument();
  });
  it('appends the next page and uses server page ages', async () => {
    list = notificationListFixture(undefined, { hasMore: true, nextCursor: 'cursor_two' });
    handler = async (r) =>
      r.query.get('cursor')
        ? json(
            notificationListFixture([
              notificationFixture({
                id: 'notification_synthetic_b',
                ageSeconds: 190000,
                generation: 3,
              }),
            ]),
          )
        : undefined;
    const { user } = renderView();
    await user.click(await screen.findByRole('button', { name: 'Load more notifications' }));
    await screen.findByRole('button', { name: 'Inspect notification notification_synthetic_b' });
    expect(screen.getByText(/Age 2 days/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Inspect notification/ })).toHaveLength(2);
  });
  it('makes an empty state explicit without claiming successful delivery', async () => {
    list = notificationListFixture([]);
    renderView();
    await screen.findByText(
      'No stored review notifications match this status. This does not confirm email delivery.',
    );
  });
  it('never renders unknown diagnostic strings or raw extra payload fields', async () => {
    handler = async (r) =>
      r.path === '/v1/operations/notifications'
        ? json({
            ...list,
            items: [
              {
                ...notificationFixture(),
                reason: 'secret@example.invalid',
                recipient: 'private@example.invalid',
                payload: { secret: 'private payload' },
              },
            ],
          })
        : undefined;
    renderView();
    await screen.findByText('Reason: UNKNOWN');
    expect(
      screen.queryByText(/secret@example|private@example|private payload/),
    ).not.toBeInTheDocument();
  });
  it('retains closed reason codes and does not treat retryable receipts as permission to send', async () => {
    list = notificationListFixture([
      notificationFixture({ reason: 'ATTEMPTS_EXHAUSTED', state: 'QUARANTINED' }),
    ]);
    detail.attempts[0]!.receipt = {
      outcome: 'RETRYABLE',
      code: 'TRANSPORT_RETRYABLE',
      completedAt: notificationInstant,
      acceptedAt: null,
    };
    const { user } = renderView();
    await screen.findByText('Reason: ATTEMPTS_EXHAUSTED');
    const region = await inspect(user);
    await within(region).findByText('RETRYABLE · TRANSPORT_RETRYABLE');
    expect(within(region).queryByRole('button', { name: /retry|send/i })).not.toBeInTheDocument();
  });
  it('closes transport exceptions without displaying diagnostic payloads', async () => {
    handler = async (r) => {
      if (r.path === '/v1/operations/notifications')
        throw new Error('private@example.invalid transport payload');
      return undefined;
    };
    renderView();
    await screen.findByText('Review notifications could not be loaded. Refresh work to try again.');
    expect(screen.queryByText(/private@example/)).not.toBeInTheDocument();
  });
  it('restores focus to the inspect action after history is closed', async () => {
    const { user } = renderView();
    const region = await inspect(user);
    expect(within(region).getByRole('heading', { name: 'Notification history' })).toHaveFocus();
    await user.click(within(region).getByRole('button', { name: 'Close history' }));
    expect(screen.getByRole('button', { name: /Inspect notification/ })).toHaveFocus();
    expect(screen.queryByRole('region', { name: 'Notification history' })).not.toBeInTheDocument();
  });
  it('inspects bounded attempt receipts and distinguishes simulated from provider acceptance', async () => {
    const base = detail.attempts[0]!;
    detail = notificationDetailFixture(
      notificationFixture({ state: 'ACCEPTED', attemptCount: 3 }),
      {
        attempts: [
          base,
          {
            ...base,
            id: 'attempt_b',
            attemptNumber: 2,
            receipt: {
              outcome: 'ACCEPTED',
              code: null,
              completedAt: notificationInstant,
              acceptedAt: notificationInstant,
            },
          },
          { ...base, id: 'attempt_c', attemptNumber: 3, receipt: null },
        ],
      },
    );
    const { user } = renderView();
    const region = await inspect(user);
    await within(region).findByText('Attempt 3 · Synthetic');
    expect(within(region).getByText('SIMULATED · None recorded')).toBeInTheDocument();
    expect(within(region).getByText('Provider accepted · None recorded')).toBeInTheDocument();
    expect(within(region).getByText('No outcome receipt recorded.')).toBeInTheDocument();
    expect(within(region).getByText('inference_synthetic_a')).toBeInTheDocument();
    expect(within(region).getByText('observation_synthetic_a')).toBeInTheDocument();
    expect(notifyRequests().at(-1)?.path).toBe(
      '/v1/operations/notifications/notification_synthetic_a',
    );
    expect(requests.every((r) => r.method === 'GET')).toBe(true);
  });
  it('does not render raw detail errors and allows a fresh read through Refresh work', async () => {
    let fail = true;
    handler = async (r) =>
      r.path.endsWith('/notification_synthetic_a') && fail
        ? json({ message: 'secret@example.invalid' }, 404)
        : undefined;
    const { user } = renderView();
    const region = await inspect(user);
    await within(region).findByText(
      'Notification history could not be loaded. Refresh work to try again.',
    );
    expect(screen.queryByText(/secret@example/)).not.toBeInTheDocument();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Refresh work' }));
    await within(region).findByText('Attempt 1 · Synthetic');
  });
  it.each([
    { userId: 'user_b', orgId: 'org_a' },
    { userId: 'user_a', orgId: null },
  ])('isolates access and notification reads after auth scope changes to %j', async (newAuth) => {
    const { user, rerender } = renderView();
    await inspect(user);
    await screen.findByText('Attempt 1 · Synthetic');
    const pending = deferred<Response>();
    handler = async (r) => (r.path === '/v1/me' ? pending.promise : undefined);
    Object.assign(auth, newAuth);
    rerender();
    expect(screen.queryByRole('region', { name: 'Review notifications' })).not.toBeInTheDocument();
    const before = notifyRequests().length;
    await act(async () => {
      pending.resolve(
        json({
          user: { id: 'internal_user_b', role: 'BILLING_STAFF' },
          organization: { id: 'internal_org_a' },
        }),
      );
    });
    await screen.findByText('Operations is available to practice owners and admins.');
    expect(notifyRequests()).toHaveLength(before);
  });
  it('does not dispatch an old detail read after auth headers resolve in another scope', async () => {
    const { user, rerender } = renderView();
    await screen.findByRole('button', { name: /Inspect notification/ });
    const headers = deferred<Record<string, string>>();
    headersMock.mockImplementationOnce(() => headers.promise);
    await inspect(user);
    auth.userId = 'user_b';
    role = 'BILLING_STAFF';
    rerender();
    await act(async () => {
      headers.resolve({ authorization: 'Bearer user_a:org_a' });
    });
    await screen.findByText('Operations is available to practice owners and admins.');
    expect(
      notifyRequests().filter((r) => r.path.endsWith('/notification_synthetic_a')),
    ).toHaveLength(0);
  });
  it('does not surface an old detail response after sign-out', async () => {
    const pending = deferred<Response>();
    handler = async (r) =>
      r.path.endsWith('/notification_synthetic_a') ? pending.promise : undefined;
    const { user, rerender } = renderView();
    await inspect(user);
    await waitFor(() => {
      expect(notifyRequests().some((r) => r.path.endsWith('/notification_synthetic_a'))).toBe(true);
    });
    auth.userId = null;
    rerender();
    await act(async () => {
      pending.resolve(json(detail));
    });
    expect(screen.queryByText('Attempt 1 · Synthetic')).not.toBeInTheDocument();
    expect(screen.getByText('Sign in to view operations.')).toBeInTheDocument();
  });
});
