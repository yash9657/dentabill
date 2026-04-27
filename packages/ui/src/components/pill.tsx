import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { ArrowRight } from 'lucide-react';
import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * Pill — the brand-signature CTA shape from DESIGN.md §4. Three variants
 * mirror the ElevenLabs treatment exactly:
 *
 *   • `black`        Pure black pill, white text — primary CTA in headers
 *                    and hero blocks.
 *   • `whiteShadow`  White pill with the layered card shadow — secondary
 *                    CTA on white surfaces.
 *   • `warmStone`    The signature translucent warm-stone CTA with the
 *                    warm-tinted shadow and asymmetric padding (more right
 *                    than left), creating a tactile/physical quality.
 *
 * **Pill vs Button.** Both exist deliberately. Button is the shadcn-style
 * `<button>` primitive used inside forms and interactive surfaces. Pill is
 * a *navigation* primitive — defaults to `<a>` because that's how pills
 * appear in our marketing chrome (hero CTA, sticky header CTA, footer
 * "Get started"). Use `asChild` to drop in a Next.js `<Link>` so the
 * router takes over. If you need a form-submitting pill, use Button with
 * `variant="primary"` instead.
 *
 * Optional `withArrow` renders a trailing → glyph (lucide ArrowRight),
 * matching the ElevenLabs hero pattern. Achromatic by design — the arrow
 * inherits the pill's text color.
 */
const pillVariants = cva(
  'font-body duration-standard ease-calm inline-flex items-center justify-center gap-1 font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        black: 'rounded-pill bg-black text-white hover:bg-black/90',
        whiteShadow: 'shadow-card hover:bg-gray-light/50 rounded-pill bg-white text-black',
        warmStone:
          'bg-warm-stone/80 rounded-warm-button shadow-warm hover:bg-warm-stone text-black',
      },
      size: {
        default: 'text-button h-10 gap-1.5 px-4',
        sm: 'text-small h-8 gap-1.5 px-3',
        lg: 'text-button h-11 gap-2 px-5',
        warm: 'text-button h-10 gap-2 px-4',
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
