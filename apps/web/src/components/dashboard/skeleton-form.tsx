import { Skeleton } from '@dentabill/ui';
import * as React from 'react';

/**
 * `<SkeletonForm>` — preview block for the settings sub-pages, each
 * of which will render a form once Phase 2/3 wires up the relevant
 * write endpoints.
 *
 * Three skeleton field rows: a label line, an input bar, an
 * optional helper line. Above them, an optional pair of header
 * lines stand in for the section title + intro paragraph.
 */
export interface SkeletonFormProps {
  readonly fields?: number;
}

export function SkeletonForm({ fields = 4 }: SkeletonFormProps): React.ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      <div className="flex flex-col gap-5">
        {Array.from({ length: fields }, (_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-9 w-full max-w-md" />
          </div>
        ))}
      </div>
    </div>
  );
}
