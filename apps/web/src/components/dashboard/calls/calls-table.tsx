'use client';

import { Skeleton, StatusDot, cn } from '@dentabill/ui';
import { useVirtualizer } from '@tanstack/react-virtual';
import Link from 'next/link';
import * as React from 'react';

import {
  callStatusIndicatorVariant,
  callStatusLabel,
  type CallSummary,
} from '../../../lib/calls/types.js';

export interface CallsTableProps {
  readonly items: readonly CallSummary[];
  readonly isLoading: boolean;
  readonly isFetchingMore: boolean;
  readonly hasMore: boolean;
  readonly onReachEnd: () => void;
  readonly errorMessage?: string | null;
}

const ROW_HEIGHT = 56;
const HEADER_HEIGHT = 44;

/**
 * Virtualised calls table powered by `@tanstack/react-virtual`. Same
 * scroll/measure contract as the claims table — see that component
 * for the rationale on `role="grid"` over `<table>`.
 *
 * Columns: Started · Status · Attempts · Hold · Duration. Click → detail.
 *
 * Live polling cadence is owned by `useCallsList` / `useCall` — the
 * table itself doesn't know whether it's the 5s or 30s poll, only that
 * the parent re-renders with new rows.
 */
export function CallsTable({
  items,
  isLoading,
  isFetchingMore,
  hasMore,
  onReachEnd,
  errorMessage,
}: CallsTableProps): React.ReactElement {
  const parentRef = React.useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
  });

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
        <p className="text-black">Couldn’t load calls</p>
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
        <p className="font-display text-2xl font-light text-black">No calls match these filters</p>
        <p className="text-body text-gray-warm">
          Click “Call now” on a PENDING claim to enqueue the first call. Live calls will appear here
          and refresh every five seconds while in flight.
        </p>
      </div>
    );
  }

  return (
    <div
      role="grid"
      aria-label="Calls"
      aria-rowcount={items.length + 1}
      className="hairline-edge rounded-card overflow-hidden bg-white"
    >
      <div
        role="row"
        aria-rowindex={1}
        style={{ height: HEADER_HEIGHT }}
        className="text-caption text-gray-warm bg-warm-stone/30 grid grid-cols-[1.4fr_1.2fr_0.7fr_0.7fr_0.9fr] items-center gap-4 px-5 uppercase tracking-[0.12em]"
      >
        <span role="columnheader">Started</span>
        <span role="columnheader">Status</span>
        <span role="columnheader" className="text-right">
          Attempts
        </span>
        <span role="columnheader" className="text-right">
          Hold
        </span>
        <span role="columnheader" className="text-right">
          Duration
        </span>
      </div>

      <div
        ref={parentRef}
        className="relative h-[480px] overflow-auto"
        data-testid="calls-scroll-viewport"
      >
        <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {virtualItems.map((vrow) => {
            const call = items[vrow.index];
            if (!call) return null;
            return (
              <CallRow
                key={call.id}
                call={call}
                rowIndex={vrow.index + 2}
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
  );
}

function CallRow({
  call,
  rowIndex,
  style,
}: {
  readonly call: CallSummary;
  readonly rowIndex: number;
  readonly style: React.CSSProperties;
}): React.ReactElement {
  return (
    <div role="row" aria-rowindex={rowIndex} style={style}>
      <Link
        href={`/dashboard/calls/${call.id}`}
        prefetch={false}
        className={cn(
          'grid h-full grid-cols-[1.4fr_1.2fr_0.7fr_0.7fr_0.9fr] items-center gap-4 px-5',
          'hover:bg-warm-stone/30 border-border-subtle border-t transition-colors',
          'focus-visible:bg-warm-stone/40 focus-visible:outline-none',
        )}
      >
        <span role="gridcell" className="text-body text-sm tabular-nums text-black">
          {formatStartedAt(call.startedAt)}
        </span>
        <span
          role="gridcell"
          className="flex items-center gap-2 text-sm text-black"
          aria-label={`Status: ${callStatusLabel(call.status)}`}
        >
          <StatusDot variant={callStatusIndicatorVariant(call.status)} aria-hidden />
          {callStatusLabel(call.status)}
        </span>
        <span role="gridcell" className="text-body text-right text-sm tabular-nums text-black">
          {call.attemptNumber}
        </span>
        <span role="gridcell" className="text-body text-gray-warm text-right text-sm tabular-nums">
          {formatSeconds(call.holdTimeSeconds)}
        </span>
        <span role="gridcell" className="text-body text-right text-sm tabular-nums text-black">
          {formatSeconds(call.durationSeconds)}
        </span>
      </Link>
    </div>
  );
}

function formatStartedAt(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatSeconds(value: number | null): string {
  if (value === null) return '—';
  if (value < 60) return `${value.toFixed(0)}s`;
  const m = Math.floor(value / 60);
  const s = Math.round(value - m * 60);
  return `${m.toFixed(0)}m ${s.toFixed(0).padStart(2, '0')}s`;
}

function TableSkeleton(): React.ReactElement {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="hairline-edge rounded-card flex flex-col gap-3 bg-white p-6"
    >
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="grid grid-cols-[1.4fr_1.2fr_0.7fr_0.7fr_0.9fr] items-center gap-4">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2 justify-self-end" />
          <Skeleton className="h-4 w-1/2 justify-self-end" />
          <Skeleton className="h-4 w-2/3 justify-self-end" />
        </div>
      ))}
    </div>
  );
}
