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

## ADR-031 — Clerk Organizations deferred; synthetic `clerkOrgId = "local_<userId>"` for single-seat orgs

**Date:** 2026-04-26
**Status:** Accepted (carry-over from Phase 2; formalised as Phase 3 opens)
**Context:** The Phase 2 onboarding endpoint (`apps/api/src/routes/v1/onboarding.ts`) creates an `Organization` row plus a `User` row when a Clerk-authenticated user lands on `/onboarding` for the first time. `Organization.clerkOrgId` is `@unique`. Clerk Organizations (multi-seat practices, invitation flow) are not used in Phase 2 — the onboarding UX is single-seat-only — so we need a deterministic synthetic `clerkOrgId` to satisfy the unique constraint without prematurely modelling Clerk's `org_*` namespace.
**Decision:** For single-seat orgs created by the onboarding endpoint, stamp `clerkOrgId = "local_<clerkUserId>"`. The `local_` prefix is the load-bearing invariant: any `Organization` whose `clerkOrgId` starts with `local_` is single-seat and cannot have collaborators added until it is migrated to a real Clerk Organization. Phase 4 introduces the multi-seat flow: when an admin invites their first collaborator we create a real Clerk Organization, copy the `org_*` ID into `clerkOrgId`, and audit-log the migration. Code that reads `clerkOrgId` MUST NOT assume the Clerk Org API can be queried with it; use the prefix check to short-circuit.
**Consequences:** Phase 3's Retell webhook and call-worker can resolve `organizationId` → `clerkOrgId` the same way for both single-seat and (future) multi-seat orgs, since the column is non-null and unique throughout. The Phase 4 migration does not require a backfill — only a one-time Prisma update per org as collaborators are invited. Cross-cutting tests assert that synthesised IDs are never sent to Clerk's Org API.

## ADR-032 — Retell agents: per payer (three agents in Phase 3)

**Date:** 2026-04-26
**Status:** Accepted
**Context:** Phase 3 makes the first real payer call. Retell agents carry the LLM prompt the model uses when speaking to a human rep — the persona, the script, the information-gathering checklist (PRD §6 lines 425–434), the boundaries on what the agent will and will not say. Two structurally different options: (a) one universal agent with a payer parameter the prompt branches on, (b) one Retell agent per payer.
**Decision:** Three Retell agents — `delta-dental-ppo`, `cigna-dental`, `metlife-dental`. Per-payer prompts ship in `packages/payer-ivr/src/agents/<payer>.ts` next to that payer's IVR map and DTMF timing rules. The agent's Retell ID is provisioned out-of-band and recorded in `.env.example` as `RETELL_AGENT_ID_DELTA_DENTAL_PPO=`, etc. The `Call.retellAgentId` column already exists in the schema — the call-job handler stamps it from the resolved agent for that payer.
**Consequences:** Three agent IDs to keep in sync (env + Retell dashboard) instead of one. Net win: a Cigna prompt change does not require re-validating Delta or MetLife conversations; payer-specific information collection (e.g. Cigna asks for Group Number where Delta does not) lives in the payer's own prompt instead of a branching super-prompt. Adding a 4th payer in Phase 4+ is one new file in `packages/payer-ivr/src/agents/` plus one new env var.

## ADR-033 — Retell SDK abstraction: `RetellPort` interface with `FakeRetell` and `LiveRetell` adapters

**Date:** 2026-04-26
**Status:** Accepted
**Context:** The call-worker handler must place outbound calls and receive transcript/event webhooks. `retell-sdk` is the only adapter that can actually do that, but tests cannot — and must not — make real outbound phone calls in CI. Without an abstraction the handler either embeds the SDK and is therefore untestable end-to-end, or it embeds an `if (process.env.NODE_ENV === 'test')` branch that diverges the production code path.
**Decision:** `packages/payer-ivr` exports a `RetellPort` TypeScript interface with `startCall`, `endCall`, `onWebhook` typed contracts. Two adapters implement it:

1. `FakeRetell` — pure in-process state machine that consumes a payer IVR map and emits webhook events synchronously in test code. Deterministic, no network. Used by every Vitest integration test and the call-worker's full-lifecycle e2e test (P3-T15).
2. `LiveRetell` — wraps `retell-sdk`, lazy-loaded so dev/CI without `RETELL_API_KEY` does not error on import (matches the `hasClerkKeys` pattern from ADR-024 / ADR-030). Only adapter that touches the network.

The call-job handler, IVR navigator, and hold detector all depend on `RetellPort`, never on a concrete adapter. Adapter selection happens once at worker boot from a single env-driven factory.
**Consequences:** A failing call-lifecycle test means our logic is broken, not Retell's cloud — flake in this layer is always a real bug. Swapping Retell for another voice provider in the future is a new adapter, not a rewrite. The contract test asserts both adapters honour the same interface (input → output equivalence at the port boundary).

## ADR-034 — Phase 3 UI scope: Call-Now Pill, live indicator, Calls list page only

**Date:** 2026-04-26
**Status:** Accepted
**Context:** The visible part of "the first real payer call" could be anything from a single button to a full live-transcript theatre. Building the latter in Phase 3 means designing an SSE stream, a transcript-rendering component, and a polished "live" interaction in parallel with the queue, the worker, the IVR navigator, and the webhook contract — and getting any of them wrong leaks into the others.
**Decision:** Phase 3 ships exactly three UI surfaces:

1. **"Call now" pill** on each row in `/dashboard/claims` and on the claim detail page. Uses the existing `Pill` brand primitive, mutation goes through the SDK, optimistic state, error toast.
2. **Live status indicator** — the muted teal status accent (`oklch(0.78 0.04 200)` per `DESIGN.md`) finally activates here; lights up for `IN_QUEUE`, `CALLING`, `ON_HOLD`. Subtle pulse animation respects `prefers-reduced-motion`.
3. **`/dashboard/calls` page** — virtualized table of `Call` rows with status, duration, payer, claim link. List updates via TanStack Query polling: 5s while any row is `CALLING`, 30s otherwise.

