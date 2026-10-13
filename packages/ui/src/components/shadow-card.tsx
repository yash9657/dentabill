import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * Elevated surface with 16px corners. Default padding is 16px, with compact
 * (12px) and roomy (24px) options. The warm tone uses the warm-stone surface
 * and warm shadow; use it sparingly alongside the standard bordered Card.
 */
const shadowCardVariants = cva('rounded-section p-4', {
  variants: {
    tone: {
      neutral: 'shadow-card-layered bg-white',
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
