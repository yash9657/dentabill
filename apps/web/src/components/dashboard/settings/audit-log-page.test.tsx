import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditLogsListResponse } from '../../../lib/audit/types.js';

import { AuditLogPage } from './audit-log-page.js';

const getMock = vi.fn();
const auth = vi.hoisted((): { orgId: string | null; userId: string | null; isLoaded: boolean } => ({
  orgId: 'org-a',
  userId: 'user-a',
  isLoaded: true,
}));
vi.mock('@clerk/nextjs', () => ({ useAuth: () => auth }));

vi.mock('../../../lib/api-client.js', () => ({
  useDentaBillApi: () => ({
    client: { GET: getMock },
    withAuthHeaders: async () => ({}),
  }),
}));

// Mock @tanstack/react-virtual to simplify testing
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number }) => {
    return {
      getVirtualItems: () =>
        Array.from({ length: opts.count }, (_, i) => ({
          index: i,
          start: i * 60,
        })),
      getTotalSize: () => opts.count * 60,
    };
  },
}));

function renderPage() {
  const client = createDentaBillQueryClient();
  const ui = () => (
    <QueryProvider client={client}>
      <AuditLogPage />
    </QueryProvider>
  );
  const view = render(ui());
  return {
    client,
    refresh: () => {
      view.rerender(ui());
    },
  };
}

