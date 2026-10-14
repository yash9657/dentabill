'use client';

import { Skeleton, cn } from '@dentabill/ui';
import { useVirtualizer } from '@tanstack/react-virtual';
import * as React from 'react';

import type { AuditLogEntry } from '../../../lib/audit/types.js';
import { formatAuditTimestamp } from '../../../lib/audit/types.js';

import { MetadataDrawer } from './metadata-drawer.js';

export interface AuditLogTableProps {
  readonly items: readonly AuditLogEntry[];
  readonly isLoading: boolean;
  readonly isFetchingMore: boolean;
  readonly hasMore: boolean;
  readonly onReachEnd: () => void;
  readonly errorMessage?: string | null;
}

const ROW_HEIGHT = 60;
const HEADER_HEIGHT = 44;

/**
 * Virtualised audit log table powered by `@tanstack/react-virtual`.
 *
 * Why virtualise: compliance teams audit all reads of sensitive data;
 * the log can easily grow to thousands or tens of thousands of rows.
 * Fixed-height rows (60px) enable the virtualiser to render only the
 * visible subset while scrolling stays frame-perfect.
 *
 * Metadata drawer: click any row to expand it in a side panel showing
 * the full JSON metadata. For AI-driven actions (auto-transition), the
 * drawer highlights summaryId, confidence, and promptVersion.
 */
export function AuditLogTable({
  items,
  isLoading,
  isFetchingMore,
  hasMore,
  onReachEnd,
  errorMessage,
}: AuditLogTableProps): React.ReactElement {
  const parentRef = React.useRef<HTMLDivElement>(null);
  const [expandedEntryId, setExpandedEntryId] = React.useState<string | null>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
  });

  // Trigger pagination when the user scrolls near the end.
  const virtualItems = virtualizer.getVirtualItems();
  React.useEffect(() => {
    if (items.length === 0 || !hasMore || isFetchingMore || isLoading) return;
    const last = virtualItems[virtualItems.length - 1];
    if (!last) return;
    if (last.index >= items.length - 4) onReachEnd();
  }, [virtualItems, items.length, hasMore, isFetchingMore, isLoading, onReachEnd]);

  if (errorMessage) {
    return (
      <div role="alert" className="hairline-edge rounded-card text-body bg-warm-stone/30 px-5 py-4">
        <p className="text-black">Couldn&apos;t load audit logs</p>
        <p className="text-gray-warm mt-1 text-sm">{errorMessage}</p>
      </div>
    );
  }

  if (isLoading) {
    return <TableSkeleton />;
  }

  if (items.length === 0) {
    return (
      <div className="hairline-edge rounded-card flex flex-col items-start gap-2 bg-white px-6 py-10">
        <p className="font-body text-2xl font-medium text-black">
          No audit logs match these filters
        </p>
        <p className="text-body text-gray-warm">
          Try adjusting the date range or resource type filter above.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        role="grid"
        aria-label="Audit logs"
        aria-rowcount={items.length + 1}
        className="hairline-edge rounded-card overflow-x-auto bg-white"
      >
        <div
          role="row"
          aria-rowindex={1}
          style={{ height: HEADER_HEIGHT }}
          className="text-caption text-gray-warm bg-gray-light-alt grid min-w-[720px] grid-cols-[2fr_1.2fr_1.2fr_1.2fr_1fr] items-center gap-4 px-5 uppercase tracking-[0.12em]"
        >
          <span role="columnheader">Timestamp</span>
          <span role="columnheader">Actor</span>
          <span role="columnheader">Action</span>
          <span role="columnheader">Entity</span>
          <span role="columnheader" className="text-right">
            Details
          </span>
        </div>

        <div
          ref={parentRef}
          className="relative h-[min(480px,60vh)] min-w-[720px] overflow-y-auto"
          data-testid="audit-log-scroll-viewport"
        >
          <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
            {virtualItems.map((vrow) => {
              const entry = items[vrow.index];
              if (!entry) return null;
              return (
                <AuditLogRow
                  key={entry.id}
                  entry={entry}
                  rowIndex={vrow.index + 2}
                  isExpanded={expandedEntryId === entry.id}
                  onToggleExpand={() => {
                    setExpandedEntryId(expandedEntryId === entry.id ? null : entry.id);
                  }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: ROW_HEIGHT,
                    transform: `translateY(${String(vrow.start)}px)`,
                  }}
                />
              );
            })}
          </div>
          {isFetchingMore ? (
            <div className="text-caption text-gray-warm border-border-subtle absolute bottom-0 left-0 right-0 border-t bg-white/95 px-5 py-2">
              Loading more…
            </div>
          ) : null}
        </div>
      </div>

      {expandedEntryId
        ? (() => {
            const entry = items.find((e) => e.id === expandedEntryId);
            return entry ? (
              <MetadataDrawer
                entry={entry}
                onClose={() => {
                  setExpandedEntryId(null);
                }}
              />
            ) : null;
          })()
        : null}
    </div>
  );
}

function AuditLogRow({
  entry,
  rowIndex,
  isExpanded,
  onToggleExpand,
  style,
}: {
  readonly entry: AuditLogEntry;
  readonly rowIndex: number;
  readonly isExpanded: boolean;
  readonly onToggleExpand: () => void;
  readonly style: React.CSSProperties;
}): React.ReactElement {
  return (
    <div
      role="row"
      aria-rowindex={rowIndex}
      style={style}
      className={cn(
        'group grid grid-cols-[2fr_1.2fr_1.2fr_1.2fr_1fr] items-center gap-4 px-5',
        'w-full',
        'hover:bg-warm-stone/30 border-border-subtle border-t transition-colors',
      )}
    >
      <span role="gridcell" className="text-body text-gray-dark text-sm">
        {formatAuditTimestamp(entry.createdAt)}
      </span>

      <span
        role="gridcell"
        className="text-body text-gray-dark truncate text-sm"
        title={entry.userId ? `Recorded user ${entry.userId}` : undefined}
      >
        {entry.userId
          ? `Recorded user · ${entry.userId.slice(0, 8)}${entry.userId.length > 8 ? '…' : ''}`
          : 'Actor not recorded'}
      </span>

      <span role="gridcell" className="font-mono text-sm text-black">
        {entry.action}
      </span>

      <span role="gridcell" className="text-body text-gray-dark text-sm">
        <span className="text-gray-warm text-xs uppercase tracking-wide">{entry.resourceType}</span>
        <span className="ml-2 font-mono text-black">{entry.resourceId.slice(0, 8)}</span>
      </span>

      <span role="gridcell" className="flex items-center justify-end">
        <button
          onClick={onToggleExpand}
          className="rounded-standard text-gray-dark px-2 py-1 text-xs font-medium hover:text-black"
          aria-pressed={isExpanded}
        >
          {isExpanded ? 'Hide' : 'Show'}
        </button>
      </span>
    </div>
  );
}

function TableSkeleton(): React.ReactElement {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="hairline-edge rounded-card flex flex-col gap-3 bg-white p-6"
    >
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="grid grid-cols-[2fr_1.2fr_1.2fr_1.2fr_1fr] items-center gap-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/3 justify-self-end" />
        </div>
      ))}
    </div>
  );
}