No live transcript view, no in-progress call modal, no SSE infra. Phase 4 (when the Claude post-call summarizer produces transcript text and a structured summary) is the right time to design the live surface in one go.
**Consequences:** A biller in Phase 3 sees a definite state machine — they fired a call, the dashboard moves through states with a visible accent, the call appears in the list when it ends. They do not see the LLM's words in real time. The polling interval is calibrated to never burn more than ~12 requests per minute per active biller; SSE in Phase 4 will replace polling for `CALLING` rows specifically.

## ADR-035 — Queue topology: single `calls` queue + `calls-dlq`, retry backoff 30s/2m/8m

**Date:** 2026-04-26
**Status:** Accepted
**Context:** BullMQ's data plane gives us many degrees of freedom — number of queues, retry policy, dead-letter routing, job priority, concurrency per worker. PRD §6 says hold times of 5–20 minutes are normal; a job runs roughly that long. The denial of service we are most exposed to is a failing payer line silently retrying forever.
**Decision:**

- **One queue: `calls`.** Sharding by payer wastes capacity; Phase 3 has three payers and one worker process. Job priority within `calls` is set from `Claim.priority` (PRD §5 formula).
- **One DLQ: `calls-dlq`.** Reasons captured in the new `Call.dlqReason` text column (P3-T8 migration). The DLQ consumer (P3-T14) is a separate `Worker` instance.
- **Retry policy:** `attempts: 3`, `backoff: { type: 'exponential', delay: 30_000 }` → 30s / 2m / 8m. After three failures the job is routed to `calls-dlq` and the claim transitions to `MANUAL_REVIEW`.
- **Retention:** `removeOnComplete: { age: 86_400 }` (24h), `removeOnFail: false` (so DLQ inspection is always possible).
- **Concurrency:** the `Worker` runs with `concurrency: 4` initially — calibrated to Retell's outbound-call limit and our Postgres connection pool; tunable via env.

**Consequences:** A retell outage produces a contained DLQ buildup that ops can drain; it does not loop forever or starve the queue. Adding a 4th payer never requires a new queue. Retention keeps the BullMQ admin UI usable while preserving DLQ rows for HIPAA audit.

## ADR-036 — Webhook signature: HMAC-SHA256 of raw body, constant-time compare, replay protection

**Date:** 2026-04-26
**Status:** Accepted
**Context:** Retell delivers call lifecycle events via HTTP webhook. An unauthenticated webhook endpoint is a direct path to forging call status, denial codes, and transcript content into our DB — the highest-severity vulnerability in the Phase 3 surface area.
**Decision:**

1. Verify HMAC-SHA256 of the **raw body** (not parsed JSON) against `RETELL_WEBHOOK_SECRET` using `crypto.timingSafeEqual`. The Fastify route registers `addContentTypeParser('application/json', ..., { parseAs: 'buffer' })` so the raw bytes are available; only after verification do we `JSON.parse`.
2. Reject with `401 ApiError code=invalid_signature` on header missing, length mismatch, or compare failure. Constant-time compare on every path so timing attacks cannot distinguish the failure modes.
3. Replay protection: a `WebhookEvent { id PRIMARY KEY, eventId UNIQUE, receivedAt }` table records every accepted Retell `eventId`. Re-delivery returns `200 ok` (idempotent), tampered re-delivery is caught by HMAC. Old rows are pruned weekly.
4. The route MUST log neither the secret nor the raw body. PHI redaction in `@dentabill/logger` (P3-T26) covers the parsed event shape.

**Consequences:** A leaked secret is the only way an attacker can forge a Retell event; rotation is documented in `docs/RUNBOOK.md` (P3-T28). Replays are no-ops, which is the safe default for at-least-once webhook delivery. The cost is one row per webhook event — at expected volume (~100 events/call, ~50 calls/day for one practice) that is ~5k rows/day per practice, well within Postgres budgets.

## ADR-037 — Business-hours guard: enforced at enqueue (API), not at worker pickup

**Date:** 2026-04-26
**Status:** Accepted
**Context:** Calls placed outside payer business hours (PRD §6: e.g. Delta Dental PPO is 8am–5pm CT) waste a Retell call slot and produce a guaranteed voicemail. The check could live (a) at enqueue in the API, (b) at job pickup in the worker, or (c) both.
**Decision:** Single source of truth is the API enqueue route (`POST /v1/claims/:id/calls`). It calls `isWithinPayerHours(payerCode, new Date())` from `@dentabill/payer-ivr` (P3-T4) and rejects with `409 ApiError code=outside_business_hours` if the window is closed, returning the next opening time so the UI can render an informative tooltip on the disabled "Call now" pill.

The worker does NOT re-check at pickup. Rationale: a job that sits in the queue for 8 minutes (BullMQ retry backoff) and crosses a closing-time boundary is rare, and re-checking introduces a state where the API said yes and the worker says no — surface area for confusing biller UX. If the gap becomes a real issue we revisit (one ADR away), but the structural simpler choice is one check, at the front door.
**Consequences:** Tooltip + disabled pill is the user-visible artefact when a payer's window is closed. The integration test (P3-T16) uses `vi.setSystemTime` to assert both inside-hours acceptance and outside-hours rejection. Daylight-saving transitions are handled by `Intl.DateTimeFormat`-backed timezone resolution, not manual offset arithmetic.

## ADR-038 — Per-call hard cap: 15 minutes → DLQ + claim `MANUAL_REVIEW`

**Date:** 2026-04-26
**Status:** Accepted
**Context:** Retell calls are not free and not instant. A run-away call — IVR maps a stuck voice prompt the LLM cannot handle, a payer route hangs the line, a transcript loop confuses the agent — could rack cost without producing a useful claim status. Production hold times peak at 20 minutes (Cigna upper bound, PRD §6 line 410), so 15 min is a calibrated ceiling for _active_ call duration after the IVR is navigated; expectation is that most successful calls finish in under 10 min.
**Decision:** `MAX_CALL_DURATION_MS = 900_000` (15 minutes). The hold detector (P3-T12) and a wall-clock guard inside the call-job handler (P3-T13) both enforce this. On breach: end the Retell call, write `CallEvent type=ESCALATED` with the duration, transition the `Claim` to `MANUAL_REVIEW`, route the BullMQ job to `calls-dlq` with `dlqReason='exceeded_max_duration'`. No automatic retry of an escalated claim — a human reviews.
**Consequences:** A pathological call costs at most 15 minutes of Retell time. Billers see escalated claims in `MANUAL_REVIEW` with the timing reason recorded. The cap is env-overridable for staging where we may want a tighter loop on long-call debugging.