describe('AuditLogPage (G-D2b)', () => {
  beforeEach(() => {
    Object.assign(auth, { orgId: 'org-a', userId: 'user-a', isLoaded: true });
    getMock.mockReset();
  });

  const privatePage: AuditLogsListResponse = {
    items: [
      {
        id: 'synthetic-audit',
        action: 'reconciliation.match',
        resourceType: 'CashBatchMatch',
        resourceId: 'synthetic-match',
        userId: 'synthetic-recorded-user-long-id',
        metadata: { reason: 'SYNTHETIC_PRIVATE_AUDIT' },
        createdAt: '2026-10-14T12:00:00.000Z',
      },
    ],
    nextCursor: null,
    hasMore: false,
  };

  it.each(['organization', 'user', 'signout', 'no practice', 'loading'] as const)(
    'immediately removes rows and an open drawer on %s change',
    async (change) => {
      getMock.mockResolvedValue({ data: privatePage });
      const view = renderPage();
      await userEvent.setup().click(await screen.findByRole('button', { name: 'Show' }));
      expect(screen.getByText('synthetic-recorded-user-long-id')).toBeVisible();
      expect(screen.getByText(/SYNTHETIC_PRIVATE_AUDIT/)).toBeVisible();
      let finish!: (value: { data: AuditLogsListResponse }) => void;
      getMock.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      let pending!: Promise<void>;
      act(() => {
        pending = view.client.refetchQueries({ queryKey: ['auditLogs'] });
      });
      await waitFor(() => {
        expect(getMock).toHaveBeenCalledTimes(2);
      });
      getMock.mockImplementation(() => new Promise(() => undefined));
      if (change === 'organization') auth.orgId = 'org-b';
      else if (change === 'user') auth.userId = 'user-b';
      else if (change === 'signout') auth.userId = null;
      else if (change === 'no practice') auth.orgId = null;
      else auth.isLoaded = false;
      view.refresh();
      expect(screen.queryByText(/SYNTHETIC_PRIVATE_AUDIT/)).not.toBeInTheDocument();
      expect(screen.queryByText('synthetic-recorded-user-long-id')).not.toBeInTheDocument();
      expect(screen.queryByText('Audit Details')).not.toBeInTheDocument();
      await act(async () => {
        finish({ data: privatePage });
        await pending;
      });
      expect(screen.queryByText(/SYNTHETIC_PRIVATE_AUDIT/)).not.toBeInTheDocument();
      expect(screen.queryByText('reconciliation.match')).not.toBeInTheDocument();
      if (change === 'signout') expect(screen.getByRole('status')).toHaveTextContent('Sign in');
      if (change === 'no practice')
        expect(screen.getByRole('status')).toHaveTextContent('Choose a practice');
    },
  );

  it('renders the filter section and table when loading', async () => {
    getMock.mockImplementation(() => {
      return new Promise(() => {
        // Never resolve — keeps it in loading state
      });
    });

    renderPage();

    expect(screen.getByText('Filters')).toBeInTheDocument();
    expect(screen.getByLabelText('Resource Type')).toBeInTheDocument();
    expect(screen.getByLabelText('From Date')).toBeInTheDocument();
    expect(screen.getByLabelText('To Date')).toBeInTheDocument();
  });

  it('renders the empty state when no audit logs exist', async () => {
    getMock.mockResolvedValue({
      data: {
        items: [],
        nextCursor: null,
        hasMore: false,
      },
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No audit logs match these filters')).toBeInTheDocument();
    });
  });

  it('renders the grid when data is returned', async () => {
    getMock.mockResolvedValue({
      data: {
        items: [
          {
            id: 'audit_1',
            action: 'claim.read',
            resourceType: 'Claim',
            resourceId: 'claim_abc123xyz',
            userId: 'user_1',
            metadata: {},
            createdAt: '2026-08-15T10:30:00.000Z',
          },
        ],
        nextCursor: null,
        hasMore: false,
      },
    });

    renderPage();

    // The grid should be rendered when data arrives
    await waitFor(() => {
      expect(screen.getByRole('grid', { name: 'Audit logs' })).toBeInTheDocument();
    });
  });

  it('renders the filter section with all controls', async () => {
    getMock.mockResolvedValue({
      data: { items: [], nextCursor: null, hasMore: false },
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Filters')).toBeInTheDocument();
    });

    expect(screen.getByLabelText('Resource Type')).toBeInTheDocument();
    expect(screen.getByLabelText('From Date')).toBeInTheDocument();
    expect(screen.getByLabelText('To Date')).toBeInTheDocument();
  });

  it('renders all filter controls with proper labels', async () => {
    getMock.mockResolvedValue({
      data: { items: [], nextCursor: null, hasMore: false },
    });

    renderPage();

    const resourceTypeSelect = screen.getByLabelText('Resource Type');
    expect(resourceTypeSelect).toBeInTheDocument();
    if (resourceTypeSelect instanceof HTMLSelectElement) {
      expect(resourceTypeSelect.options.length).toBeGreaterThan(1);
    }
  });

  it('renders Show button for each row to expand metadata', async () => {
    getMock.mockResolvedValue({
      data: {
        items: [
          {
            id: 'audit_1',
            action: 'AUTO_TRANSITION',
            resourceType: 'Claim',
            resourceId: 'claim_xyz',
            userId: 'user_1',
            metadata: {
              summaryId: 'sum_123',
              confidence: 0.95,
              promptVersion: 'v2.1',
            },
            createdAt: '2026-08-15T10:30:00.000Z',
          },
        ],
        nextCursor: null,
        hasMore: false,
      },
    });

    renderPage();

    await waitFor(() => {
      const showButton = screen.getByRole('button', { name: 'Show' });
      expect(showButton).toBeInTheDocument();
    });
  });

  it('shows Clear filters button when filters are active', async () => {
    getMock.mockResolvedValue({
      data: { items: [], nextCursor: null, hasMore: false },
    });

    renderPage();

    const resourceTypeSelect = screen.getByLabelText('Resource Type');
    if (resourceTypeSelect instanceof HTMLSelectElement) {
      await userEvent.selectOptions(resourceTypeSelect, 'Claim');

      await waitFor(() => {
        expect(screen.getByText('Clear filters')).toBeInTheDocument();
      });
    }
  });

  it('resets filters when Clear filters button is clicked', async () => {
    getMock.mockResolvedValue({
      data: { items: [], nextCursor: null, hasMore: false },
    });

    renderPage();

    const resourceTypeSelect = screen.getByLabelText('Resource Type');
    if (resourceTypeSelect instanceof HTMLSelectElement) {
      await userEvent.selectOptions(resourceTypeSelect, 'Claim');

      await waitFor(() => {
        expect(screen.getByText('Clear filters')).toBeInTheDocument();
      });

      const clearButton = screen.getByText('Clear filters');
      await userEvent.click(clearButton);

      expect(resourceTypeSelect.value).toBe('');
    }
  });
});
