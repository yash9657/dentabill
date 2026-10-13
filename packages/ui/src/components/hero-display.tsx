import { Slot } from '@radix-ui/react-slot';
import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * Newsreader display heading at weight 400, using the fluid text-hero role.
 * Defaults to h1; asChild composes another semantic heading when needed.
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
        className={cn('text-hero font-display text-balance font-normal text-black', className)}
        {...props}
      />
    );
  },
);
