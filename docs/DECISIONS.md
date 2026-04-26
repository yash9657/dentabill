# Decision Log (ADR-lite)

Format: one entry per decision. Append-only. Mark `Superseded by ADR-NNN` instead of editing.

---

## ADR-001 — Adopt the PRD stack as locked for Phase 1

**Date:** 2026-04-07
**Status:** Accepted (deploy line superseded by ADR-004)
**Context:** PRD §2 lists every framework/service. Re-evaluating mid-build wastes tokens and time.
**Decision:** Treat PRD §2 as frozen for Phase 1. Any deviation must be a new ADR.
**Consequences:** Faster execution, fewer rabbit holes; future changes require explicit ADR + PRD update.

## ADR-002 — Lean docs system, PRD remains source of truth

**Date:** 2026-04-07
**Status:** Accepted
**Context:** Re-reading the full PRD every session is expensive; duplicating it is worse (drift).
**Decision:** Maintain compressed `PROJECT_BRIEF.md` + phase/task/session/rules docs. Refer back to `PRD.md` only on ambiguity.
**Consequences:** Lower context cost per session; risk of brief drifting from PRD — mitigated by never duplicating, only compressing.

## ADR-003 — Test framework: Vitest (unit) + Playwright (e2e/UI)

**Date:** 2026-04-07
**Status:** Accepted
**Context:** PRD doesn't pin a test runner. Need one consistent choice across packages.
**Decision:** Vitest for all unit/integration tests (TS-native, fast), Playwright for browser/e2e in `apps/web`.
**Consequences:** One config style across the monorepo; Playwright adds CI cost but is the standard for Next.js.

## ADR-004 — Cloud target deferred until Phase 5

**Date:** 2026-04-24
**Status:** Accepted (supersedes the deploy line of ADR-001)
**Context:** PRD §2 names Railway; the technical-plan source document pushes for AWS-from-day-1. Both are defensible; committing to either pre-revenue is premature. The user explicitly chose to defer.
**Decision:** Phase 1–4 build cloud-agnostic services. Configuration comes from env vars; external services are accessed through interfaces (`@dentabill/logger`, future `@dentabill/queue`, etc.). No Terraform, no provider SDKs, no cloud-specific APIs in application code until a real deploy target is selected. Decision criteria for Phase 5: monthly cost ceiling, BAA availability, data-residency requirements, vendor-managed Postgres + Redis on the candidate.
**Consequences:** No Dockerfiles in Phase 1 (only `docker-compose.yml` for local dev). Sentry DSN deferred. AWS-specific guidance from the .docx (Terraform, ECS, RDS, ElastiCache, KMS, CloudTrail) is preserved as Phase 5 reference, not Phase-1 work.

## ADR-005 — CI from Phase 1 (no e2e until UI lands)

**Date:** 2026-04-24
**Status:** Accepted
**Context:** Existing `docs/PHASE_PLAN.md` deferred CI to Phase 5. The .docx requires CI from day 1 ("industry standard like big tech"). The user agreed CI belongs in Phase 1.
**Decision:** GitHub Actions runs typecheck + lint + build + commitlint + format-check on every PR (`quality` job). A separate `test` job runs Vitest with a real `postgres:16-alpine` + `redis:7-alpine` service container so integration tests don't mock the DB. Playwright/e2e job lands in Phase 2 alongside `apps/web` Playwright config. Staging/production pipelines remain Phase 5 work.
**Consequences:** Every PR is gated by the same checks the engineer ran locally. Real DB tests catch ORM-level bugs. Playwright job is intentionally absent until there's a UI to test.

## ADR-006 — Commit and PR enforcement

**Date:** 2026-04-24
**Status:** Accepted
**Context:** Conventional commits were documented but not enforced. Solo dev today, but the rules need to survive the first PR from another contributor without retraining anyone.
**Decision:** Conventional Commits enforced via `commitlint` in CI (`@commitlint/config-conventional` + a `scope-enum` matching the workspaces) AND locally via Husky `commit-msg` hook. `lint-staged` runs `eslint --fix` + `prettier --write` on staged files via Husky `pre-commit`. PRs require typecheck + lint + test green and the PR template completed (especially the Security/HIPAA section).
**Consequences:** Bad commit messages and ungreen PRs cannot reach `main`. Branch-protection settings in the GitHub UI codify the rules — see `docs/SECURITY.md`.

## ADR-007 — Observability stack baseline (`@dentabill/logger` first; Sentry deferred)

