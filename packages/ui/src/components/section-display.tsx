import { Slot } from '@radix-ui/react-slot';
import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * Newsreader section heading at weight 500, using text-section-heading.
 * Defaults to h2; working-screen titles use DashboardPageHeading instead.
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
          'text-section-heading font-display text-balance font-medium text-black',
          className,
        )}
        {...props}
      />
    );
  },
);
