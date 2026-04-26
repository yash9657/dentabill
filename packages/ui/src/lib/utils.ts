import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Compose class names with the canonical shadcn/Tailwind pattern, taught
 * about our custom class groups.
 *
 * `clsx` handles conditional/array/object class shapes. Our extended
 * `twMerge` deduplicates conflicting Tailwind utilities, including our
 * DentaBill-custom `text-hero`/`rounded-pill`/`shadow-warm` etc. — without
 * the extension, twMerge would treat e.g. `text-button` (our font-size)
 * and `text-white` (text-color) as the same group and drop one.
 *
 * Every primitive in `@dentabill/ui` reaches for this — never write raw
 * `className={...}` joins.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      // Our typography-scale tokens — same Tailwind family as `text-sm` / `text-lg`,
      // i.e. `font-size`, NOT `text-color`. Listing them tells twMerge to dedup
      // them against each other but leave text-color utilities alone.
      'font-size': [
        {
          text: [
            'hero',
            'section-heading',
            'card-heading',
            'body-large',
            'body',
            'body-standard',
            'nav-ui',
            'button',
            'button-uppercase',
            'caption',
            'small',
            'code',
            'micro',
            'tiny',
          ],
        },
      ],
      // Our radius tokens. Same family as `rounded-md` / `rounded-lg`.
      rounded: [
        {
          rounded: [
            'minimal',
            'subtle',
            'standard',
            'comfortable',
            'md',
            'card',
            'card-large',
            'section',
            'warm-button',
            'pill',
          ],
        },
      ],
      // Our shadow tokens. Same family as `shadow-sm` / `shadow-md`.
      shadow: [
        {
          shadow: [
            'inset-border',
            'inset-dark',
            'outline-ring',
            'soft-elevation',
            'card',
            'warm',
            'edge',
            'inset-ring',
            'card-layered',
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
