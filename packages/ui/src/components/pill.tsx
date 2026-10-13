import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { ArrowRight } from 'lucide-react';
import * as React from 'react';

import { cn } from '../lib/utils.js';

const pillVariants = cva(
  'font-body duration-standard ease-calm focus-visible:outline-brand inline-flex items-center justify-center gap-1 gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        black: 'rounded-standard bg-brand hover:bg-brand-hover active:bg-brand-hover text-white',
        whiteShadow:
          'border-border-light hover:bg-gray-light rounded-standard border bg-white text-black',
        warmStone: 'bg-brand-soft rounded-standard hover:bg-brand-soft/70 text-brand',
      },
      size: {
        default: 'text-button h-11 gap-1.5 px-4',
        sm: 'text-small h-9 gap-1.5 px-3',
        lg: 'text-button h-12 gap-2 px-5',
        warm: 'text-button h-11 gap-2 px-4',
      },
    },
    defaultVariants: {
      variant: 'black',
      size: 'default',
    },
  },
);

export interface PillProps
  extends
    Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'color'>,
    VariantProps<typeof pillVariants> {
  asChild?: boolean;
  withArrow?: boolean;
}

export const Pill = React.forwardRef<HTMLAnchorElement, PillProps>(function Pill(
  { className, variant, size, asChild = false, withArrow = false, children, ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'a';
  return (
    <Comp ref={ref} className={cn(pillVariants({ variant, size, className }))} {...props}>
      {asChild ? (
        children
      ) : (
        <>
          {children}
          {withArrow ? <ArrowRight aria-hidden className="h-4 w-4" /> : null}
        </>
      )}
    </Comp>
  );
});

export { pillVariants };