## ADR-039 — Hold-time policy: 10 min hold → tear down + reschedule, max 2 attempts/claim/day

**Date:** 2026-04-26
**Status:** Accepted
**Context:** Holding for a rep that never picks up burns the same Retell budget as an active call. PRD §6 estimated holds: Delta 5–12 min, Cigna 8–20 min, MetLife 6–15 min. The 90th-percentile case is ~15 min; longer than that almost certainly indicates a saturated payer line that re-attempting later is more productive than continuing to hold.
**Decision:** `MAX_HOLD_MS = 600_000` (10 minutes of _uninterrupted_ hold, distinct from total call time in ADR-038). The hold detector (P3-T12) tracks the most recent rep-speech timestamp via Retell's transcript stream; if the gap exceeds `MAX_HOLD_MS` and `Call.status === ON_HOLD`, the worker calls `RetellPort.endCall`, increments `Call.attemptNumber`, and re-enqueues the job at a 1-hour backoff up to a per-day cap of **2 attempts per claim per calendar day** (timezone: payer's own; see ADR-037). After two attempts the third miss escalates to `MANUAL_REVIEW`.
**Consequences:** Worst case for a single claim on a saturated payer: 2 × ~10 min hold + tear-down per day, then human review. The 2-attempts cap is enforced by querying `Call` rows for the same `claimId` whose `createdAt` falls within the payer-local day; the read is cheap given `idx_call_session_claim_status` (P3-T8). Tunable via env for CI / staging.

## ADR-040 — PHI in call audio: never downloaded, retained only by Retell under their BAA

**Date:** 2026-04-26
**Status:** Accepted
**Context:** Retell records call audio. That audio contains PHI (subscriber names, dates of birth, member IDs spoken aloud by the rep). HIPAA requires a clear data-flow boundary: who holds PHI, under what BAA, and for how long.
**Decision:** DentaBill never downloads, copies, or proxies Retell call audio. Recordings remain in Retell's storage under their HIPAA BAA — which we have signed before any production traffic. We persist only:

1. The **structured outcome** the agent extracts (status, denial code, reference number, etc.) — this is the value the dashboard surfaces.
2. The **transcript text** that lands via webhook — already redacted-by-policy in `@dentabill/logger` (P3-T26 adds `transcriptText` to redact paths) but stored in plain text in `CallEvent.data` for audit. PRD §5 covers this.
3. A **link** to Retell's recording URL for human review when needed; clicked rarely and only by authenticated users with org-scoped RBAC.

