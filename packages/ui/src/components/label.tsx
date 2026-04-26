import * as LabelPrimitive from '@radix-ui/react-label';
import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * Label — Radix Label primitive themed via our caption type role.
 * `peer-disabled:` styling lets a sibling `<Input disabled>` fade the label
 * via the `peer` Tailwind variant — the canonical shadcn pattern.
 */
export const Label = React.forwardRef<
  React.ComponentRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(function Label({ className, ...props }, ref) {
  return (
    <LabelPrimitive.Root
      ref={ref}
      className={cn(
        'text-caption font-body font-medium leading-none',
        'peer-disabled:cursor-not-allowed peer-disabled:opacity-70',
        className,
      )}
      {...props}
    />
  );
});
Label.displayName = LabelPrimitive.Root.displayName;
