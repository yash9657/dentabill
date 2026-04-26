import { Slot } from '@radix-ui/react-slot';
import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * HeroDisplay — 48px Inter Display weight 200, line-height 1.08, tracking
 * −0.96px. The single most important typographic statement in the system:
 * *light as the hero weight*. Per DESIGN.md §3 and ADR-013, this is the
 * thinnest stroke we publish — whisper-thin display type that creates
 * intrigue through restraint.
 *
 * Defaults to `<h1>`. Use `asChild` to compose with another heading level
 * (e.g., wrap an `<h2>` inside) when a page already has its `<h1>` set.
 *
 * `text-hero` (from theme.css) bundles the size, line-height, and tracking
 * as a single typography role; `font-display` selects the Inter Display
 * family; `font-extralight` resolves to weight 200 — Tailwind's built-in
 * weight utility, NOT a custom token (see ADR-015 / token cleanup).
 */
export interface HeroDisplayProps extends React.HTMLAttributes<HTMLHeadingElement> {
  asChild?: boolean;
}

export const HeroDisplay = React.forwardRef<HTMLHeadingElement, HeroDisplayProps>(
  function HeroDisplay({ className, asChild = false, ...props }, ref) {
    const Comp = asChild ? Slot : 'h1';
    return (
      <Comp
        ref={ref}
        className={cn('text-hero font-display font-extralight text-balance text-black', className)}
        {...props}
      />
    );
  },
);
