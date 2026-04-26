# @dentabill/ui

Design tokens, Tailwind v4 preset, and shadcn/ui primitives for DentaBill.

Source of truth for the visual language is [`DESIGN.md`](../../DESIGN.md) at the repo root. Architecture decisions live in [`docs/DECISIONS.md`](../../docs/DECISIONS.md) (ADR-013 onwards).

## Subpath exports

| Import                              | What it gives you                                                       |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `@dentabill/ui`                     | TypeScript: `tokens` constant + `Tokens` type                           |
| `@dentabill/ui/tokens`              | Same as above; explicit subpath                                         |
| `@dentabill/ui/theme.css`           | Just the `@theme { … }` block (raw token mirror)                        |
| `@dentabill/ui/tailwind.preset.css` | Tokens + DentaBill `@utility` directives + reduced-motion + focus rules |

## Consuming from `apps/web`

```css
/* apps/web/app/globals.css */
@import 'tailwindcss';
@import '@dentabill/ui/tailwind.preset.css';
```

That's the entire setup. Tailwind v4 picks up the `@theme` block, generates utilities for every token (`bg-warm-stone`, `shadow-warm`, `rounded-pill`, `text-hero`, `font-display`, etc.), and the `@utility` directives in the preset add DentaBill-specific compositions on top (`hairline-edge`, `shadow-card-layered`, `status-pulse`, `shimmer`).

```tsx
// Direct token access in TS (rare; usually you reach for utilities)
import { tokens } from '@dentabill/ui';
console.log(tokens.color.statusActive); // "oklch(0.78 0.04 200)"
```

## What this package owns

- **Design tokens.** Authored once in `src/tokens.ts`; mirrored as CSS custom properties in `src/theme.css`. A drift test (`src/index.test.ts`) parses the CSS and asserts every value matches the TS canon.
- **Tailwind preset.** `src/tailwind.preset.css` imports the theme + adds DentaBill-specific utilities + applies WCAG 2.2 AA defaults (visible focus-visible ring, reduced-motion handling).
- **shadcn primitives** (lands in P2-T3). Vendored from the shadcn CLI with our tokens already applied; never imported from npm.
- **Brand primitives** (lands in P2-T4). Pill, HeroDisplay, SectionDisplay, ShadowCard, StatusDot.

## Two non-negotiable rules

- **Display weight is 200/300, never bold.** The lightness is the brand. ADR-013.
- **No new brand colors.** The only chromatic accent is `tokens.color.statusActive` (muted teal), used only for `CALLING` / live-call indicators. Everything else is achromatic + warm-tinted. ADR-013.

If you find yourself reaching for a color that isn't here, file an ADR before adding it.
