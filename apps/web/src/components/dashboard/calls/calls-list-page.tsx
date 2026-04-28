'use client';

import * as React from 'react';

import { useCallsList, type CallsFilters } from '../../../lib/calls/use-calls-list.js';
import { DashboardEmptyState } from '../dashboard-empty-state.js';
import { SkeletonTable } from '../skeleton-table.js';

import { CallsFilterBar } from './calls-filter-bar.js';
import { CallsTable } from './calls-table.js';

function hasClerkKeys(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

/**
 * `/dashboard/calls` — interactive page composition (P3-T24).
 *
 * Owns:
 *   - filter UI state (status / payer chips; no debounce — discrete)
 *   - infinite-paging callback (`onReachEnd` → `fetchNextPage`)
 *   - flattening of `data.pages[].items` for the virtualised table
 *
 * Polling cadence is owned inside `useCallsList`: 5s while any visible
 * call is in a live status, 30s otherwise. The orchestrator only
 * needs to mount the hook and feed the table.
 */
export function CallsListPage(): React.ReactElement {
  if (!hasClerkKeys()) {
    return (
      <DashboardEmptyState
        eyebrow="Calls"
        title="Live payer calls land here"
        body="Sign in to follow live payer calls. Each call shows status, attempt number, hold time, and total duration. Click a row to see the full event timeline."
        previewChildren={<SkeletonTable rows={6} columns={5} />}
        primaryCta={{ label: 'Sign in', href: '/sign-in' }}
        secondaryCta={{ label: 'Open claims', href: '/dashboard/claims' }}
      />
    );
  }
  return <AuthenticatedCallsList />;
}

function AuthenticatedCallsList(): React.ReactElement {
  const [filters, setFilters] = React.useState<CallsFilters>({});
  const query = useCallsList(filters);

  const items = React.useMemo(
    () => (query.data?.pages ?? []).flatMap((page) => page.items),
    [query.data],
  );

  const onReachEnd = React.useCallback(() => {
    if (query.hasNextPage && !query.isFetchingNextPage) {
      void query.fetchNextPage();
    }
  }, [query]);

  return (
    <section className="flex flex-col gap-8" aria-labelledby="calls-heading">
      <header className="max-w-3xl">
        <p className="text-caption text-gray-warm mb-2 uppercase tracking-[0.14em]">Calls</p>
        <h1
          id="calls-heading"
          className="font-display text-[28px] font-light leading-[1.15] tracking-[-0.01em] text-black sm:text-[32px]"
        >
          Live payer calls
        </h1>
        <p className="text-body text-gray-dark mt-3 max-w-prose">
          Calls placed by the DentaBill voice agent. Live calls refresh every five seconds; idle
          views poll every thirty. Click any row for the full event timeline.
        </p>
      </header>

      <CallsFilterBar filters={filters} onChange={setFilters} />

      <CallsTable
        items={items}
        isLoading={query.isPending}
        isFetchingMore={query.isFetchingNextPage}
        hasMore={query.hasNextPage}
        onReachEnd={onReachEnd}
        errorMessage={query.error ? query.error.message : null}
      />
    </section>
  );
}
