import { cn } from '@dentabill/ui';
import * as React from 'react';

/**
 * Wordmark — the textual DentaBill logo used in the marketing header
 * and footer. Type-set in the display family at weight 300 to match the
 * ElevenLabs-derived hierarchy (DESIGN.md §3). Kept text-only on purpose:
 * a logotype renders pixel-perfect across every device + zoom level
 * without the maintenance cost of an SVG, and lets reduced-data users
 * still see brand identity.
 *
 * `aria-label` is set so the wordmark — usually wrapped in a link to `/`
 * — exposes "DentaBill home" rather than the visible "DentaBill" only,
 * once nested inside an `<a>`. When used standalone (footer column
 * heading), the visible text is the accessible name.
 */
export interface WordmarkProps extends React.HTMLAttributes<HTMLSpanElement> {
  readonly size?: 'sm' | 'md' | 'lg';
}

const SIZE_CLASS: Record<NonNullable<WordmarkProps['size']>, string> = {
  sm: 'text-base',
  md: 'text-lg',
  lg: 'text-xl',
};

export function Wordmark({ className, size = 'md', ...props }: WordmarkProps): React.ReactElement {
  return (
    <span
      className={cn(
        'font-display font-light tracking-tight text-black',
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    >
      DentaBill
    </span>
  );
}
