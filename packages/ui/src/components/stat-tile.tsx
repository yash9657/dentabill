import * as React from 'react';

import { cn } from '../lib/utils.js';

export interface StatTileProps extends React.HTMLAttributes<HTMLDivElement> {
  readonly label: React.ReactNode;
  readonly value: React.ReactNode;
  readonly caption?: React.ReactNode;
}

export const StatTile = React.forwardRef<HTMLDivElement, StatTileProps>(function StatTile(
  { label, value, caption, className, ...props },
  ref,
) {
  return (
    <div ref={ref} className={cn('flex flex-col gap-1', className)} {...props}>
      <span className="text-micro text-gray-warm font-medium">{label}</span>
      <span className="font-body text-[28px] font-semibold tabular-nums leading-[1.14] tracking-[-0.01em] text-black sm:text-[32px]">
        {value}
      </span>
      {caption ? <span className="text-caption text-gray-warm">{caption}</span> : null}
    </div>
  );
});
