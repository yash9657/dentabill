/**
 * Tailwind v4 PostCSS pipeline. Per ADR-015, we use the v4 CSS-first config —
 * `@tailwindcss/postcss` is the only plugin needed; no `tailwind.config.ts`.
 * Theme tokens come from `@dentabill/ui/tailwind.preset.css` which the app's
 * `globals.css` imports.
 */
export default {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};
