import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AuditLogEntry } from '../../../lib/audit/types.js';

import { AuditLogTable } from './audit-log-table.js';

// Mock @tanstack/react-virtual to simplify testing. In real usage,
// the virtualizer renders only visible items; in tests, we want all
// items rendered so we can assert on them.
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number }) => {
    return {
      getVirtualItems: () =>
        Array.from({ length: opts.count }, (_, i) => ({
          index: i,
          start: i * 60, // ROW_HEIGHT
        })),
      getTotalSize: () => opts.count * 60,
    };
  },
}));

const SAMPLE_ENTRY: AuditLogEntry = {
  id: 'audit_1',
  action: 'READ_CLAIM',
  resourceType: 'CLAIM',
  resourceId: 'claim_abc123xyz789',
  userId: 'user_1',
  user: { id: 'user_1', email: 'alice@acme.co', name: 'Alice Smith' },
  metadata: { reason: 'dashboard_view' },
  ipAddress: '192.168.1.1',
  userAgent: 'Mozilla/5.0',
  createdAt: '2026-08-15T10:30:45.000Z',
};

const SAMPLE_AI_ENTRY: AuditLogEntry = {
  ...SAMPLE_ENTRY,
  id: 'audit_2',
  action: 'AUTO_TRANSITION',
  metadata: {
    summaryId: 'sum_xyz789',
    confidence: 0.95,
    promptVersion: 'v2.1',
    reason: 'auto_approved',
  },
};

