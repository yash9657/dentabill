import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/utils.js';

const buttonVariants = cva(
  'font-body duration-standard ease-calm focus-visible:outline-brand inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'rounded-standard bg-brand hover:bg-brand-hover active:bg-brand-hover text-white',
        secondary:
          'border-border-light hover:bg-gray-light rounded-standard border bg-white text-black',
        warmStone: 'bg-brand-soft rounded-standard hover:bg-brand-soft/70 text-brand',
        ghost: 'hover:bg-gray-light rounded-standard bg-transparent text-black',
      },
      size: {
        default: 'text-button h-11 px-4',
        sm: 'text-small h-9 px-3',
        lg: 'text-button h-12 px-5',
        warm: 'text-button h-11 px-4',
        icon: 'h-11 w-10',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, type = 'button', ...props },
  ref,
) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp
      ref={ref}
      // The default `type="submit"` for inside-form buttons is a footgun;
      // explicit `button` unless the consumer overrides.
      {...(asChild ? {} : { type })}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
});

export { buttonVariants };
