import * as React from 'react';

import { cn } from '../lib/utils.js';

/**
 * Input — minimal text input. White background, light border, body-standard
 * type scale, focus-visible handled globally by `tailwind.preset.css`.
 *
 * Placeholder uses `text-gray-warm` per DESIGN.md (warm muted, not cool gray).
 */
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
        'rounded-standard border-border-light text-body-standard flex h-10 w-full border bg-white px-2',
        'placeholder:text-gray-warm',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'duration-fast ease-calm transition-colors',
        className,
      )}
      {...props}
    />
  );
});