Storing the audio ourselves would require encrypting at rest with a managed key, a retention policy, deletion workflow, and a second BAA path (cloud storage). None of that adds value for billers; it adds cost and risk.
**Consequences:** Retell is in our PHI inventory (`docs/SECURITY.md`). The recording-URL access is audit-logged. If we ever need to leave Retell, the migration plan involves a one-time export of historical recording URLs per claim — not a bulk audio download. Short retention windows for audio (Retell's defaults) are an explicit tradeoff: investigations beyond N days rely on transcript text, not raw audio.

## ADR-041 — Phase 3 retrospective: lessons feeding Phase 4

**Date:** 2026-04-29
**Status:** Accepted
**Context:** Phase 3 (Queue + Voice) shipped 31 tasks (T0 + T30) over the planned ~64-hour envelope. The platform now places real outbound calls, navigates the IVR via DTMF, persists structured `Call` + `CallEvent` rows, and surfaces the live phase to the operator through the dashboard. Phase 4 (Claude post-call summarization, Stripe billing, Clerk Organizations) starts from this baseline. This ADR captures what we'd do differently and the decisions that should not survive contact with Phase 4.

### What worked (keep doing)

- **Port-and-adapters for Retell (ADR-033).** `FakeRetell` paid for itself on the first day. The full lifecycle e2e (P3-T15) hits real BullMQ + real Postgres + a deterministic `FakeRetell`; flake = bug-in-our-logic, not bug-in-someone-else's-cloud. Carry this forward to the Claude summarizer in Phase 4 (`SummarizerPort` + `FakeClaude` + `LiveClaude`).
- **Per-payer agent prompts (ADR-032).** Three agents was the right call — each prompt diverged enough that one universal prompt would have been a tangled super-prompt by the end of Phase 3. The cost (3× Retell agent management) was negligible.
- **Single shared mapping helper for status visuals (`statusIndicatorVariant` / `callStatusIndicatorVariant`).** Centralising "what does this status look like" in one helper per resource killed an entire class of UI drift bug and made the live-indicator unlock (T23) a 30-line change instead of a whack-a-mole edit. Apply the same pattern to Phase 4's summary-confidence band visuals.
- **Soft-cancel as a Phase 3 limitation (P3-T20).** Shipping the dashboard cancel button without a true cancel channel was the right tradeoff — operators get the marker, the dashboard reflects the decision, and the Phase 4 worker pub/sub bridge is a clean follow-on. Document limitations explicitly in ADRs and `SESSION_CONTEXT`; future-us thanks present-us.
- **OpenAPI as the contract.** `pnpm gen:sdk` chained from Fastify swagger output was zero-friction once T21 nailed the env-stub ordering. The SDK contract test (P3-T21) catches "added a route, forgot to regen" the moment a path goes missing from the typed paths union.

### What didn't work (change before Phase 4)

- **Stacked-PR autoclose pain.** Multiple PRs auto-closed when their base branch was deleted on merge. Recovery (rebase onto main + force-push + reopen) added ~15 minutes per occurrence. **Decision:** Phase 4 lands feature work as squashed PRs against `main` directly — no stacking unless the dependency is genuinely sequential, and even then base on the un-merged PR's head only after explicit confirmation.
- **Test DB concurrency between API and call-worker tests.** Both suites truncate the same Postgres test DB, so running them in parallel under turbo intermittently trips the webhook-replay test on the unique-on-`eventId` constraint. CI sidesteps this (separate jobs); local turbo doesn't. **Decision:** Phase 4 introduces per-suite schema namespaces (`SET search_path TO test_<suite>`) before any new write-heavy suites land; until then, `--concurrency=1` for the local case is acceptable.
- **Empty-string env defaults bit twice.** `RETELL_WEBHOOK_SECRET=` (empty) in the root `.env` template slipped past `??=` first in `vitest.setup.ts`, then again in `apps/api/scripts/dump-openapi.mts`. **Decision:** the env loader (`apps/api/src/lib/env.ts`) should normalise empty strings to undefined at the boundary so consumers don't keep reinventing the same fallback. Capture as a Phase 4 cleanup ticket.
- **`subscriberId` placeholder = `claimNumber`.** P3-T10 papered over a schema gap (no `subscriberId` column on `Claim`) by passing `claimNumber` as the agent metadata field. Most payer reps locate a claim by `claimNumber + DOS` so the agents work, but the semantic mismatch is a Phase 4 schema migration we cannot defer further — Aetna in particular requires the subscriber id verbatim.

### Lessons for Phase 4

- **The summarizer needs port-and-adapters from day one.** Same shape as `RetellPort`: `SummarizerPort.summarize(callId)` → structured outcome; `FakeClaude` returns deterministic per-test fixtures; `LiveClaude` wraps `@anthropic-ai/sdk`. Phase 4's ADR cluster should land this contract before any code that calls Claude.
- **Live transcript view is now the right ergonomic add.** ADR-034 deferred it to Phase 4 because we didn't yet have transcript text to display. We do now. Build the `/dashboard/calls/[id]` transcript surface as an SSE stream — the polling cadence we shipped in T24 (5s/30s) is acceptable for the table, but the transcript itself is more like a chat surface and SSE removes the "did the operator just miss the rep speaking?" anxiety.
- **Stripe integration cuts in cleanly along the existing audit-log spine.** Phase 3's `audit()` extension (T27) means every call that recovers $ is already keyed to org+actor+claim. Stripe billing in Phase 4 is "iterate `AuditLog` for `call.end` events whose Claim transitioned to RESOLVED in the last billing window, sum the recovered amount, post a usage record" — no new instrumentation required.
- **Multi-seat / Clerk Organizations needs a `User → DentaBillUser` reconciliation pass** that doesn't exist today (ADR-031 tracks the deferral). Phase 4 should land that migration first, before the org-switch UI, so the billing surfaces don't ship with synthetic `clerkOrgId = "local_<userId>"` values still leaking through.

**Decision:** This retrospective is the canonical hand-off from Phase 3 to Phase 4. Subsequent phases should append their own retro ADR at exit, not amend this one.
**Consequences:** The "carry forward" items above are inputs to `docs/PHASE_PLAN.md` Phase 4 sketch (P3-T30 doc closeout). The "change before Phase 4" items file as cleanup tickets in `docs/TASKS.md` under a new `Phase 4 prep` section.

## ADR-042 — Summarizer port-and-adapters with cost-guard atomicity

**Date:** 2026-05-06
**Status:** Accepted
**Context:** Phase 4 introduces post-call summarization via Claude. The seam needs the same isolation Phase 3 gave Retell: tests must be deterministic and free, prod must call the real model. Two extra concerns make a thin SDK wrapper insufficient. First, Claude is a token-metered cost centre — a runaway loop or unexpectedly long transcript can burn the daily budget in minutes. Second, Claude can return malformed JSON, hallucinated denial codes, or low-confidence verdicts that must not auto-resolve a claim worth thousands of dollars. ADR-033's `RetellPort` template handles isolation; cost and correctness need additional structure.
**Decision:** New package `@dentabill/summarizer` exports `SummarizerPort` with a single `summarize(input) → SummaryOutput` method. `FakeClaude` returns deterministic fixtures keyed by `payerCode + transcript-prefix-hash`. `LiveClaude` wraps `@anthropic-ai/sdk` with prompt caching enabled (system prompt cached, transcript dynamic) and a 4000-token output cap. Output is validated against `SummaryOutputSchema` (Zod); Zod failure routes the job to DLQ + claim → MANUAL_REVIEW.

Cost-guard is a Redis distributed lock per `(orgId, billingPeriod)` using `SET NX EX 86400`. The summary worker acquires the lock, re-reads `Organization.summaryTokensUsed`, estimates the call's tokens (~1.3 per word), aborts and requeues with delay if over budget, otherwise invokes Claude. Lock is released after the DB write. Concurrent jobs for the same org serialise; concurrent jobs across orgs run in parallel.

Auto-transition policy is OFF by default: every summary routes Claim to MANUAL_REVIEW unless the operator explicitly enables `SUMMARIZER_AUTO_TRANSITION_ENABLED` AND the summary's `confidence ≥ 0.95` AND `nextAction ∈ {RESOLVED, NEEDS_INFO}`. Auto-DENY is never automatic in Phase 4.
**Consequences:** Tests run for free. Cost overruns require deliberate budget changes, not a code path. A Claude hallucination cannot auto-resolve a claim until the operator opts in per-org and accepts the risk. Affected files: new `packages/summarizer/`, new `apps/summary-worker/`, `apps/call-worker/src/handler.ts` (job emission seam), `packages/db/prisma/schema.prisma` (`Organization.summaryTokensUsed`, `Organization.summaryTokensResetAt`, `Organization.featureFlags`).

## ADR-043 — Stripe metered billing on the audit() spine

**Date:** 2026-05-06
**Status:** Accepted
**Context:** Phase 3 extended the `audit()` helper to cover the entire Call lifecycle (P3-T27). Every claim transition to RESOLVED already produces an `AuditLog` row with `organizationId`, `userId`, `metadata.{from,to}`. Building Phase 4's billing on top of this avoids a parallel instrumentation system. Stripe is the chosen provider (HIPAA-acceptable when used as a payment processor without PHI in metadata; we send only `claimId` and amount, never patient details).
**Decision:** A new `apps/billing-worker` runs as a daily BullMQ repeatable job at 02:00 UTC. It scans `AuditLog WHERE action = 'claim.transition' AND metadata->>'to' = 'RESOLVED' AND createdAt ∈ [period_start, now())`, groups by org, and for each org: lazily ensures a Stripe customer (`Organization.stripeCustomerId`), then iterates resolved claims and posts one Stripe usage record per claim with idempotency key `claim.<id>.<billingPeriodStartIso>`. Each invocation persists a `BillingUsageRecord` row (composite unique on `claimId + billingPeriodStart`) before calling Stripe; the row is the local source of truth. Stripe's idempotency window is 24 hours — beyond that, the local uniqueness constraint catches double-posts.

Pricing for Phase 4 is a flat per-resolved-claim fee multiplied by the org's plan tier (`Organization.plan ∈ {TRIAL, STARTER, PRO, ENTERPRISE}`). Phase 5 may revisit with percentage-of-recovered or volume tiers once we have live usage data.

Webhook surface is `POST /v1/webhooks/stripe`, signature-verified via `stripe.webhooks.constructEvent` (constant-time HMAC), replay-protected by `event.id`. Handles `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.updated`. Mirrors the structural shape of `apps/api/src/routes/v1/retell-webhook.ts`.

Going-live is gated by `STRIPE_METERED_BILLING_ENABLED` (default OFF). When off, the worker writes `BillingUsageRecord` rows but skips the Stripe API call — receipt-only mode for canary verification.
**Consequences:** No new instrumentation in the call hot path. Double-charge is structurally impossible within the Stripe window (idempotency key) and the local window (composite unique). Per-org rollout is one env-var flip. Affected files: new `packages/billing/`, new `apps/billing-worker/`, new `apps/api/src/routes/v1/webhooks/stripe.ts`, new `apps/web/src/app/dashboard/settings/billing/page.tsx`, schema additions for `BillingUsageRecord` + `Organization.stripeCustomerId`.

## ADR-044 — Clerk Organizations migration: idempotent reconciliation, feature-flagged switcher

**Date:** 2026-05-06
**Status:** Accepted
**Context:** ADR-031 ships single-seat orgs with a synthetic `clerkOrgId = "local_<cuid>"`. Phase 4's billing surfaces and a future multi-seat product cannot ship with placeholder identifiers — Stripe webhooks key off `Organization.id`, but operator support keys off Clerk org id, and a synthetic id leaks into every log line, every billing event, every audit row. The migration must be reversible (we cannot lose orgs to a partial failure), idempotent (re-runnable safely), and gated behind a feature flag so the org-switcher UI only appears for orgs that have been migrated.
**Decision:** A one-shot script `apps/api/scripts/migrate-clerk-orgs.mts` walks every `Organization` row where `clerkOrgId LIKE 'local_%'`. For each row: (1) creates a real Clerk org via `clerkClient.organizations.createOrganization({ name })`, (2) invites every `User` row with `organizationId = org.id` via `createOrganizationMembership`, (3) updates `Organization.clerkOrgId` to the real Clerk org id, (4) writes an `AuditLog` row keyed `organization.clerk-migrate`. Each org is its own transaction; partial failure of the script leaves successfully migrated orgs in their new state and unmigrated orgs untouched.

A reverse-mapping JSON file is written to `/tmp/clerk-migration-<timestamp>.json` recording each `(org.id, oldClerkOrgId, newClerkOrgId)` triple, enabling a forward-then-reverse run as the rollback path.

The `OrgSwitcher` UI in the dashboard shell is gated behind `CLERK_ORG_SWITCHER_ENABLED` AND `me.data.organization.clerkOrgId` not starting with `local_` — orgs that haven't been migrated never see the switcher and stay on their existing single-seat experience.

The auth plugin (`apps/api/src/plugins/auth.ts`) is updated to assert `JWT.orgId === User.organizationId`; mismatch returns 401 forcing a session refresh (race window during a Clerk org-switch).
**Consequences:** No big-bang cutover; orgs migrate at our pace. A failed migration of one org does not block others. Webhook handlers for `organizationMembership.deleted` and `organization.deleted` close the multi-seat lifecycle loop. Affected files: new `apps/api/scripts/migrate-clerk-orgs.mts`, `apps/api/src/plugins/auth.ts`, `apps/web/src/components/dashboard/dashboard-shell.tsx`, new `apps/api/src/routes/v1/webhooks/clerk.ts`.

## ADR-045 — `Claim.subscriberId` schema migration: expand-then-contract over multiple phases

**Date:** 2026-05-06
**Status:** Accepted
**Context:** Phase 3's call-worker passes `claim.claimNumber` as the agent's `subscriberId` placeholder (P3-T10) because the schema does not yet model subscriber IDs separately. Most payer reps locate a claim via `claimNumber + DOS`, so the agents work — but Aetna reps require the literal subscriber id, and the semantic mismatch makes correctness impossible to assert. Adding a NOT NULL column would break every existing row without a backfill plan. The right shape is the standard expand-and-contract migration: add nullable, populate forward, backfill historical, then tighten the constraint over multiple releases.
**Decision:** Phase 4 ships **only** the expand step:

1. Migration adds `Claim.subscriberId String?` (nullable). No backfill — historical rows stay null.
2. CSV importer (`apps/api/src/lib/csv/parser.ts` + `normalisers.ts`) detects a subscriber-id column on each source-system layout. Open Dental and Eaglesoft surface it consistently. Dentrix is flagged as inconsistent in tests; null is the acceptable default when absent.
3. The call-worker handler (`apps/call-worker/src/handler.ts:268`) uses `claim.subscriberId ?? claim.claimNumber` as the agent metadata `subscriberId` field, preserving Phase-3 behaviour for null rows while passing the real value when present.

Phase 5+ ships the contract steps:

4. Backfill historical rows opportunistically via the summary-worker reading the value from the CallSummary's parsed transcript when available.
5. After ≥30 days where new claims always have `subscriberId` populated, switch the column to NOT NULL with a migration that fails fast if any nulls remain.
   **Consequences:** No production data is invalidated by the Phase-4 ship. The agent's subscriberId field is correct when present and falls back to the Phase-3 behaviour otherwise — Aetna calls improve immediately for newly imported claims. Affected files: schema migration, `apps/api/src/lib/csv/parser.ts`, `apps/api/src/lib/csv/normalisers.ts`, `apps/api/src/lib/csv/types.ts`, `apps/call-worker/src/handler.ts`, importer tests.

## ADR-046 — Live transcript SSE: per-client buffer, Postgres replay, JWT refresh on reconnect

**Date:** 2026-05-06
**Status:** Accepted
**Context:** Phase 3 (T24) shipped the calls list with 5s/30s adaptive polling — fine for a table view that updates every few seconds. The transcript on `/dashboard/calls/[id]` is a chat surface where each turn matters; polling makes the operator wait up to 5s per rep utterance, and during a hot transfer or denial-code call that delay is the difference between "I caught the code" and "let me listen to the recording later". Phase 3 deferred SSE because we didn't have transcript text yet (ADR-034). Phase 3 now writes transcript events; Phase 4 surfaces them.
**Decision:** New API route `GET /v1/calls/:id/events/stream` returns `text/event-stream`, CORS-locked to the dashboard origin. Authenticated by the existing `requireAuth` preHandler (JWT validated at connect; if the JWT expires mid-stream, the client reconnects with a fresh token).

The route subscribes to a Redis pub/sub channel `call:<retellCallId>:events`. Multiple SSE connections to the same call share a single Redis subscription per fastify worker process via a per-process subscriber map. Producers (`retell-webhook.ts` and the Phase-4 `summary-worker`) publish to the channel after every `CallEvent` insert.

The connection holds a per-client in-memory circular buffer of the last 1000 events. On overflow it sends a single `event: rewind` frame with the last persisted event id; the client re-fetches via Postgres (the `CallEvent_callId_timestamp_idx` makes this fast). Postgres is the source of truth — Redis pub/sub is the broadcast bus only, never the durable store. Heartbeat: `: ping\n\n` every 15s. Connection close emits an explicit `event: close` frame.

The client (`apps/web/src/lib/calls/use-call-event-stream.ts`) is an EventSource wrapper with reconnect-with-backoff (1s, doubling, capped 30s). Falls back to the existing 5s polling when `SSE_LIVE_TRANSCRIPT_ENABLED` is OFF.

Per-process connection cap: `SSE_MAX_CONNECTIONS_PER_PROCESS=200`. Beyond the cap returns 503; the load balancer fans out new connections across other workers (Phase-5 deployment concern).

Optional `?cursor=<callEventId>` query param: if present, replay starts after that cursor; if absent, replays the last 100 events. Cursor handling is the chaos-test gate — a connection killed mid-stream and reconnected with the last-seen cursor must not drop events.
**Consequences:** First-event P95 ≤ 500ms target. Reconnect produces zero data loss against Postgres. Misbehaving clients can't drop events for other clients (per-client buffer, not shared). Affected files: new `apps/api/src/routes/v1/calls.ts` (SSE route), `apps/api/src/routes/v1/retell-webhook.ts` (publish), new `apps/web/src/lib/calls/use-call-event-stream.ts`, new `apps/web/src/components/dashboard/calls/transcript-stream.tsx`, schema index `CallEvent_callId_timestamp_idx`, new `apps/web/e2e/transcript-sse.spec.ts`.

## ADR-047 — True call cancel: Postgres marker + worker-side polling, not Redis pub/sub

**Date:** 2026-05-06
**Status:** Accepted
**Context:** Phase 3's cancel endpoint (P3-T20) writes the DB markers (Call status, Claim → MANUAL_REVIEW, CallEvent type CANCELLED) but the live Retell call continues until natural termination because the API has no `RetellPort` handle. Two designs were considered for Phase 4: (a) Redis pub/sub topic per call that the worker subscribes to during `waitForCallEnd`, (b) a `Call.cancelRequestedAt` Postgres column the worker polls. The retro flagged option (a) but did not catch the subscribe-after-publish race: if a cancel arrives during the ~100ms window between the worker placing the call and subscribing, the message is dropped (Redis pub/sub does not buffer for late subscribers).
**Decision:** Postgres-driven, **not** Redis pub/sub. New columns `Call.cancelRequestedAt DateTime?` and `Call.cancelRequestedBy String?`. Cancel API writes both via `updateMany` (org-scoped) before returning 202. The worker handler:

1. At `waitForCallEnd` entry, checks `cancelRequestedAt` synchronously. If set, calls `retellPort.endCall()` immediately and skips the subscribe loop.
2. Inside the `waitForCallEnd` polling loop (already running every 5s for hold detection — ADR-039), re-reads `cancelRequestedAt` from the same DB row and tears down on transition.

This avoids a new coordination primitive, reuses the existing 5s poll budget, and is race-free because Postgres serialises the writes.
**Consequences:** Cancel latency is ≤ 5s wall-clock (the poll period). Acceptable for an operator-initiated cancel — the rep is on the line; an extra 5s before hangup is not user-visible. No Redis dependency on the cancel path. Affected files: schema migration (`Call.cancelRequestedAt`, `Call.cancelRequestedBy`), `apps/call-worker/src/handler.ts`, `apps/api/src/routes/v1/calls.ts` (cancel handler).

## ADR-048 — Phase 4 SLOs and error budgets

**Date:** 2026-05-06
**Status:** Accepted
**Context:** Phase 3 shipped without explicit SLOs because the surfaces it added were either user-initiated (Call-Now Pill) or had inherent budgets defined by external systems (Retell webhook latency, payer hold timeouts). Phase 4 adds three new "always-on" surfaces — the summarizer, the SSE transcript, and the billing reconciliation — each with characteristic failure modes that must be budgeted before they ship, not after they cause an incident.
**Decision:** Phase 4 commits to the following Service Level Objectives, measured weekly with a 28-day rolling window:

| Surface                            | Indicator                                                              | Target      | Page threshold     |
| ---------------------------------- | ---------------------------------------------------------------------- | ----------- | ------------------ |
| Enqueue (P3)                       | P95 latency from POST `/v1/claims/:id/calls` to job ack                | ≤ 200ms     | > 500ms for 10 min |
| Summarizer                         | success rate within 60s of call end                                    | ≥ 95%       | < 95% for 30 min   |
| Summarizer                         | P95 latency from job pickup to `CallSummary` row                       | ≤ 60s       | > 90s for 30 min   |
| SSE transcript                     | P95 first-event latency from connect                                   | ≤ 500ms     | > 1s for 10 min    |
| Webhooks (Retell + Stripe + Clerk) | P99 signature verification                                             | ≤ 10ms      | > 30ms for 5 min   |
| Billing reconciliation             | Drift between `BillingUsageRecord` and `AuditLog` resolved-claim count | ≤ 1 row/day | > 1 row/day        |

Error budget: a page-threshold breach consumes one "budget event"; three budget events in a 28-day window block non-essential Phase-5 feature work until SLO is restored.

Metrics emit via Prometheus naming: `dentabill_<surface>_<measure>_<unit>`. Dashboards (Grafana) and alerts (PagerDuty) are Phase 5 deployment concerns; Phase 4 instruments the metrics, lands the runbook entries, and validates the synthetic monitor against staging.
**Consequences:** Every Phase-4 surface ships with a "what does broken look like" definition rather than a hand-wave. Affected files: `packages/logger/` (metric helpers), `docs/SLOS.md` (new), `docs/RUNBOOK.md` (per-SLO oncall entries), synthetic monitor at `apps/api/scripts/synthetic-summary-loop.mts`.

## ADR-049 — Empty-string env normalization at the loader, not the test setup

**Date:** 2026-05-06
**Status:** Accepted
**Context:** The `RETELL_WEBHOOK_SECRET=` (empty string) trap bit twice during Phase 3: once in `vitest.setup.ts` and once in `apps/api/scripts/dump-openapi.mts`. The fix in both cases was to special-case empty strings. The retro (ADR-041) flagged this as a P4-prep cleanup. The right place for the fix is the env loader itself — every consumer of `getEnv()` must already have it called, so normalising at the boundary removes the workaround forever.
**Decision:** `apps/api/src/lib/env.ts` and `apps/call-worker/src/env.ts` strip empty-string values to `undefined` before invoking `schema.safeParse(...)`. The strip is a pre-Zod step:

```ts
const raw = { ...process.env };
for (const k of Object.keys(raw)) if (raw[k] === '') delete raw[k];
const parsed = envSchema.safeParse(raw);
```

The corresponding workaround is removed from each app's `vitest.setup.ts`. `TEST_DEFAULTS` continues to seed missing-or-empty values; once the loader strips, the existing `??=` semantics work cleanly.
**Consequences:** New env vars added in Phase 4+ no longer need bespoke empty-string handling. The dev path matches the test path matches the prod path. Affected files: `apps/api/src/lib/env.ts`, `apps/call-worker/src/env.ts`, `apps/api/vitest.setup.ts`, `apps/call-worker/vitest.setup.ts`, future `apps/summary-worker/src/env.ts` and `apps/billing-worker/src/env.ts`.

## ADR-050 — Phase 4 retrospective: lessons feeding Phase 5

**Date:** 2026-05-06
**Status:** Accepted
**Context:** Phase 4 shipped the back-half of the voice agent's value loop — call → structured summary → claim transition → operator notification → metered billing — across PRs #101–#120 over ~3 weeks. Twelve focused PRs landed CI-green: schema migrations (W1A/B/C), summarizer scaffold + LiveClaude + worker (W2A–E), notifier + summary dispatch (W2-T6), call-worker cancel-channel + Retell signature parity (W7-prep-4/6), billing port + worker + API + web surface (W3A–E), Clerk webhook + JWT.orgId assertion + migration script (W4), live transcript SSE (W5). Phase-3 retro (ADR-041) flagged five lessons; Phase 4 retired four.

**Decision:** Capture what worked, what didn't, and what carries into Phase 5.

**What worked.**

- **Default-OFF feature flags.** `SUMMARIZER_AUTO_TRANSITION_ENABLED`, `STRIPE_METERED_BILLING_ENABLED`, `NEXT_PUBLIC_SSE_LIVE_TRANSCRIPT_ENABLED`, `CLERK_ORG_SWITCHER_ENABLED` all default off. Engineering shipped the full pipeline; production rollout is a flag flip per-surface, not a deploy. Zero rollback drama.
- **Port-and-adapters everywhere.** SummarizerPort, BillingPort, NotifierPort all have `Fake*` adapters that the unit/integration tests use exclusively. CI does not pay $0.01 per Claude call. The Live adapters lazy-load their SDK so dev/test bundles stay slim.
- **Strict templates as PHI gates.** `packages/notifier/src/templates/index.ts` uses `.strict()` Zod schemas — passing `patientName` or `dob` through a notifier template is a test failure, not a code review nag. The compiler enforces the HIPAA "minimum necessary" rule.
- **Two-step Zod validation.** Adapter parses `SummaryOutputSchema` once; worker re-parses before persisting. The defence-in-depth caught one Claude-output drift in dev before it reached the DB.
- **Contract test caught a real production divergence.** `apps/api/test/integration/retell-webhook-contract.test.ts` (P3-T7-prep-6) discovered that the Retell SDK signs as `v=<unix_ms>,d=<hex>` rather than the raw hex our hand-rolled verifier expected. Without the contract test, every webhook in prod would have rejected. This is the canonical example of why contract tests pay for themselves.
- **Idempotency-as-a-receipt.** `BillingUsageRecord.idempotencyKey @unique` is a composite of `claim.<id>.<billingPeriodStart>`. Re-running the billing-worker cron is a no-op; double-charging is structurally impossible.
- **Multi-tenant gap close as W1A blocker.** `CallSummary.organizationId` was added to the multi-tenant intercept list as the very first task of the phase, before any other Phase-4 code touched the model. Cross-tenant leak risk on the new model is now the same as on Phase-1 models — zero, gated by the Prisma read-scope wrapper + write middleware.

**What didn't.**

- **Test-DB concurrency is still serial.** The `--concurrency=1` workaround in `turbo.json` survives. P4-prep-2 (per-suite Postgres schemas) was deferred — the per-suite `SET search_path` plumbing has more moving parts than initially scoped, and the concurrent-write contention surfaced subtler issues. Carry into Phase 5.
- **SSE integration testing required a real listening socket.** `light-my-request`'s `inject` buffers responses until the stream closes, so `event: replay-end` did not surface mid-flight. The route had to bind to an ephemeral port and test via `fetch`. Acceptable, but the test runtime jumped from <100ms to ~5s.
- **Empty-string `process.env` re-bit during the SSE branch.** The Clerk fallback in `loadEnv` resolves `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` → `CLERK_PUBLISHABLE_KEY`, so deleting the latter was insufficient — the fallback re-populated it. ADR-049 normalised empty strings, but the fallback semantics are still a mini-trap. Tests now explicitly delete all three Clerk envs in `beforeAll`.
- **Playwright SSE chaos tests (W5 carry-over).** Originally scoped for Phase 4. The minimal SSE shipped — replay + heartbeat + reconnect hook + flag-gated UI — but the Playwright chaos coverage (mid-stream connection drops, reconnect-with-cursor, zero data loss) defers to Phase 5.
- **Golden-set evals (W2J).** `apps/summary-worker/tests/eval.test.ts` against `LiveClaude` is wired but the 20-fixture × 3-payer hand-annotated golden set is not yet built. The nightly GitHub Actions workflow that runs `RUN_LIVE_EVALS=1` is also not yet wired. Owner-action prereq: staging Anthropic key.

**Inputs to Phase 5.**

1. Per-suite Postgres test schemas (carry from Phase 3 retro).
2. Playwright SSE chaos coverage.
3. Golden-set evals + nightly evaluation workflow.
4. `LiveResend` + React Email templates (Phase 4.5 micro-phase, ~1 week).
5. Real Prometheus + Grafana wiring (the metric names land in Phase 4 per ADR-048; the collection target is Phase 5 deployment).
6. Branch protection on `main` (still owner-action carry-over from Phase 3).
7. Anthropic BAA signing (owner-action; gates `LiveClaude` in prod).

**Consequences:** Phase 5 starts with the platform shipping the full call → summary → claim transition → billing → notification value loop. The remaining work is hardening, observability target wiring, and the 4.5 LiveResend micro-phase. The exit-criteria checklist in the Phase-4 plan items 1–9 are met (1: CallSummary; 2: claim transition; 3: AuditLog with summary metadata; 4: SSE replay + stream; 5: BillingUsageRecord; 6: Notifier delivery log via FakeResend; 7: PHI redaction; 8: cross-tenant tests; 9: CI green per merge). Item 10 is this ADR.

## ADR-051 — Go-live plan for the investor demo: cloud target, free-forever pivot, simulated telephony, demo scope

**Date:** 2026-08-21. **Status:** accepted. **Full plan:** `docs/GOLIVE_PLAN.md` (this ADR records the decisions; the plan carries the task specs).

**Context.** An investor demo on a production URL is due within hours. Phases 1–4 are complete and green; deployment infra, demo data, and several dashboard surfaces are not. Real telephony is hard-blocked on the Retell BAA (owner action). Product direction pivots to free-forever — no paywall for practices.

**Decisions.**

1. **Cloud target (closes the deferred half of ADR-001/ADR-004):** Railway for api + call-worker + summary-worker + Postgres 16 + Redis 7; Vercel for web. billing-worker is not deployed.
2. **Free-forever pivot:** Stripe/billing code stays in-tree but permanently dormant (`STRIPE_API_KEY` empty, flag false). `/pricing` rewritten to free positioning; `/dashboard/settings/billing` renamed to usage with the portal CTA removed. Excise-vs-keep revisited post-demo.
3. **Simulated telephony through the real pipeline:** new `DEMO_AUTOPILOT=true` env makes FakeRetell time-driven (~75s scripted scenario) so Call Now exercises the production path end-to-end (worker → CallEvents → Redis → SSE → summarizer → transition → audit). Guard: only active when `RETELL_API_KEY` is empty. The demo explicitly discloses simulation mode — simulated audio is never presented as a live payer call.
4. **Summarizer:** `LiveClaude` iff `ANTHROPIC_API_KEY` provided — demo data is fully synthetic, so no PHI exists and the Anthropic BAA is not a demo prerequisite. `SUMMARIZER_AUTO_TRANSITION_ENABLED=true` for the demo only.
5. **Demo scope:** build `/dashboard/reports` (new org-scoped `GET /v1/reports/summary`) and the `/settings/audit-log` viewer; polish (not build) team/integrations/notifications as roadmap states; remove all user-facing "Phase N" copy.
6. **Auth:** Clerk development-instance keys for the demo deployment; synthetic `local_*` org ids remain; production Clerk instance + `migrate-clerk-orgs.mts` stay post-demo.
7. **Process exception:** single branch `phase-5/golive-demo` with per-task conventional commits and one squash-merged PR, instead of one-PR-per-task — justified by the timeline, not a precedent.

**Consequences.** The demo is honest (real pipeline, disclosed simulation), reversible (no billing code deleted, all flags env-scoped), and leaves a recorded post-demo hardening backlog (plan §11): Retell/Anthropic BAAs, Clerk prod migration, observability wiring, evals, chaos tests, compiled workers, backups.
