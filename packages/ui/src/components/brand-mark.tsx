import * as React from 'react';

import { cn } from '../lib/utils.js';

export interface BrandMarkProps extends React.SVGAttributes<SVGSVGElement> {
  readonly size?: number | string;
  readonly title?: string;
}

/** An open D with an inset return, drawn as one solid shape for small sizes. */
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
        d="M5 5h14c8.84 0 16 6.72 16 15S27.84 35 19 35H5V17h13a3 3 0 0 1 0 6h-6v5h7c4.97 0 9-3.58 9-8s-4.03-8-9-8H5Z"
        fill="currentColor"
      />
    </svg>
  );
}
