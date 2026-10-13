import * as React from 'react';

import { cn } from '../lib/utils.js';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, type, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        'rounded-standard border-border-light text-body-standard flex h-11 w-full border bg-white px-3',
        'placeholder:text-gray-warm focus:border-brand aria-invalid:border-danger aria-invalid:bg-danger-soft/30',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'duration-fast ease-calm transition-colors',
        className,
      )}
      {...props}
    />
  );
});
