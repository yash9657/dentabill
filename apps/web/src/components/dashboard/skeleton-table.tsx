import { Skeleton } from '@dentabill/ui';
import * as React from 'react';

/**
 * `<SkeletonTable>` — preview block that previews the eventual
 * data table on /dashboard/claims (and elsewhere).
 *
 * Renders `rows` × `columns` Skeleton blocks of varying widths so
 * the eye reads the shape of a real table without us shipping a
 * fake one. Column widths cycle through a deterministic palette so
 * the preview looks plausible across re-renders without any random
 * jitter.
 */
export interface SkeletonTableProps {
  readonly rows?: number;
  readonly columns?: number;
}

const COLUMN_WIDTHS = ['w-1/3', 'w-1/4', 'w-1/5', 'w-1/6', 'w-1/4'] as const;

export function SkeletonTable({ rows = 5, columns = 5 }: SkeletonTableProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, rowIndex) => (
        <div key={rowIndex} className="flex items-center gap-4">
          {Array.from({ length: columns }, (_, colIndex) => {
            const width = COLUMN_WIDTHS[colIndex % COLUMN_WIDTHS.length] ?? COLUMN_WIDTHS[0];
            return <Skeleton key={colIndex} className={`h-4 ${width}`} />;
          })}
        </div>
      ))}
    </div>
  );
}
