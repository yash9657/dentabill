import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/utils.js';

const badgeVariants = cva(
  'rounded-pill text-small font-body inline-flex items-center gap-1.5 px-2.5 py-1 font-medium',
  {
    variants: {
      variant: {
        default: 'bg-gray-light text-gray-dark',
        success: 'bg-success-soft text-success',
        warning: 'bg-warning-soft text-warning',
        danger: 'bg-danger-soft text-danger',
        outline: 'border-border-light text-gray-dark border bg-white',
        muted: 'bg-warm-stone/80 text-gray-dark',
        // Pine and sage identify active work; semantic colors cover outcomes.
        active: 'bg-brand-soft text-brand',
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
