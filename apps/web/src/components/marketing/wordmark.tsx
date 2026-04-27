import { BrandMark, cn } from '@dentabill/ui';
import * as React from 'react';

/**
 * Wordmark — DentaBill logo lockup used in the marketing chrome and the
 * dashboard sidebar. Brand glyph (three nested arcs) sits left of the
 * "DentaBill" wordtext at weight 300 to match the display hierarchy
 * (DESIGN.md §3, ADR-013). The mark is `currentColor` so the lockup
 * tints with the surrounding text utility — `text-black` on light
 * surfaces, `text-white` on dark surfaces.
 *
 * `aria-label` resolves to "DentaBill home" once nested in an `<a>`,
 * otherwise the visible text is the accessible name. The glyph itself
 * is decorative (`aria-hidden`) so the wordtext is the single source of
 * the accessible name.
 */
export interface WordmarkProps extends React.HTMLAttributes<HTMLSpanElement> {
  readonly size?: 'sm' | 'md' | 'lg';
  readonly markOnly?: boolean;
}

const SIZE_CLASS: Record<NonNullable<WordmarkProps['size']>, string> = {
  sm: 'text-base',
  md: 'text-lg',
  lg: 'text-xl',
};

const MARK_SIZE: Record<NonNullable<WordmarkProps['size']>, number> = {
  sm: 22,
  md: 28,
  lg: 36,
};

export function Wordmark({
  className,
  size = 'md',
  markOnly = false,
  ...props
}: WordmarkProps): React.ReactElement {
  return (
    <span
      className={cn(
        'font-display inline-flex items-center gap-2 font-light tracking-tight text-black',
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    >
      <BrandMark size={MARK_SIZE[size]} />
      {markOnly ? null : <span>DentaBill</span>}
    </span>
  );
}
