'use client';

import { Skeleton, StatusDot, cn } from '@dentabill/ui';
import { useVirtualizer } from '@tanstack/react-virtual';
import Link from 'next/link';
import * as React from 'react';

import {
  payerLabel,
  statusIndicatorVariant,
  statusLabel,
  type Claim,
} from '../../../lib/claims/types.js';
import { CallNowPill } from '../calls/call-now-pill.js';

export interface ClaimsTableProps {
  readonly items: readonly Claim[];
  readonly isLoading: boolean;
  readonly isFetchingMore: boolean;
  readonly hasMore: boolean;
  readonly onReachEnd: () => void;
  readonly errorMessage?: string | null;
}

const ROW_HEIGHT = 60;
const HEADER_HEIGHT = 44;

/**
 * Virtualised claims table powered by `@tanstack/react-virtual`.
 *
 * Why virtualise: a busy practice can have thousands of open claims;
 * the table is the most-trafficked dashboard surface, and we want
 * scroll to stay frame-perfect even past 10k rows. Each row is a fixed
 * 60px so the virtualiser doesn't measure on every render.
 *
 * Why CSS grid for rows + a containing scroll viewport: tables in
 * Next.js RSC + Tailwind are awkward when virtualised because
 * `<tbody>` with `position: relative` causes layout assertions in
 * Chromium. Using `role="grid"` keeps the semantics screen-reader
 * friendly without fighting `<table>` quirks.
 */
export function ClaimsTable({
  items,
  isLoading,
  isFetchingMore,
  hasMore,
  onReachEnd,
  errorMessage,
}: ClaimsTableProps): React.ReactElement {
  const parentRef = React.useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 6,
  });

  // When the user scrolls within ~3 rows of the end of the loaded
  // list, ask for the next page. We re-evaluate after every layout
  // pass because the virtualizer batches measurements.
  const virtualItems = virtualizer.getVirtualItems();
  React.useEffect(() => {
    if (items.length === 0 || !hasMore || isFetchingMore || isLoading) return;
    const last = virtualItems[virtualItems.length - 1];
    if (!last) return;
    if (last.index >= items.length - 4) onReachEnd();
  }, [virtualItems, items.length, hasMore, isFetchingMore, isLoading, onReachEnd]);

  if (errorMessage) {
    return (
      <div role="alert" className="hairline-edge rounded-card text-body bg-stone-warm/30 px-5 py-4">
        <p className="text-black">Couldn’t load claims</p>
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
        <p className="font-display text-2xl font-light text-black">No claims match these filters</p>
        <p className="text-body text-gray-warm">
          Adjust the chips above, or import a CSV from /dashboard/claims/import to populate the
          queue.
        </p>
      </div>
    );
  }

  return (
    <div
      role="grid"
      aria-label="Claims"
      aria-rowcount={items.length + 1}
      className="hairline-edge rounded-card overflow-hidden bg-white"
    >
      <div
        role="row"
        aria-rowindex={1}
        style={{ height: HEADER_HEIGHT }}
        className="text-caption text-gray-warm bg-stone-warm/30 grid grid-cols-[1.4fr_1.3fr_0.85fr_1fr_0.95fr_0.55fr_minmax(7rem,0.9fr)] items-center gap-4 px-5 uppercase tracking-[0.12em]"
      >
        <span role="columnheader">Claim</span>
        <span role="columnheader">Payer</span>
        <span role="columnheader" className="text-right">
          Amount
        </span>
        <span role="columnheader">Status</span>
        <span role="columnheader">Service date</span>
        <span role="columnheader" className="text-right">
          Priority
        </span>
        <span role="columnheader" className="text-right">
          Action
        </span>
      </div>

      <div
        ref={parentRef}
        className="relative h-[480px] overflow-auto"
        data-testid="claims-scroll-viewport"
      >
        <div style={{ height: virtualizer.getTotalSize(), width: '100%', position: 'relative' }}>
          {virtualItems.map((vrow) => {
            const claim = items[vrow.index];
            if (!claim) return null;
            return (
              <ClaimRow
                key={claim.id}
                claim={claim}
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
          <div className="text-caption text-gray-warm absolute bottom-0 left-0 right-0 border-t border-black/5 bg-white/95 px-5 py-2">
            Loading more…
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ClaimRow({
  claim,
  rowIndex,
  style,
}: {
  readonly claim: Claim;
  readonly rowIndex: number;
  readonly style: React.CSSProperties;
}): React.ReactElement {
  return (
    <div
      role="row"
      aria-rowindex={rowIndex}
      style={style}
      className={cn(
        'group grid grid-cols-[1.4fr_1.3fr_0.85fr_1fr_0.95fr_0.55fr_minmax(7rem,0.9fr)] items-center gap-4 px-5',
        'hover:bg-stone-warm/30 border-t border-black/5 transition-colors',
        'focus-within:bg-stone-warm/40',
      )}
    >
      {/* The first six cells are wrapped in a Link so the whole row remains
          a single click target; the action cell is a sibling so the button
          inside it never accidentally triggers navigation. The link spans
          via subgrid so the column tracks stay aligned with the header. */}
      <Link
        href={`/dashboard/claims/${claim.id}`}
        prefetch={false}
        className="col-span-6 grid h-full grid-cols-subgrid items-center focus-visible:outline-none"
      >
        <span role="gridcell" className="font-mono text-sm text-black">
          {claim.claimNumber}
        </span>
        <span role="gridcell" className="text-body text-gray-dark text-sm">
          {payerLabel(claim.payerCode)}
        </span>
        <span role="gridcell" className="text-body text-right font-medium tabular-nums text-black">
          ${claim.claimAmount}
        </span>
        <span
          role="gridcell"
          className="flex items-center gap-2 text-sm text-black"
          aria-label={`Status: ${statusLabel(claim.status)}`}
        >
          <StatusDot variant={statusIndicatorVariant(claim.status)} aria-hidden />
          {statusLabel(claim.status)}
        </span>
        <span role="gridcell" className="text-body text-gray-warm text-sm">
          {formatServiceDate(claim.serviceDate)}
        </span>
        <span role="gridcell" className="text-body text-right text-sm tabular-nums text-black">
          {claim.priority}
        </span>
      </Link>
      <span role="gridcell" className="flex items-center justify-end">
        <CallNowPill claimId={claim.id} claimStatus={claim.status} variant="compact" />
      </span>
    </div>
  );
}

function formatServiceDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function TableSkeleton(): React.ReactElement {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="hairline-edge rounded-card flex flex-col gap-3 bg-white p-6"
    >
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          className="grid grid-cols-[1.4fr_1.3fr_0.85fr_1fr_0.95fr_0.55fr_minmax(7rem,0.9fr)] items-center gap-4"
        >
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2 justify-self-end" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-1/3 justify-self-end" />
          <Skeleton className="h-7 w-20 justify-self-end" />
        </div>
      ))}
    </div>
  );
}
