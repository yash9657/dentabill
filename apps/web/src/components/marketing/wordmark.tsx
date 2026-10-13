import { BrandMark, cn } from '@dentabill/ui';
import * as React from 'react';

/** Shared dental symbol and wordmark lockup; the symbol is decorative beside the name. */
export interface WordmarkProps extends React.HTMLAttributes<HTMLSpanElement> {
  readonly size?: 'sm' | 'md' | 'lg';
  readonly markOnly?: boolean;
}

const SIZE_CLASS: Record<NonNullable<WordmarkProps['size']>, string> = {
  sm: 'text-base',
  md: 'text-[23px]',
  lg: 'text-[28px]',
};

const MARK_SIZE: Record<NonNullable<WordmarkProps['size']>, number> = {
  sm: 22,
  md: 34,
  lg: 40,
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
        'font-body text-brand inline-flex items-center gap-2 font-semibold tracking-[-0.03em]',
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
