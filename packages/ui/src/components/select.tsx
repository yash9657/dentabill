import * as React from 'react';

import { cn } from '../lib/utils.js';

/** Native select keeps keyboard, touch, and assistive-technology behavior. */
export const Select = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        'rounded-standard border-border-light focus:border-brand h-11 min-w-0 border bg-white px-3 text-sm text-black transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  );
});
