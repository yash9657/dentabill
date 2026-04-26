import { Skeleton } from '@dentabill/ui';
import * as React from 'react';

/**
 * Top-level loading UI used by Next's automatic `<Suspense>` boundary
 * during route transitions. Returns Skeleton placeholders sized roughly
 * like the landing hero so the layout doesn't shift when the real page
 * mounts (CLS budget per ADR-020).
 */
export default function Loading(): React.ReactElement {
  return (
    <main
      role="status"
      aria-label="Loading"
      className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-6 px-4 py-16"
    >
      <Skeleton className="h-12 w-3/4" />
      <Skeleton className="h-6 w-2/3" />
      <div className="flex gap-3">
        <Skeleton className="rounded-pill h-10 w-32" />
        <Skeleton className="rounded-pill h-10 w-28" />
      </div>
    </main>
  );
}