**Date:** 2026-04-24
**Status:** Accepted
**Context:** Logging discipline is the cheapest HIPAA control. Sentry needs a deploy target (DSN, environment) which doesn't exist yet (ADR-004).
**Decision:** Phase 1 ships `@dentabill/logger` — pino with PHI-field redaction enforced by unit test. Every Node service must use it; raw `console.*` is an ESLint error. Sentry SDK installation is deferred to Phase 5 alongside the cloud target. Request-id middleware added when `apps/api` lands in Phase 2.
**Consequences:** PHI redaction lives in one curated list; over-redacting is acceptable, missing a path is not. New paths added in any PR that introduces a shape that could carry PHI.

## ADR-008 — Packages topology — add `packages/logger`

**Date:** 2026-04-24
**Status:** Accepted
**Context:** PRD §3 lists 6 packages (`db`, `types`, `ui`, `config`, `queue`, `payer-ivr`). Pino + redaction is shared across every Node service; placing it inside `@dentabill/config` (build tooling) or `@dentabill/types` (no runtime code) is wrong.
**Decision:** Add a 7th package — `@dentabill/logger` — owning runtime logging. Keep the rest of PRD §3 unchanged.
**Consequences:** Every Node service depends on `@dentabill/logger`. CODEOWNERS routes changes there to the maintainer.

## ADR-009 — Multi-tenancy enforcement layers

**Date:** 2026-04-24
**Status:** Accepted (P1-T4A and P1-T5 implement)
**Context:** PRD §4 calls for Prisma middleware on writes. That alone is insufficient — read-side leaks are the more likely vector.
**Decision:** Defense in depth — three layers in `@dentabill/db`:

1. Prisma `$extends` middleware (`org-scope.ts`, P1-T5) blocks writes to multi-tenant models that lack `organizationId`. Throws `MissingOrgScopeError`.
2. `getOrgScopedDb(orgId)` helper (`with-org.ts`, P1-T4A) wraps the singleton client and auto-applies `where: { organizationId: orgId }` to read methods on multi-tenant models.
3. `audit({ action, ... })` helper (`audit.ts`, P1-T4A) writes an `AuditLog` row for any PHI-touching read. Rejects calls without `organizationId`.
   **Consequences:** Three independent failsafes; any single bypass requires bypassing all three. Tests in P1-T4A/P1-T5 include "two orgs, no leak" cases. The `security-reviewer` agent checks every PR for direct `prisma.*` access against multi-tenant models.

## ADR-010 — Dependabot policy: minor/patch auto-PR, majors via deliberate review

**Date:** 2026-04-25
**Status:** Accepted
**Context:** The first Dependabot scan after merging Phase 1 opened 8 simultaneous major-version PRs (eslint 9→10, prisma 6→7, pino 9→10, lint-staged 15→16, eslint-import-resolver-typescript 3→4, plus three GHA majors). Major bumps are breaking by definition — Prisma 7 alone would invalidate the generated client and require a schema-side review. Drive-by merging during active feature work (Phase 2 UI) is the wrong forcing function.
**Decision:** `.github/dependabot.yml` ignores `version-update:semver-major` for both the npm and `github-actions` ecosystems by default. Minor + patch updates continue to auto-PR (grouped: `production-minor-patch`, `development-minor-patch`, `actions-minor-patch`). Security advisories are NEVER suppressed — Dependabot bypasses `ignore` rules for security updates, including major versions. Major bumps are addressed deliberately during a **quarterly dependency review** session that audits each major bump against release notes, runs the full quality + test gate, and lands as a single dedicated PR per high-risk dep (e.g. `chore/upgrade-prisma-v7`).
**Consequences:** PR queue stays focused on feature work. Security risk remains covered by GitHub's advisory bypass + GitGuardian + CodeQL. The cadence is documented for the next maintainer and survives staff changes — search `docs/DECISIONS.md` for "ADR-010" or look for the comment block at the top of `.github/dependabot.yml`. Lifting the major-version ignore for a one-off upgrade is intentional — comment it out, run the upgrade, restore it after the major lands.

## ADR-011 — Design tooling: Impeccable as committed skill, SkillUI via on-demand `npx`

**Date:** 2026-04-25
**Status:** Accepted
**Context:** Phase 2 (UI scaffold + dashboard) needs (a) opinionated design guidance loaded into the agent's context and (b) a way to extract real design-system tokens from reference sites we admire (Linear, Stripe, Notion, LunaBill, etc.). Two community tools cover these jobs: `pbakaus/impeccable` (a Claude Code skill — bundle of references + commands) and `amaancoderx/skillui` (a CLI that runs Playwright + static analysis to emit `DESIGN.md` + tokens + screenshots).
**Decision:** Treat them differently because they are structurally different.

