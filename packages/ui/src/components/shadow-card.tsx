import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * ShadowCard — the brand surface from DESIGN.md §6 (Depth & elevation).
 *
 * The plain shadcn `Card` ships with a single subtle shadow. This brand
 * primitive instead applies the *layered* shadow stack — outline ring +
 * 1px lift + 2px lift, all under 8% black — and uses `rounded-section`
 * (24px) and roomy 32px padding by default. This is the surface used for
 * featured panels, dashboard KPI groupings, and the marketing site's
 * product screenshots, where the layered depth is the point.
 *
 * `tone="warm"` swaps the shadow stack for the warm-tinted lift
 * (`shadow-warm`) and the warm-stone background — the signature stone CTA
 * block from DESIGN.md "Distinctive components". Use sparingly (one to
 * two per page max) — its job is to draw the eye.
 *
 * Both tones are still achromatic in the strict sense (warm-stone is just
 * a warm-tinted neutral, not a brand color); the only chromatic surface
 * in the entire system is `StatusDot`'s `active` variant.
 */
const shadowCardVariants = cva('rounded-section p-4', {
  variants: {
    tone: {
      neutral: 'bg-white shadow-card-layered',
      warm: 'bg-warm-stone/80 shadow-warm',
    },
    padding: {
      compact: 'p-3',
      default: 'p-4',
      roomy: 'p-6',
    },
  },
  defaultVariants: {
    tone: 'neutral',
    padding: 'default',
  },
});

export interface ShadowCardProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof shadowCardVariants> {}

export const ShadowCard = React.forwardRef<HTMLDivElement, ShadowCardProps>(function ShadowCard(
  { className, tone, padding, ...props },
  ref,
) {
  return (
    <div ref={ref} className={cn(shadowCardVariants({ tone, padding, className }))} {...props} />
  );
});

export { shadowCardVariants };
