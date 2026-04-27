import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * BrandMark — the DentaBill glyph (three nested arcs that read as a
 * stylised speech-bubble/wave). Three concentric shapes evoke the call
 * cadence: the largest is the dial, the middle is IVR navigation, the
 * smallest is the resolved follow-up.
 *
 * Inline SVG with `fill="currentColor"` so consumers tint the mark via
 * Tailwind text utilities (`text-black`, `text-white`, `text-gray-warm`).
 * Default size is `1em` so it inlines next to a wordmark without alignment
 * gymnastics; pass `size` to override.
 */
export interface BrandMarkProps extends React.SVGAttributes<SVGSVGElement> {
  readonly size?: number | string;
  readonly title?: string;
}

export function BrandMark({
  size = '1em',
  title,
  className,
  ...props
}: BrandMarkProps): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 294 294"
      fill="currentColor"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn('shrink-0', className)}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path d="M38 0C119.186 0 185 65.8141 185 147C185 228.186 119.186 294 38 294H0V0H38Z" />
      <path d="M185 19C229.764 44.1599 260 92.0533 260 147C260 201.947 229.764 249.84 185 275V19Z" />
      <path d="M260 53C281.229 78.4786 294 111.248 294 147C294 182.753 281.228 215.521 260 241V53Z" />
    </svg>
  );
}
