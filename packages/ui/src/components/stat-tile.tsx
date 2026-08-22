import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * StatTile — a reusable component for displaying a stat value with label and
 * optional caption.
 *
 * Pattern seen across dashboard pages: label (caption, uppercase, warm-gray),
 * value (28–32px weight 300, black), optional caption (14px caption, warm-gray).
 * Supports an em-dash placeholder for "no data yet" so layout does not jump
 * when real numbers arrive.
 *
 * Props:
 *   - `label` (required): the stat name (caption/micro, uppercase, warm-gray)
 *   - `value` (required): the headline number or em-dash (—) placeholder
 *   - `caption` (optional): small contextual line (delta, period, cohort reference)
 *   - `className` (optional): merged with cn()
 *
 * Renders a `<div>` with flexbox column layout. Pair with `<Card>` or standalone.
 */
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
      <span className="text-micro text-gray-warm uppercase tracking-[0.12em]">{label}</span>
      <span className="font-display text-[28px] font-light leading-[1.14] tracking-[-0.01em] text-black sm:text-[32px]">
        {value}
      </span>
      {caption ? <span className="text-caption text-gray-warm">{caption}</span> : null}
    </div>
  );
});
