import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * Button — three core variants from DESIGN.md §4:
 *
 *   • `primary`     Pure black pill — primary CTA. Pill radius 9999px,
 *                   horizontal padding 14px (matches `0px 14px` per spec).
 *   • `secondary`   White pill with the multi-layer card shadow — secondary
 *                   CTA on white surfaces.
 *   • `warmStone`   The signature warm-stone CTA. Translucent warm background
 *                   (`bg-warm-stone/80`), `rounded-warm-button` (30px),
 *                   warm-tinted shadow (`rgba(78,50,23,0.04) 0 6px 16px`),
 *                   asymmetric padding for the physical/tactile feel.
 *
 * Plus `ghost` for subdued in-context actions.
 *
 * `asChild` lets a parent element (e.g. Next.js `<Link>`) become the button
 * root — Radix Slot pattern. This is how shadcn/Radix universally do
 * polymorphism without `as`-prop type gymnastics.
 *
 * Focus is the global `:focus-visible` ring from `tailwind.preset.css`; the
 * button doesn't add its own — that keeps WCAG 2.2 AA enforcement in one
 * place (ADR-021).
 */
const buttonVariants = cva(
  'font-body duration-standard ease-calm inline-flex items-center justify-center font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'rounded-pill bg-black text-white hover:bg-black/90',
        secondary: 'shadow-card hover:bg-gray-light/50 rounded-pill bg-white text-black',
        warmStone:
          'bg-warm-stone/80 rounded-warm-button shadow-warm hover:bg-warm-stone text-black',
        ghost: 'hover:bg-gray-light rounded-pill bg-transparent text-black',
      },
      size: {
        default: 'text-button h-10 px-4',
        sm: 'text-small h-8 px-3',
        lg: 'text-button h-11 px-5',
        warm: 'text-button h-10 px-4',
        icon: 'h-10 w-10',
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
