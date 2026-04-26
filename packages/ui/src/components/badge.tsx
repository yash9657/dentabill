import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * Badge — communicates status without color (per ADR-013). The `active`
 * variant is the ONLY chromatic variant — uses the muted teal status accent
 * for live-call indicators. Everything else is achromatic + warm-tinted.
 */
const badgeVariants = cva(
  'rounded-subtle text-small font-body inline-flex items-center px-1.5 py-0.5 font-medium',
  {
    variants: {
      variant: {
        default: 'bg-gray-light text-gray-dark',
        outline: 'border-border-light text-gray-dark border bg-white',
        muted: 'bg-warm-stone/80 text-gray-dark',
        // The only chromatic badge — used ONLY for `CALLING` / live-call.
        active: 'bg-status-active/15 text-status-active',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps): React.ReactElement {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { badgeVariants };
