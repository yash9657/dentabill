import { QueryProvider, createDentaBillQueryClient } from '@dentabill/ui/query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuditLogPage } from './audit-log-page.js';

const getMock = vi.fn();

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

function renderPage(): void {
  render(
    <QueryProvider client={createDentaBillQueryClient()}>
      <AuditLogPage />
    </QueryProvider>,
  );
}

describe('AuditLogPage (G-D2b)', () => {
  beforeEach(() => {
    getMock.mockReset();
  });

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
            action: 'READ_CLAIM',
            resourceType: 'CLAIM',
            resourceId: 'claim_abc123xyz',
            userId: 'user_1',
            user: { id: 'user_1', email: 'alice@acme.co', name: 'Alice Smith' },
            metadata: {},
            ipAddress: '192.168.1.1',
            userAgent: 'Mozilla/5.0',
            createdAt: '2026-08-15T10:30:00.000Z',
          },
        ],
        nextCursor: null,
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
      data: { items: [], nextCursor: null },
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
      data: { items: [], nextCursor: null },
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
            resourceType: 'CLAIM',
            resourceId: 'claim_xyz',
            userId: 'user_1',
            user: { id: 'user_1', email: 'alice@acme.co', name: 'Alice' },
            metadata: {
              summaryId: 'sum_123',
              confidence: 0.95,
              promptVersion: 'v2.1',
            },
            ipAddress: '192.168.1.1',
            userAgent: 'Mozilla/5.0',
            createdAt: '2026-08-15T10:30:00.000Z',
          },
        ],
        nextCursor: null,
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
      data: { items: [], nextCursor: null },
    });

    renderPage();

    const resourceTypeSelect = screen.getByLabelText('Resource Type');
    if (resourceTypeSelect instanceof HTMLSelectElement) {
      await userEvent.selectOptions(resourceTypeSelect, 'CLAIM');

      await waitFor(() => {
        expect(screen.getByText('Clear filters')).toBeInTheDocument();
      });
    }
  });

  it('resets filters when Clear filters button is clicked', async () => {
    getMock.mockResolvedValue({
      data: { items: [], nextCursor: null },
    });

    renderPage();

    const resourceTypeSelect = screen.getByLabelText('Resource Type');
    if (resourceTypeSelect instanceof HTMLSelectElement) {
      await userEvent.selectOptions(resourceTypeSelect, 'CLAIM');

      await waitFor(() => {
        expect(screen.getByText('Clear filters')).toBeInTheDocument();
      });

      const clearButton = screen.getByText('Clear filters');
      await userEvent.click(clearButton);

      expect(resourceTypeSelect.value).toBe('');
    }
  });
});
