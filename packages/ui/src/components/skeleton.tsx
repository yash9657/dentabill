import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * Skeleton — achromatic shimmer loader. Uses the `shimmer` utility from
 * `tailwind.preset.css` which honors `prefers-reduced-motion` (motion
 * collapses to a single static frame for users who request it).
 */
export const Skeleton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function Skeleton({ className, ...props }, ref) {
    return <div ref={ref} className={cn('rounded-standard shimmer', className)} {...props} />;
  },
);
