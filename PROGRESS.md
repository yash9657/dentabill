# DentaBill AI — Progress

Human-friendly status report. For details see `docs/SESSION_CONTEXT.md` and `docs/TASKS.md`.

**Last updated:** 2026-04-25
**Current phase:** Phase 2 — UI + API + Ingestion **(in progress — 17/55 tasks done; W1 foundation gates 16/16 ✓)**.
**Next task:** **P2-T17** — Marketing chrome (Header / Footer / CookieBanner / NewsletterSignupStub) — kicks off W2 marketing site.
**In progress:** Nothing.

---

## Phase status

| Phase | Name                      | Status                                                                                           |
| ----- | ------------------------- | ------------------------------------------------------------------------------------------------ |
| 1     | Foundations               | **Complete** (12 of 12 tasks done, merged via PRs #1–#13)                                        |
| 2     | UI + API + Ingestion      | **In progress** — 17 of 55 tasks done; W1 foundation gates complete (PRs #14–#21, #23–#29 + T14) |
| 3     | Queue + Voice             | Queued                                                                                           |
| 4     | Intelligence + Realtime   | Queued                                                                                           |
| 5     | Deployment + cloud target | Queued (cloud decision lives here per ADR-004)                                                   |

## PRD step checklist

- [x] Step 1 — Monorepo (Phase 1)
- [x] Step 2 — Database Schema (Phase 1)
- [ ] Step 3 — Authentication (Phase 2 — Clerk wires in P2-T28)
- [ ] Step 4 — Dashboard Shell (Phase 2 — P2-T32 onward)
- [ ] Step 5 — API Server (Phase 2 — P2-T12 onward)
- [ ] Step 6 — CSV Upload (Phase 2 — P2-T43 onward)
- [ ] Step 7 — Job Queue (Phase 3)
- [ ] Step 8 — Retell Integration (Phase 3)
- [ ] Step 9 — IVR Maps (Phase 3)
- [ ] Step 10 — Call Analysis (Phase 4)
- [ ] Step 11 — Real-Time Updates (Phase 4)
- [ ] Step 12 — Cloud Deployment (Phase 5; cloud target deferred per ADR-004)

## Recent activity

- 2026-04-25 (late eve) — **Phase 2 W1 foundation gates complete (16/16).** Eight more PRs merged after the morning checkpoint:
  - **P2-T12** (PR #23) `apps/api` Fastify v5 scaffold — ZodTypeProvider, request-id, structured logger via `@dentabill/logger`, CORS, `@fastify/rate-limit`, `/v1/healthz` + `/v1/readyz`.
  - **P2-T15** (PR #24) `react-hook-form` + `@hookform/resolvers` Zod resolver wired into `@dentabill/ui` Form component; FieldError display, async submission state.
  - **P2-T7** (PR #25) Playwright + axe + visual regression foundation — `apps/web/e2e/` config, base fixture, axe-core integration, per-OS screenshots at 0.1% diff threshold, new `e2e` CI job.
  - **P2-T9** (PR #26) Bundle budget — `@next/bundle-analyzer` + custom CI assertion (≤200 KB initial JS per route, ≤350 KB total).
  - **P2-T8** (PR #27) Lighthouse CI via `treosh/lighthouse-ci-action` enforcing ADR-020 budgets (LCP ≤ 2.5s, CLS ≤ 0.1, INP ≤ 200ms, perf ≥ 90, a11y = 100).
  - **P2-T16** (PR #28) Web observability — `web-vitals` reporter (`sendBeacon` + `keepalive` fallback), `<ErrorBoundary>` posting to `/v1/errors`, `x-request-id` propagation via `<meta>` + fetch wrapper.
  - **P2-T13** (PR #29) OpenAPI generated from Zod via `@fastify/swagger` + `jsonSchemaTransform`; typed `@dentabill/api-sdk` codegen via `openapi-typescript` + `openapi-fetch`.
  - **P2-T14** (this PR) TanStack Query v5 setup at `@dentabill/ui/query` — `DENTABILL_QUERY_DEFAULTS` (30s staleTime, 5min gcTime, retry 3 with exp backoff capped at 30s, mutations no retry to prevent double-sending claims, `throwOnError` true for boundary integration), `<QueryProvider>` with lazy-loaded devtools, wired into `apps/web` via Client `<Providers>`. **Bundled CI hardening** for the two failures left by PR #29: `apps/api/vitest.setup.ts` now seeds test env defaults (DATABASE_URL/REDIS_URL/NEXT_PUBLIC_APP_URL/NEXT_PUBLIC_API_URL) via `process.env[k] ??= v`, and added the `landing-chromium-linux.png` Playwright baseline so CI's Ubuntu visual snapshot stays green.
- 2026-04-25 (eve) — **Phase 2 W1 foundations underway.** Landed eight PRs in dependency order:
  - **P2-T0** (PR #14) ADR cluster 013–028 (16 ADRs locking Phase 2 design contract — visual lock, framework, styling, primitives, API, forms, server-state, perf budgets, a11y, visual regression, security headers, auth, test pyramid, MDX, i18n + Storybook deferrals).
  - **P2-T1** (PR #15) `@dentabill/ui` design tokens — OKLCH color, shadow stack, radius, spacing, typography, motion + drift-detecting test against `theme.css`.
  - **P2-T2** (PR #16) Tailwind v4 preset — `@theme`, `@utility` (status-pulse, shimmer, hairline-edge, shadow-card-layered), focus-visible ring, prefers-reduced-motion handler.
  - **P2-T3** (PR #17) shadcn primitives — Button, Input, Label, Card, Badge, Skeleton, Separator, Avatar themed via tokens; `cn()` with `extendTailwindMerge` for custom class groups; jsdom + @testing-library; 93 tests.
  - **P2-T4** (PR #18) brand primitives — Pill, HeroDisplay, SectionDisplay, ShadowCard, StatusDot. StatusDot's `active` variant is the only chromatic surface in the system (locked muted teal accent + motion-safe pulse). 24 new tests.
  - **P2-T5** (PR #19) Next.js 15 App Router scaffold — `next/font/google` Inter + Geist Mono, RSC root layout with full Metadata + Viewport, error.tsx, not-found.tsx, loading.tsx, icon.svg, robots.ts, sitemap.ts. Webpack `extensionAlias` so `@dentabill/ui`'s `.js` imports resolve to TS sources without a build step.
  - **P2-T6** (PR #20) edge middleware with strict CSP — per-request 16-byte base64 nonce via Web Crypto, `script-src 'strict-dynamic'`, HSTS preload, X-Frame-Options DENY, COOP same-origin, COEP credentialless, CORP same-origin, Permissions-Policy denying camera/mic/geo/payment/FLoC/Topics. Production enforces; dev reports. 17 tests.
  - **P2-T10/T11** (PR #21) ESLint flat config now wires `eslint-plugin-jsx-a11y` (recommended + 3 elevated to error), `eslint-plugin-react` (flat.recommended), and `eslint-plugin-react-hooks`. `eslint-plugin-tailwindcss` deferred (v3 doesn't ingest Tailwind v4 CSS-first; v4-native plugins still pre-1.0); class ordering delegated to `prettier-plugin-tailwindcss`, dedup remains runtime via twMerge.
- 2026-04-25 (am) — **Phase 1 complete.** Closed out the Prisma trio (P1-T4 / T4A / T5). 30 tests in `@dentabill/db`. PRs #1–#13 merged on `main`.

## Decisions log

See `docs/DECISIONS.md`. Currently **30 ADRs** — 9 from Phase 1 + ADRs 010–012 (impeccable skill, SkillUI tooling, ElevenLabs-inspired DESIGN.md) + the Phase 2 cluster ADR-013 → ADR-028 added in P2-T0.

## Known issues / open questions

- Branch-protection rules still need enabling in the GitHub UI per the checklist in `docs/SECURITY.md`. Auto-merge is working on PRs but enforcement is per-PR rather than rule-bound.
- No external service credentials yet (Clerk / Retell / Anthropic / Resend / Stripe / Telnyx) — `.env.example` placeholders ready, populate as tasks activate them.
- Docker runtime is OrbStack on macOS; `docker compose up -d` from repo root brings up Postgres + Redis healthy.
