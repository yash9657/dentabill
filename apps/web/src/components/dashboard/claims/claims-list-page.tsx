'use client';

import { Pill } from '@dentabill/ui';
import * as React from 'react';

import type { ClaimsFilters } from '../../../lib/claims/types.js';
import { useClaimsList } from '../../../lib/claims/use-claims-list.js';
import { DashboardEmptyState } from '../../dashboard/dashboard-empty-state.js';
import { SkeletonTable } from '../../dashboard/skeleton-table.js';

import { ClaimsFilterBar } from './claims-filter-bar.js';
import { ClaimsTable } from './claims-table.js';

const SEARCH_DEBOUNCE_MS = 250;

function hasClerkKeys(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

/**
 * `/dashboard/claims` — interactive page composition.
 *
 * Owns:
 *   - filter UI state (immediate, drives the search input value)
 *   - committed filter state (debounced, drives the queryKey + fetch)
 *   - infinite-paging callback (`onReachEnd` → `fetchNextPage`)
 *   - flattening of `data.pages[].items` into a single array for the
 *     virtualised table
 *
 * The split between draft and committed filters is what stops a user
 * typing "DELTA" from firing 5 SDK calls one keystroke at a time.
 * Status / payer chip clicks commit immediately because they're
 * discrete; only the free-text search is debounced.
 */
export function ClaimsListPage(): React.ReactElement {
  // In CI / dev without Clerk keys, ClerkProvider is not mounted, so the
  // SDK hook (which calls Clerk's `useAuth`) would throw. Fall back to
  // the empty-state stub — the e2e suite asserts the heading + content,
  // not the live table, when running unauthenticated.
  if (!hasClerkKeys()) {
    return (
      <DashboardEmptyState
        eyebrow="Claims"
        title="Open claims queue"
        body="Sign in to load your open claims. Once you upload a CSV from Dentrix, Eaglesoft, or Open Dental, every open claim shows up here ranked by aging, amount, and payer."
        previewChildren={<SkeletonTable rows={6} columns={5} />}
        primaryCta={{ label: 'Sign in', href: '/sign-in' }}
        secondaryCta={{ label: 'Read security overview', href: '/security' }}
      />
    );
  }
  return <AuthenticatedClaimsList />;
}

function AuthenticatedClaimsList(): React.ReactElement {
  const [draftFilters, setDraftFilters] = React.useState<ClaimsFilters>({});
  const [committedFilters, setCommittedFilters] = React.useState<ClaimsFilters>({});

  React.useEffect(() => {
    const sameSearch = (draftFilters.search ?? '') === (committedFilters.search ?? '');
    const sameStatus = draftFilters.status === committedFilters.status;
    const samePayer = draftFilters.payer === committedFilters.payer;
    if (sameSearch && sameStatus && samePayer) return;

    if (!sameStatus || !samePayer) {
      setCommittedFilters(draftFilters);
      return;
    }
    const handle = window.setTimeout(() => {
      setCommittedFilters(draftFilters);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [draftFilters, committedFilters]);

  const query = useClaimsList(committedFilters);

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
    <section className="flex flex-col gap-4" aria-labelledby="claims-heading">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1
          id="claims-heading"
          className="font-body text-[22px] font-medium leading-[1.2] tracking-[-0.01em] text-black sm:text-[24px]"
        >
          Open claims queue
        </h1>
        <Pill href="/dashboard/claims/import" variant="black" size="sm">
          Import claims
        </Pill>
      </header>

      <ClaimsFilterBar filters={draftFilters} onChange={setDraftFilters} />

      <ClaimsTable
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
