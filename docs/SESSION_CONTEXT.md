# Session Context

_Last updated: 2026-04-25 (evening)_

## What was just done

**Phase 2 W1 foundation gates: 5 of 16 done; first 9 of 55 Phase 2 tasks merged to `main`.**

This session, in dependency order:

1. **P2-T0** — ADR cluster 013–028 appended to `docs/DECISIONS.md` (16 ADRs locking visual / framework / styling / primitives / API / forms / server-state / perf / a11y / visual regression / security / auth / test pyramid / MDX / i18n+Storybook deferrals). PR #14.
2. **P2-T1** — `@dentabill/ui` OKLCH design tokens canon (`tokens.ts`) + Tailwind v4 mirror (`theme.css`) + drift-detecting test. PR #15.
3. **P2-T2** — Tailwind v4 preset (`tailwind.preset.css`) with `@theme`, `@utility` (status-pulse, shimmer, hairline-edge, shadow-card-layered), focus-visible ring, prefers-reduced-motion. PR #16.
4. **P2-T3** — 8 shadcn primitives in `@dentabill/ui` (Button, Input, Label, Card subparts, Badge, Skeleton, Separator, Avatar) themed via tokens. `cn()` with `extendTailwindMerge` so our custom class groups dedup correctly. jsdom + @testing-library/react; 93 tests. PR #17.
5. **P2-T4** — 5 brand primitives (Pill, HeroDisplay, SectionDisplay, ShadowCard, StatusDot). StatusDot's `active` variant is the only chromatic surface in the system — uses the locked teal accent with `motion-safe:status-pulse`. 24 new tests. PR #18.
6. **P2-T5** — `apps/web` Next.js 15 App Router scaffold. `next/font/google` Inter + Geist Mono. Full Metadata + Viewport on root layout. error.tsx, not-found.tsx, loading.tsx, icon.svg, robots.ts, sitemap.ts. Webpack `extensionAlias` so `@dentabill/ui`'s `.js` relative imports resolve to TS sources without a build step. 4 tests. PR #19.
7. **P2-T6** — Edge middleware with strict CSP (per-request 16-byte base64 nonce via Web Crypto, `script-src 'strict-dynamic'`), HSTS preload, X-Frame-Options DENY, COOP same-origin, COEP credentialless, CORP same-origin, Permissions-Policy denying camera/mic/geo/payment/FLoC/Topics. Production enforces; dev reports. 17 tests. PR #20.
8. **P2-T10 + T11** — Bundled because both edit `packages/config/eslint.config.js`. Adds `eslint-plugin-jsx-a11y`, `eslint-plugin-react`, `eslint-plugin-react-hooks`. **Deferred:** `eslint-plugin-tailwindcss` — v3 can't ingest Tailwind v4 CSS-first config without `tailwindcss` being a dep of `@dentabill/config`, and v4-native ESLint plugins are still pre-1.0. Class ordering delegated to `prettier-plugin-tailwindcss`; dedup remains runtime via twMerge. PR #21.

Test totals after this session: `@dentabill/ui` 117 / 117, `@dentabill/web` 21 / 21, `@dentabill/db` 30 / 30.

## Current state of the repo

- Branch: `main`. 8 new squashed commits since the morning. Working tree clean.
- 11 workspaces unchanged in count, but `apps/web` is now a real Next.js 15 app and `@dentabill/ui` is a real package with tokens + Tailwind preset + 13 components and 117 tests.
- New deps at root: `prettier-plugin-tailwindcss`. New deps in `apps/web`: `next`, `react`, `react-dom`, `lucide-react`, `tailwindcss`, `@tailwindcss/postcss`, `postcss`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/*`. New deps in `packages/config`: `eslint-plugin-{jsx-a11y,react,react-hooks}`, `prettier-plugin-tailwindcss`.
- All quality gates green: `pnpm turbo run lint` (11 packages, 0 warnings), `pnpm turbo run test` (15 task suites pass), `pnpm exec prettier --check .` clean.

## Next task

**P2-T7 — Playwright + axe foundation.** From the locked plan:

> `apps/web/e2e/` config, browsers cached in CI, base test fixture, axe-core integration, visual snapshot strategy, screenshot diff 0.1% threshold; new `e2e` job in `ci.yml`.

Estimate 3h. Branch: `phase-2/playwright-foundation`. Depends on T5 (✓ merged in #19).

After T7, the next foundation tasks are:

- **P2-T8** Lighthouse CI (depends on T5+T7) — `.lighthouserc.cjs` + new `lighthouse` job; budgets per ADR-020 (LCP ≤ 2.5s, CLS ≤ 0.1, INP ≤ 200ms, perf ≥ 90).
- **P2-T9** Bundle budget — `@next/bundle-analyzer` + custom assertion (initial JS ≤ 200KB per route, total ≤ 350KB).
- **P2-T12** Fastify v5 scaffold — independent of T7/T8/T9, can run in parallel.

Critical-path next is T28 (Clerk integration), which is unblocked by T5+T6 and only really needs T7's Playwright fixture for its own auth e2e.

## Open questions / ambiguities

- Branch protection on `main` still not enabled in the GitHub UI. Auto-merge is working per-PR but enforcement is per-PR rather than rule-bound.
- First PR after this checkpoint will exercise CI against Tailwind v4 + jsdom tests + Next.js 15 + middleware for the first time end-to-end.

## Do not forget

- One task at a time. Tests are part of the task, not a follow-up.
- Update this file + `TASKS.md` + `PROGRESS.md` + `DECISIONS.md` (ADRs only) at end of every session.
- Branch-protection in GitHub UI is still not enabled — see `docs/SECURITY.md`.
- `@dentabill/ui` ships sources directly (no build step). Any consumer (Next.js, Vitest) needs `extensionAlias` `.js → .ts`. Pattern is in `apps/web/next.config.ts`.
- Status-active teal (`oklch(0.78 0.04 200)`) is the **only** chromatic surface allowed in the system per ADR-013. Reviewers should reject any PR introducing additional brand color.
