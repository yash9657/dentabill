import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * StatusDot — the achromatic claim/call status indicator from ADR-013.
 *
 * Status communication in DentaBill is *weight + dot + label*, NOT color.
 * Five of the six variants are achromatic — distinguished only by tone of
 * gray and presence/absence of an outline. The single chromatic exception
 * is `active`, which uses the locked muted-teal accent
 * (`oklch(0.78 0.04 200)`) and the `status-pulse` keyframe so that one
 * peripheral-vision signal — "a call is happening right now" — actually
 * registers across an open dashboard.
 *
 * | variant   | meaning                              | swatch                       |
 * | --------- | ------------------------------------ | ---------------------------- |
 * | idle      | nothing in flight                    | gray-light fill, no border   |
 * | pending   | queued, waiting                      | gray-warm hollow ring        |
 * | active    | live call (CALLING / ON_HOLD)        | teal accent + pulse          |
 * | success   | completed                            | black solid fill             |
 * | warning   | needs attention (manual review)      | gray-dark fill + outline     |
 * | error     | failed / denied                      | black ring + black fill      |
 *
 * Renders an `<span>` (inline). When the dot's meaning is not already
 * conveyed by an adjacent label, the consumer should add an
 * `aria-label="Status: …"`. We don't add a default `role="status"` because
 * that would announce every dot on every render — it should be opt-in at
 * the consumer layer.
 */
const statusDotVariants = cva('inline-block rounded-pill shrink-0', {
  variants: {
    variant: {
      idle: 'bg-gray-light',
      pending: 'bg-transparent ring-1 ring-gray-warm',
      active: 'bg-status-active motion-safe:status-pulse',
      success: 'bg-black',
      warning: 'bg-gray-dark ring-1 ring-black',
      error: 'bg-black ring-2 ring-black/30',
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
