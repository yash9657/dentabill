import * as React from 'react';

import { cn } from '../lib/utils.js';

export interface BrandMarkProps extends React.SVGAttributes<SVGSVGElement> {
  readonly size?: number | string;
  readonly title?: string;
}

/** A quiet dental outline with rounded roots, designed to remain clear at small sizes. */
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
      viewBox="0 0 40 40"
      fill="none"
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn('shrink-0', className)}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <path
        d="M12.5 5.5c-4.8 0-7.8 3.3-7.2 8.5l1.8 9.9c.9 5 2.7 10.6 5.8 10.6 2.2 0 2.4-4.8 3.6-8.5.7-2.2 1.6-3.4 3.5-3.4s2.8 1.2 3.5 3.4c1.2 3.7 1.4 8.5 3.6 8.5 3.1 0 4.9-5.6 5.8-10.6l1.8-9.9c.6-5.2-2.4-8.5-7.2-8.5-3 0-4.6 1.5-7.5 1.5S15.5 5.5 12.5 5.5Z"
        stroke="currentColor"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
