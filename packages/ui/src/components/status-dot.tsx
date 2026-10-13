import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/utils.js';

const statusDotVariants = cva('rounded-pill inline-block shrink-0', {
  variants: {
    variant: {
      idle: 'bg-gray-light',
      pending: 'ring-gray-warm bg-transparent ring-1',
      active: 'bg-status-active motion-safe:status-pulse',
      success: 'bg-success',
      warning: 'bg-warning',
      error: 'bg-danger',
    },
    size: {
      sm: 'h-1.5 w-1.5',
      default: 'h-2 w-2',
      lg: 'h-2.5 w-2.5',
    },
  },
  defaultVariants: {
    variant: 'idle',
    size: 'default',
  },
});

export interface StatusDotProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof statusDotVariants> {}

export const StatusDot = React.forwardRef<HTMLSpanElement, StatusDotProps>(function StatusDot(
  { className, variant, size, ...props },
  ref,
) {
  return (
    <span ref={ref} className={cn(statusDotVariants({ variant, size, className }))} {...props} />
  );
});

export { statusDotVariants };
