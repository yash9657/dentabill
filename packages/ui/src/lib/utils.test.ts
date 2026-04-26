import { describe, expect, it } from 'vitest';

import { cn } from './utils.js';

describe('cn()', () => {
  it('joins simple class strings', () => {
    expect(cn('foo', 'bar')).toBe('foo bar');
  });

  it('handles falsy values via clsx', () => {
    expect(cn('foo', false, null, undefined, 'bar')).toBe('foo bar');
  });

  it('handles object/array shapes from clsx', () => {
    expect(cn({ foo: true, bar: false }, ['baz'])).toBe('foo baz');
  });

  it('deduplicates conflicting Tailwind utilities (twMerge)', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-red-500', 'text-blue-500')).toBe('text-blue-500');
  });

  it('preserves non-conflicting utilities', () => {
    expect(cn('p-2', 'm-4')).toBe('p-2 m-4');
  });

  // Note: tailwind-merge does NOT know about our DentaBill-custom class names
  // (e.g. `rounded-pill` vs `rounded-card`, `text-hero` vs `text-body`).
  // Both classes get appended; CSS cascade resolves the conflict at runtime.
  // If we ever want compile-time deduplication of custom classes, configure
  // `extendTailwindMerge` with our class groups in this file. Not done yet —
  // YAGNI until a regression appears.
});
