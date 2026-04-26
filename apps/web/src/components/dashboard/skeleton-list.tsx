import { Skeleton } from '@dentabill/ui';
import * as React from 'react';

/**
 * `<SkeletonList>` — preview block for the call list and any other
 * vertical-card list view on the dashboard.
 *
 * Each row is a circular avatar, a stack of two text lines, and a
 * trailing meta line — the shape of a "subject + secondary line +
 * timestamp" row that reads on every device width.
 */
export interface SkeletonListProps {
  readonly rows?: number;
}

export function SkeletonList({ rows = 4 }: SkeletonListProps): React.ReactElement {
  return (
    <ul className="flex flex-col gap-4">
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="flex items-center gap-4">
          <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-3 w-14 shrink-0" />
        </li>
      ))}
    </ul>
  );
}
