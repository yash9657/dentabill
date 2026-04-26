import { Slot } from '@radix-ui/react-slot';
import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * SectionDisplay — 36px Inter Display weight 300, line-height 1.17. Used
 * for in-page section headings (e.g. marketing landing sections, dashboard
 * page titles). One step below `HeroDisplay` in the hierarchy from
 * DESIGN.md §3.
 *
 * Defaults to `<h2>`. The `text-section-heading` typography role (from
 * `theme.css`) bundles size + line-height; `font-light` resolves to the
 * weight-300 Tailwind built-in.
 */
export interface SectionDisplayProps extends React.HTMLAttributes<HTMLHeadingElement> {
  asChild?: boolean;
}

export const SectionDisplay = React.forwardRef<HTMLHeadingElement, SectionDisplayProps>(
  function SectionDisplay({ className, asChild = false, ...props }, ref) {
    const Comp = asChild ? Slot : 'h2';
    return (
      <Comp
        ref={ref}
        className={cn(
          'text-section-heading font-display text-balance font-light text-black',
          className,
        )}
        {...props}
      />
    );
  },
);