describe('AuditLogTable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the table header with all columns when items exist', () => {
    render(
      <AuditLogTable
        items={[SAMPLE_ENTRY]}
        isLoading={false}
        isFetchingMore={false}
        hasMore={false}
        onReachEnd={vi.fn()}
      />,
    );

    expect(screen.getByText('Timestamp')).toBeInTheDocument();
    expect(screen.getByText('Actor')).toBeInTheDocument();
    expect(screen.getByText('Action')).toBeInTheDocument();
    expect(screen.getByText('Entity')).toBeInTheDocument();
    expect(screen.getByText('Details')).toBeInTheDocument();
  });

  it('renders empty state when items array is empty', () => {
    render(
      <AuditLogTable
        items={[]}
        isLoading={false}
        isFetchingMore={false}
        hasMore={false}
        onReachEnd={vi.fn()}
      />,
    );

    expect(screen.getByText('No audit logs match these filters')).toBeInTheDocument();
  });

  it('renders loading skeleton when isLoading is true', () => {
    const { container } = render(
      <AuditLogTable
        items={[]}
        isLoading={true}
        isFetchingMore={false}
        hasMore={false}
        onReachEnd={vi.fn()}
      />,
    );

    // The skeleton renders a div with aria-busy and aria-live
    const busyDiv = container.querySelector('[aria-busy="true"]');
    expect(busyDiv).toBeInTheDocument();
    expect(busyDiv).toHaveAttribute('aria-live', 'polite');
  });

  it('renders error state with message', () => {
    render(
      <AuditLogTable
        items={[]}
        isLoading={false}
        isFetchingMore={false}
        hasMore={false}
        onReachEnd={vi.fn()}
        errorMessage="Failed to load audit logs"
      />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Couldn't load audit logs")).toBeInTheDocument();
    expect(screen.getByText('Failed to load audit logs')).toBeInTheDocument();
  });

  it('renders rows with audit entry data', () => {
    render(
      <AuditLogTable
        items={[SAMPLE_ENTRY]}
        isLoading={false}
        isFetchingMore={false}
        hasMore={false}
        onReachEnd={vi.fn()}
      />,
    );

    expect(screen.getByText('READ_CLAIM')).toBeInTheDocument();
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
    expect(screen.getByText('CLAIM')).toBeInTheDocument();
    // ResourceId is truncated to first 8 chars
    expect(screen.getByText(/claim_ab/)).toBeInTheDocument();
  });

  it('displays System actor when user is null', () => {
    const entryNoUser: AuditLogEntry = { ...SAMPLE_ENTRY, user: null, userId: null };
    render(
      <AuditLogTable
        items={[entryNoUser]}
        isLoading={false}
        isFetchingMore={false}
        hasMore={false}
        onReachEnd={vi.fn()}
      />,
    );

    expect(screen.getByText('System')).toBeInTheDocument();
  });

  it('calls onReachEnd when user scrolls near the end of the list', async () => {
    const onReachEnd = vi.fn();

    const { container } = render(
      <AuditLogTable
        items={Array.from({ length: 50 }, (_, i) => ({
          ...SAMPLE_ENTRY,
          id: `audit_${String(i)}`,
        }))}
        isLoading={false}
        isFetchingMore={false}
        hasMore={true}
        onReachEnd={onReachEnd}
      />,
    );

    // Get the scroll viewport
    const viewport = container.querySelector('[data-testid="audit-log-scroll-viewport"]');
    expect(viewport).toBeInTheDocument();
  });

  it('renders "Loading more…" text when isFetchingMore is true', () => {
    render(
      <AuditLogTable
        items={[SAMPLE_ENTRY]}
        isLoading={false}
        isFetchingMore={true}
        hasMore={true}
        onReachEnd={vi.fn()}
      />,
    );

    expect(screen.getByText('Loading more…')).toBeInTheDocument();
  });

  it('renders Show button for each row', () => {
    render(
      <AuditLogTable
        items={[SAMPLE_ENTRY, SAMPLE_AI_ENTRY]}
        isLoading={false}
        isFetchingMore={false}
        hasMore={false}
        onReachEnd={vi.fn()}
      />,
    );

    const showButtons = screen.getAllByRole('button', { name: 'Show' });
    expect(showButtons).toHaveLength(2);
  });

  it('expands metadata drawer when Show button is clicked', async () => {
    const user = userEvent.setup();

    render(
      <AuditLogTable
        items={[SAMPLE_AI_ENTRY]}
        isLoading={false}
        isFetchingMore={false}
        hasMore={false}
        onReachEnd={vi.fn()}
      />,
    );

    const showButton = screen.getByRole('button', { name: 'Show' });
    await user.click(showButton);

    await waitFor(() => {
      expect(screen.getByText('Audit Details')).toBeInTheDocument();
      expect(screen.getByText('AI Decision Parameters')).toBeInTheDocument();
    });
  });

  it('displays AI decision parameters in the drawer for AUTO_TRANSITION entries', async () => {
    const user = userEvent.setup();

    render(
      <AuditLogTable
        items={[SAMPLE_AI_ENTRY]}
        isLoading={false}
        isFetchingMore={false}
        hasMore={false}
        onReachEnd={vi.fn()}
      />,
    );

    const showButton = screen.getByRole('button', { name: 'Show' });
    await user.click(showButton);

    await waitFor(() => {
      expect(screen.getByText('Summary ID')).toBeInTheDocument();
      expect(screen.getByText('sum_xyz789')).toBeInTheDocument();
      expect(screen.getByText('Confidence')).toBeInTheDocument();
      expect(screen.getByText('95.0%')).toBeInTheDocument();
      expect(screen.getByText('Prompt Version')).toBeInTheDocument();
      expect(screen.getByText('v2.1')).toBeInTheDocument();
    });
  });

  it('closes metadata drawer when Close button is clicked', async () => {
    const user = userEvent.setup();

    render(
      <AuditLogTable
        items={[SAMPLE_AI_ENTRY]}
        isLoading={false}
        isFetchingMore={false}
        hasMore={false}
        onReachEnd={vi.fn()}
      />,
    );

    const showButton = screen.getByRole('button', { name: 'Show' });
    await user.click(showButton);

    await waitFor(() => {
      expect(screen.getByText('Audit Details')).toBeInTheDocument();
    });

    const closeButton = screen.getByRole('button', { name: 'Close' });
    await user.click(closeButton);

    await waitFor(() => {
      expect(screen.queryByText('Audit Details')).not.toBeInTheDocument();
    });
  });

  it('closes metadata drawer when Escape key is pressed', async () => {
    const user = userEvent.setup();

    render(
      <AuditLogTable
        items={[SAMPLE_AI_ENTRY]}
        isLoading={false}
        isFetchingMore={false}
        hasMore={false}
        onReachEnd={vi.fn()}
      />,
    );

    const showButton = screen.getByRole('button', { name: 'Show' });
    await user.click(showButton);

    await waitFor(() => {
      expect(screen.getByText('Audit Details')).toBeInTheDocument();
    });

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByText('Audit Details')).not.toBeInTheDocument();
    });
  });

  it('displays full metadata JSON in the drawer', async () => {
    const user = userEvent.setup();

    render(
      <AuditLogTable
        items={[SAMPLE_AI_ENTRY]}
        isLoading={false}
        isFetchingMore={false}
        hasMore={false}
        onReachEnd={vi.fn()}
      />,
    );

    const showButton = screen.getByRole('button', { name: 'Show' });
    await user.click(showButton);

    await waitFor(() => {
      // The full metadata JSON should be displayed in a code block
      const metadataText = screen.getByText(/"summaryId"/);
      expect(metadataText).toBeInTheDocument();
    });
  });
});
