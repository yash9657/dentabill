/**
 * Shared DentaBill Prettier config.
 *
 * `prettier-plugin-tailwindcss` enforces canonical class order in
 * `className`, `cn()`, `clsx()`, `cva()`, and `twMerge()` calls. It stands
 * in for `eslint-plugin-tailwindcss/classnames-order`, which cannot yet
 * load Tailwind v4 CSS-first configs without `tailwindcss` being a
 * dependency of this package. Runtime class *deduplication* is handled by
 * `tailwind-merge` via the `cn()` helper in `@dentabill/ui`.
 */

/** @type {import('prettier').Config} */
export default {
  printWidth: 100,
  singleQuote: true,
  trailingComma: 'all',
  semi: true,
  arrowParens: 'always',
  endOfLine: 'lf',
  bracketSpacing: true,
  tabWidth: 2,
  useTabs: false,
  plugins: ['prettier-plugin-tailwindcss'],
  tailwindFunctions: ['cn', 'clsx', 'cva', 'twMerge'],
};