1. **Impeccable** is committed under `.claude/skills/impeccable/` (PR #11) and surfaced in `CLAUDE.md`. `skills-lock.json` pins the source hash so re-installs are reproducible. Its 14 scripts are inert until invoked; only the `live` command's two scripts make outbound calls (localhost only).
2. **SkillUI** is **not** added as a devDependency. It's a 17-day-old npm package (v1.3.2 first published 2026-04-08 by `amaancoderx`) and bundling it into our supply chain is disproportionate to how often we'll run it (a handful of times per quarter). Instead, every invocation must use a pinned `npx skillui@1.3.2 …` form so each run is an explicit, deliberate call. Run only from a scratch directory outside the repo. Curated outputs land in `PRODUCT.md` / `DESIGN.md` / `references/` at repo root (where Impeccable's `load-context.mjs` looks for them).

**Consequences:** Clean composition — SkillUI fills the `DESIGN.md` slot Impeccable's setup expects; `$impeccable teach` fills `PRODUCT.md`; every Impeccable command then produces on-brand output. The version pin lives in `docs/DESIGN_TOOLING.md` (and any other place that documents the call); when we want to upgrade, we change the pin in one or two places, not across a transitive dependency tree. `.gitignore` blocks `design-extracts/` and `*.skill` to keep accidental scratch output out of the repo. If a future maintainer wants the convenience of a versioned `pnpm` script, they can add one — but the default policy is "explicit `npx` with a pinned version".

## ADR-012 — Visual direction: ElevenLabs-inspired, achromatic + warm-tinted

**Date:** 2026-04-25
**Status:** Accepted (provisional — two open decisions land alongside P2-T1)
**Context:** Phase 2 needs a `DESIGN.md` so Impeccable produces on-brand output instead of generic SaaS templates. Three reference candidates were on the table: Linear (developer ops), Stripe (fintech), ElevenLabs (voice AI). The user picked ElevenLabs and supplied a comprehensive analysis (visual theme, color palette, typography, components, layout, depth, do's/don'ts, responsive behavior, prompt guide). The fit is unusually strong — DentaBill is voice-first like ElevenLabs (we make payer calls via Retell), and the restrained Apple-like aesthetic suits a HIPAA-bound trust-heavy product better than fintech-loud or developer-dense alternatives.
**Decision:** `DESIGN.md` at repo root captures the ElevenLabs visual language adapted to DentaBill. Three substantive deltas from a literal copy:

1. **Fonts.** Waldenburg / WaldenburgFH are commercial (Lineto). We will not license them for Phase 2. Free substitute decision (Inter Display vs Manrope vs Inter weight 200/300) is open and lands alongside P2-T1 (`apps/web` scaffold). Inter (body/UI, OFL) and Geist Mono (code, MIT) are unchanged and free.
2. **Brand color.** ElevenLabs is achromatic on purpose. DentaBill keeps the achromatic base but reserves the right to add **one** tightly-rationed status accent (live-call states) — decision deferred to first dashboard review in Phase 2. No additional brand colors beyond that single accent.
3. **PHI constraint (non-negotiable).** ElevenLabs renders audio waveforms with no privacy concern. DentaBill's equivalent surface — call lists, claim statuses, eventual call playback — must never render real PHI in mockups, screenshots, demo modes, or empty states. Use synthetic data with obviously-fake names. This is enforced at runtime by `@dentabill/logger` redaction; the design layer adds a parallel constraint at the source-asset layer.

**Consequences:** Every Impeccable command from Phase 2 onward reads `DESIGN.md` and produces output aligned with this language. The two open decisions (font substitute, status-accent color) are explicitly marked in `DESIGN.md` so they don't get answered implicitly by whoever ships the first component. When SkillUI is run in Phase 2 (against ElevenLabs itself, or against complementary references like Linear/Stripe/Cron), its outputs feed back into this file as deltas — `DESIGN.md` is the single source of truth and we don't fork it.

## ADR-013 — Display font lock + single status accent — supersedes PRD §7 visual system

**Date:** 2026-04-25
**Status:** Accepted (supersedes PRD §7 _for visual system only_; the rest of PRD §7 — required shadcn components list and layout dimensions — stays in effect)
**Context:** ADR-012 left two open decisions: which display font replaces commercial Waldenburg, and whether DentaBill is strictly achromatic or allows a single status accent. Phase 2 cannot start until both are locked because every UI task touches them.
**Decision:**

1. **Display font:** `Inter Display` weight **200** (hero), weight **300** (section + card headings). `Inter` weight 400/500 for body/UI. `Geist Mono` for code. All free (OFL / MIT) and loaded via `next/font/google`. Letter-spacing tightened to `-0.96px` at 48px hero per the ElevenLabs spec. PRD §7's "Inter Bold for headings" line is superseded for display headings; PRD's `JetBrains Mono` is replaced by Geist Mono (better visual fit with the warm-tinted neutral palette).
2. **Brand color:** Achromatic + warm-tinted base, plus exactly **one** status accent — `oklch(0.78 0.04 200)` (muted teal) — used **only** for `CALLING` and live-call indicators. All other status badges (PENDING, IN_QUEUE, ON_HOLD, HUMAN_REACHED, COMPLETED, DENIED, FAILED, MANUAL_REVIEW, RESOLVED) communicate via weight + dot + label rather than color. PRD §7's full status-color map (gray/blue/yellow/green/red/orange) is **superseded** for the dashboard.

**Consequences:** PRD §7 remains in `PRD.md` unedited (per ADR-002 the PRD is never edited). This ADR is the operative source of truth for the visual system; `DESIGN.md` is the operational spec; both reference each other. Billers get one peripheral-vision color signal for "something is happening right now" without the dashboard becoming a rainbow. ESLint and the design-token export in `@dentabill/ui` enforce the achromatic constraint at the code layer.

## ADR-014 — Web framework: Next.js 15 App Router, RSC by default, no Server Actions for mutations

**Date:** 2026-04-25
**Status:** Accepted
**Context:** Next.js 15 ships two ways to write mutations from React: (a) Server Actions calling DB directly inside the Next runtime, or (b) `fetch` calls to an external API. Server Actions are ergonomic but split the API contract — some endpoints live in Fastify (`@dentabill/api`), some live as Next-internal Server Actions. Two API surfaces means two auth paths, two log streams, two HIPAA audit trails.
**Decision:** Next.js 15 App Router with React Server Components by default for **reads** (data fetching in RSC via the API SDK, server-side cache). All **mutations** go to `apps/api` (Fastify) via the typed SDK; **no Server Actions for writes**. Server Actions are permitted only for non-DB ergonomics (e.g., reading a cookie, redirecting). Edge runtime is not used in Phase 2.
**Consequences:** Single source of truth for data writes (Fastify routes; one Clerk JWT verification path; one `@dentabill/logger` request-id chain; one OpenAPI spec). Slightly more boilerplate vs Server Actions, but observability and audit posture are simpler. If a Phase 4 team wants to use Server Actions for a specific surface, they file a new ADR.

## ADR-015 — Styling: Tailwind v4 CSS-first config + design tokens in `@dentabill/ui`

**Date:** 2026-04-25
**Status:** Accepted
**Context:** Tailwind v4 (released 2026) ships a CSS-first configuration model (`@theme` directive in CSS, no JS config file required) and is faster than v3. PRD §7 says "shadcn/ui" but doesn't pin Tailwind major. Phase 1 has not yet added Tailwind to the lockfile.
**Decision:** Tailwind **v4** with CSS-first config. Design tokens live as authoritative data in `packages/ui/src/tokens.ts` (TypeScript constants), are exported as `packages/ui/src/theme.css` (CSS variables consumed by Tailwind's `@theme`), and are also emitted as JSON for any future cross-platform need. `apps/web` consumes the preset via `@import "@dentabill/ui/theme.css"` plus `tailwind.config.ts` extending `@dentabill/ui/tailwind.preset`.
**Consequences:** One source of truth for design tokens. CSS variables mean dark mode (Phase 5+) is a single-class flip. `eslint-plugin-tailwindcss` (P2-T11) enforces class ordering. Migrating to v5 later is a config-only change because we never inline arbitrary values.

## ADR-016 — Component primitives: shadcn/ui vendored in `@dentabill/ui`

**Date:** 2026-04-25
**Status:** Accepted
**Context:** shadcn/ui is the de facto React component primitive set. It is **not** an npm package — components are copied into the consumer's repo via the CLI. Two questions: (a) which workspace owns them, (b) whether to also re-export them.
**Decision:** Components are vendored into `packages/ui/src/components/**` via the shadcn CLI. `apps/web` imports from `@dentabill/ui` only — never directly from `node_modules`. We own the components: every primitive is editable, audit-able, and version-controlled. If a Radix-level upgrade breaks one, we update the component in place (and run our Vitest + Playwright snapshot tests). Components ship with our design tokens pre-applied; no consumer ever sees default shadcn styling.
**Consequences:** Our component catalog grows additively, never dependency-managed. Reviewing a Radix upgrade is a real PR with diffs and test runs (good for HIPAA audit). Onboarding a new consumer (a future `apps/admin` etc.) is a one-line workspace import.

## ADR-017 — Internal API: REST + Zod, not tRPC

**Date:** 2026-04-25
**Status:** Accepted
**Context:** The API layer between `apps/web` and `apps/api` could be tRPC (typed-procedure-call, ergonomic, strong inference) or REST (universal, OpenAPI-introspectable, easier for non-TS consumers). HIPAA audits prefer human-readable API contracts that map to wire-level transactions. Future consumers may include a CLI, a Phase 4 partner integration, or external auditors.
**Decision:** REST + Zod schemas. Fastify routes declare Zod input/output schemas via `ZodTypeProvider`. `@fastify/swagger` generates an OpenAPI spec. A `pnpm gen:sdk` step (P2-T13) generates a typed TypeScript client into `packages/api-sdk` consumed by `apps/web`. The SDK has the same DX as tRPC (full type inference) but the wire is plain JSON-over-HTTP that any HIPAA auditor or Postman user can inspect.
**Consequences:** OpenAPI is committed to the repo (`packages/api-sdk/openapi.json`); diffs in PRs are reviewable. Adding a non-TS consumer (Phase 4 CLI tool or third-party integration) is one OpenAPI-codegen run away. If type drift between server and client ever happens, the codegen step fails CI.

## ADR-018 — Forms: react-hook-form + Zod resolver

**Date:** 2026-04-25
**Status:** Accepted
**Context:** React forms have three credible options: react-hook-form (uncontrolled-by-default, fast, broad ecosystem), Formik (controlled, mature, slower), or roll-your-own. shadcn/ui's `<Form>` primitive is built around react-hook-form.
**Decision:** `react-hook-form` v7+ with Zod resolver (`@hookform/resolvers/zod`). One canonical Form pattern lives in `@dentabill/ui/forms/Form.tsx`. Every form on the site (contact, onboarding, dashboard manual edits, settings, …) uses this pattern. Zod schemas come from `@dentabill/types` or are colocated next to the form.
**Consequences:** Zero re-renders on field change (uncontrolled). Validation matches what the API will validate, because the client and server both run the same Zod schemas. New forms get sane defaults for free (loading, error, disabled-while-submitting).

## ADR-019 — Server-state: TanStack Query v5 client-side; RSC fetch server-side

**Date:** 2026-04-25
**Status:** Accepted
**Context:** Server state management on the client has converged on TanStack Query (formerly React Query). React Server Components also fetch on the server; we don't want two competing caches.
**Decision:** TanStack Query v5 for client-side server-state (lists, infinite scroll, mutations with optimistic updates). RSC `fetch` for the initial server-rendered payload. The pattern: RSC fetches via the API SDK, hydrates the page, then TanStack Query takes over for subsequent interactions. `<HydrationBoundary>` bridges the two. Devtools enabled in dev only.
**Consequences:** Default cache strategy: 30 s `staleTime`, 5 min `gcTime`, 1 retry, exponential backoff. Mutation invalidation patterns documented in `@dentabill/ui/query`. Error boundaries integrated with the global error reporter (P2-T16).

## ADR-020 — Performance budgets — Lighthouse CI

**Date:** 2026-04-25
**Status:** Accepted
**Context:** "Big-tech engineering standards" are unenforceable without a hard gate. Performance regressions are easy to introduce and invisible until production.
**Decision:** Lighthouse CI runs on every PR (job `lighthouse` in `ci.yml`, P2-T8) against a `next start` preview. Budget assertions:

- Performance score ≥ 90
- Accessibility score = 100
- Best Practices score ≥ 95
- SEO score ≥ 90
- LCP ≤ 2.5s
- CLS ≤ 0.1
- INP ≤ 200ms
- Total Blocking Time ≤ 300ms
- Initial JS per route ≤ 200KB; total ≤ 350KB (enforced separately by P2-T9)

Budgets apply to all marketing routes and `/dashboard/overview`. Other dashboard routes apply on the next iteration.
**Consequences:** A regression that drops perf below 90 fails the PR. Bypassing the budget requires a documented exception in the PR body and a follow-up issue.

## ADR-021 — Accessibility: WCAG 2.2 AA mandatory

**Date:** 2026-04-25
**Status:** Accepted
**Context:** HIPAA covered entities and their business associates are also subject to ADA digital accessibility expectations (Title III, recent DOJ guidance). Beyond compliance, accessibility is engineering quality — a site that works with a screen reader works better with everything.
**Decision:** WCAG 2.2 Level AA mandatory across every public and authenticated route. Three layers of enforcement:

1. `eslint-plugin-jsx-a11y` (P2-T10) catches static violations at lint time.
2. `@axe-core/playwright` (P2-T7) runs in every e2e test and fails on any violation.
3. Manual keyboard-only audit per route at PR time (PR template gets a checkbox).

Lighthouse a11y score = 100 is a hard gate (ADR-020). Color contrast minimum 4.5:1 for body text, 3:1 for large text. Focus indicators visible at all times (the `tw-ring` focus system, never `outline: none`). All interactive elements reachable by keyboard with logical tab order.
**Consequences:** Some shadcn primitives need additional attributes (e.g., `aria-label` on icon-only buttons); we pre-apply them when vendoring (ADR-016). PHI-touching surfaces get extra `aria-live` care so screen readers don't accidentally announce sensitive data.

## ADR-022 — Visual regression: Playwright screenshot comparison

**Date:** 2026-04-25
**Status:** Accepted
**Context:** Visual regressions are the most common UI bug source — a colorish change that breaks brand consistency, an off-by-one shadow, an unintended margin. Without a gate, they ship and get noticed in production.
**Decision:** Playwright's built-in screenshot comparison (`expect(page).toHaveScreenshot()`). Per-OS baselines (Linux baseline shipped, macOS baseline kept locally for dev). Per-route, per-component snapshots. Diff threshold: 0.1% (per `maxDiffPixelRatio`). Snapshots are committed under `apps/web/e2e/__snapshots__/`. Updating a snapshot intentionally is a normal `--update-snapshots` PR.
**Consequences:** Cheaper than Chromatic (no SaaS dep, no per-snapshot pricing). Slightly more manual review of "is this diff intended?". The PR review process gets a Playwright artifact upload that reviewers can inspect before approving. Snapshot bloat is bounded by per-route limits — no full-page pixel-by-pixel snapshots, only meaningful sections.

## ADR-023 — Security headers: strict CSP with nonce, HSTS preload, COOP, COEP

**Date:** 2026-04-25
**Status:** Accepted
**Context:** A HIPAA-covered tool that handles PHI must defend against XSS, clickjacking, and TLS-stripping at the response-header level. Defaults are insufficient.
**Decision:** `apps/web/middleware.ts` (P2-T6) issues these on every response:

- `Content-Security-Policy` — strict, nonce-based; `default-src 'self'`; `script-src 'self' 'nonce-…'`; `style-src 'self' 'nonce-…'`; `img-src 'self' data: https://*.clerk.com`; `connect-src 'self' https://*.clerk.com https://api.dentabill.…`; `frame-ancestors 'none'`; `base-uri 'self'`; `form-action 'self'`. Inline scripts + styles get a nonce per request. Report-uri to `/v1/csp-report` (Phase 5 wires it; Phase 2 just collects).
- `Strict-Transport-Security` — `max-age=63072000; includeSubDomains; preload`
- `Cross-Origin-Opener-Policy` — `same-origin`
- `Cross-Origin-Embedder-Policy` — `require-corp` (or `credentialless` if a third-party requires it)
- `X-Content-Type-Options` — `nosniff`
- `X-Frame-Options` — `DENY`
- `Referrer-Policy` — `strict-origin-when-cross-origin`
- `Permissions-Policy` — `camera=(), microphone=(), geolocation=(), interest-cohort=()`

**Consequences:** A Phase 2 e2e test asserts every header on every route (`apps/web/e2e/security-headers.spec.ts`). Adding a third-party script (Phase 3 Retell embed, etc.) requires a new ADR + CSP update. CSP violations from real users surface to `/v1/csp-report` for monitoring.

## ADR-024 — Auth model: Clerk for users + organizations, JWT verified in Fastify

**Date:** 2026-04-25
**Status:** Accepted
**Context:** PRD §2 names Clerk. Need to lock the integration shape between Next.js (where Clerk's React middleware lives) and Fastify (where the Clerk JWT must be verified for API calls). HIPAA requires a clear identity-and-authorization audit trail.
**Decision:**

- **Web side:** `<ClerkProvider>` in root layout. `clerkMiddleware()` in `middleware.ts` protects `/dashboard/**`. Clerk's `<SignIn>` and `<SignUp>` rendered on `/sign-in` and `/sign-up` themed via our design tokens. `<OrganizationSwitcher>` in the dashboard topbar.
- **API side:** Every route under `/v1/**` requires the Fastify auth plugin (P2-T37) which calls `@clerk/fastify`'s `getAuth(request)`, verifies the JWT, and attaches `{ userId, orgId }` to `request.auth`. Routes that need the org load the DentaBill-side `User` row via the JWT's `clerkUserId`.
- **Onboarding:** First sign-in with no DentaBill `Organization` row triggers `/onboarding` which creates the `Organization` + `User` rows via API call (P2-T30). After that, the Clerk org-id and DentaBill `Organization.id` are kept in sync (Clerk webhook in Phase 3).
- **No Server Actions write** path (per ADR-014); auth is one place, one path, one log stream.

**Consequences:** Branch protection in Phase 2 gets Clerk dev keys in `.env.example`. Production keys land Phase 5 with cloud. Clerk's session cookie is the only auth token the browser holds. Every audit log entry has a verified `userId` + `organizationId`.

## ADR-025 — Test pyramid: Vitest (unit/integration) + Playwright (e2e + visual + a11y)

**Date:** 2026-04-25
**Status:** Accepted (extends ADR-003)
**Context:** Phase 1 chose Vitest + Playwright (ADR-003) but didn't lock the layering, coverage targets, or visual/a11y integration. Phase 2 needs that lock.
**Decision:** Three layers, in order of cardinality:

1. **Unit / integration (Vitest, ~hundreds of tests)** — co-located `*.test.ts`. Pure functions, hooks, components rendered in jsdom for shape/behavior, integration tests against real Postgres for any code touching `@dentabill/db`. Coverage threshold **80%** on business-logic packages (`db`, `queue`, `payer-ivr`, `api` routes, workers). UI-only components are exempt from numeric coverage but must have at least one render test.
2. **Component snapshot (Playwright, ~tens of tests)** — `apps/web/e2e/components/*.spec.ts`. Each brand primitive rendered in isolation in a real browser, screenshot-compared with 0.1% threshold (ADR-022). Catches visual regressions Vitest jsdom can't see.
3. **End-to-end (Playwright, ~tens of tests)** — `apps/web/e2e/journeys/*.spec.ts`. Full user journeys: signup → onboarding → upload CSV → see claims → edit one. Cross-browser (chromium, webkit, ff). Each test runs axe-core (`@axe-core/playwright`) for a11y; failures block.

Mocking the database is forbidden in integration tests (PRD rule). Mocking external HTTP services (Clerk, Resend, eventually Retell) is permitted at the wire boundary via MSW.
**Consequences:** Test count grows fast but selective. Coverage report shipped on every PR; >80% drop fails the gate. Playwright traces uploaded as CI artifacts on failure for debug.

## ADR-026 — Marketing content: MDX for static pages, no CMS in Phase 2

**Date:** 2026-04-25
**Status:** Accepted
**Context:** Marketing pages need content (about, FAQ, blog, terms, privacy). Options: hand-written `.tsx`, MDX, or a CMS (Sanity, Contentful, Payload). Solo dev + small content volume = CMS is overkill.
**Decision:** MDX for `/about`, `/faq`, `/blog/*`. Content collections via `@content-collections/next` (lightweight, file-based, type-safe frontmatter). Hand-written `.tsx` for `/`, `/pricing`, `/security`, `/privacy`, `/terms`, `/contact` (these have layout logic, not just content). No CMS in Phase 2. Resend SDK is referenced but **not wired to actually send** in Phase 2 — contact form posts to API which logs and returns success; real send wires in Phase 3 alongside notifications.
**Consequences:** Content is git-versioned (good for HIPAA audit). Rendering MDX on the server keeps client JS small. If we ever need a CMS, swapping in Sanity is a per-route migration without re-architecting.

## ADR-027 — i18n deferral: English-only Phase 2

**Date:** 2026-04-25
**Status:** Accepted
**Context:** Building i18n infra now (next-intl, message files, locale-aware routing) is real overhead for solo dev. Building it in later requires touching every component that has user-visible text.
**Decision:** English-only in Phase 2. **Reserve the pattern**: every component that uses user-visible text imports a single `t()` from a future `@dentabill/i18n` package — Phase 2 ships a stub that returns the input unchanged. When Phase 5 wants real i18n, the stub is swapped for `next-intl` and we extract messages mechanically. No hardcoded strings; all UI copy lives in a typed message object next to the component.
**Consequences:** Slight upfront discipline (no inline strings) but no refactor cost later. The PR template reviewer-checklist gets a "no inline strings outside `t()`" line.

## ADR-028 — Storybook deferral: component tests via Vitest + Playwright snapshots

**Date:** 2026-04-25
**Status:** Accepted
**Context:** Storybook is the industry standard for component documentation and visual development, but it's heavy: separate dev server, separate config, separate addons, story-write overhead, Chromatic-or-similar for snapshots. With one engineer and a vendored shadcn primitive set (ADR-016), the marginal value over Vitest + Playwright snapshots (ADR-022) is small.
**Decision:** No Storybook in Phase 2. Component-level testing happens in Vitest (jsdom, behavior) + Playwright (real browser, snapshot per ADR-022). Component "documentation" lives as JSDoc on the component plus a short MDX README in the package. Storybook can be added in Phase 5 if a designer joins the team and benefits from a visual catalog.
**Consequences:** No `.storybook/` config, no `*.stories.tsx` files, no Chromatic dep. Saves ~2 days of setup and ~1 hour per component going forward. If a future engineer wants Storybook, they file a new ADR.

## ADR-029 — `/terms` ships as in-house template; attorney review before public production

**Date:** 2026-04-26
**Status:** Accepted
**Context:** The marketing site needs a `/terms` page so the footer and the future contact / sign-up flows can link to one. Drafting attorney-reviewed terms before any public copy lands is expensive in time and money for a pre-revenue product. Holding the page indefinitely (as a stub) is also wrong because security reviewers and prospective customers expect to see something real before signing a BAA.
**Decision:** Ship a plain-English template `/terms` page in P2-T23 with a prominent draft-status note at the top (`role="note"`, copy explicitly saying "draft template"). Per ADR-029 the commitment is: attorney-reviewed terms replace this draft before we accept paid customers in production. Until then, prospects requiring redline get a marked-up version on request to `legal@dentabill.example`. Governing-law clause provisionally set to Delaware; that is reviewed alongside the rest of the document.
**Consequences:** The site has a real Terms link working today. Customers can read it during evaluation. We carry a known follow-up: replace the template with reviewed text. The follow-up is tracked as a Phase 5 acceptance criterion (cloud target / production launch); the task gate will not let production deploy ship without it.

## ADR-030 — Phase 2 retrospective: what worked, what to fold into Phase 3

**Date:** 2026-04-26
**Status:** Accepted
**Context:** Phase 2 closed with 54 of the 55 planned tasks merged across 51 PRs in two working days. The lone deferred task is T52 (`PRODUCT.md` via `$impeccable teach`), which requires interactive Claude Code skill invocation and is appropriately a follow-up. Capturing what to keep doing — and what to stop doing — before Phase 3 (Queue + Voice) opens.

**Decision:** Lock the following process changes. Each is one sentence; the rationale is in the consequences.

1. Keep the **one task → one branch → one PR** discipline. It paid off: every CI failure landed in a small PR where the cause was obvious, and merging often kept the conflict surface tiny.
2. Keep **bundling truly co-shipped tasks** (T48 + T49) when their tests are the same file. The retroactive split adds two empty PRs and no clarity.
3. Keep the **conditional Clerk gating** pattern — the same `hasClerkKeys` boolean in middleware, providers, route pages, and the API auth plugin — so dev/CI without keys has a clean fallback that doesn't crash hooks. Phase 3's call-worker should reuse this for Retell keys.
4. Keep the **Impeccable design laws on every UI PR** (no em dashes in copy, no card grids, no side-stripe banners, no glassmorphism, no hero-metric template). Reviewer cost is low; visual drift cost is high.
5. **Stop** branching from main when the previous PR for the same package is still in flight if we know there will be a doc-file conflict on `docs/TASKS.md`. Either merge first, or don't touch TASKS.md until landing. The merge-commit dance for #58/#59/#60 cost ~20 min and several CI re-runs.
6. **Keep** writing per-row error returns instead of per-row throws (T44, T48). The CSV ingestion and parser surfaces are dramatically better for billers than a binary "the upload failed".
7. **Keep** the **client-side mirror of server-authoritative rules** pattern (state-machine in T40 + T42; payer canonicalisation already lives entirely in `@dentabill/payer-ivr`). Two-layer validation gives clear UX without giving up the server's authoritative role.
8. **Keep** **inline integration tests against real Postgres** for write paths. The cross-org leak guards in `/v1/claims` and `/v1/ingest/claims` would have been impossible to verify with mocks.

**Consequences:** Phase 3 (T52 PRODUCT.md follow-up + Queue + Voice) inherits a clean baseline: 7 CI gates green on every PR, 220+ tests, bundle budgets respected, visual regression baselines per OS, and the full ingestion path proven end-to-end. The merge-commit pain in §5 is the one rough edge to fix early — Phase 3 should land its in-flight PRs serially when they share `docs/TASKS.md` lines, or batch the doc updates into a final closeout.
