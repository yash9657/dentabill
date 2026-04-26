import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * Card — DentaBill's standard card surface. White background, 16px radius,
 * the multi-layer card shadow stack from DESIGN.md depth Level 1
 * (`shadow-card-layered` from the preset).
 *
 * Composable subparts (`CardHeader`, `CardTitle`, `CardDescription`,
 * `CardContent`, `CardFooter`) follow the shadcn convention — consumers
 * compose them rather than receive props.
 */
export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function Card({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn('rounded-card shadow-card-layered bg-white', className)}
        {...props}
      />
    );
  },
);

export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardHeader({ className, ...props }, ref) {
    return <div ref={ref} className={cn('flex flex-col gap-1.5 p-3', className)} {...props} />;
  },
);

/**
 * CardTitle — uses the display family at weight 300 per ADR-013. Never bold.
 * The card-heading type role from DESIGN.md.
 */
export const CardTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(function CardTitle({ className, children, ...props }, ref) {
  return (
    <h3
      ref={ref}
      className={cn('font-display text-card-heading font-light leading-tight', className)}
      {...props}
    >
      {children}
    </h3>
  );
});

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(function CardDescription({ className, ...props }, ref) {
  return <p ref={ref} className={cn('text-body-standard text-gray-dark', className)} {...props} />;
});

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardContent({ className, ...props }, ref) {
    return <div ref={ref} className={cn('p-3 pt-0', className)} {...props} />;
  },
);

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className, ...props }, ref) {
    return <div ref={ref} className={cn('flex items-center p-3 pt-0', className)} {...props} />;
  },
);
