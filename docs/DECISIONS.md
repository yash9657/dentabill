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

## ADR-052 — Executing the go-live plan: four demo-blocking gaps that only running the thing revealed

**Date:** 2026-08-22. **Status:** accepted. **Supersedes nothing; extends ADR-051.**

**Context.** ADR-051 and `docs/GOLIVE_PLAN.md` were authored from a static audit — reading code, running typecheck and the unit suites. Execution of tracks A–E surfaced four defects that every green gate had missed, because each one only manifests when a real request travels the real pipeline. All four would have fired live, during the demo.

**What the static audit could not see.**

1. **The business-hours guard closes the demo.** ADR-037 blocks enqueue when the payer line is shut. Correct for production — dialling a closed line burns a call. But payer lines are closed evenings and weekends, so `POST /v1/claims/:id/calls` returned `422 PAYER_HOURS_CLOSED` on a Saturday, which is precisely when a demo runs. **Decision:** `DEMO_IGNORE_PAYER_HOURS`, interlocked against `RETELL_API_KEY` — a real telephony key restores the guard regardless of the flag, and the bypass logs at `warn`. Never a silent override.

2. **`FakeClaude` cannot carry a live run.** It is fixture-driven: it throws unless a test pre-registered an output keyed by payer + transcript snippet. ADR-051 D4 treated it as the graceful fallback when `ANTHROPIC_API_KEY` is absent, but a genuine call registers no fixture, so summarization failed, retried, and dead-lettered — no summary, no claim transition, no audit entry. This is the exact shape of the FakeRetell problem G-B5 was written to fix; the same flaw existed one stage downstream and went unnoticed. **Decision:** an opt-in `deriveWhenUnregistered` mode that reads the transcript and produces a summary consistent with it, wired through `DEMO_SUMMARIZER_FALLBACK`. Default off, because for tests the throw is the point.

3. **`Call.retellCallId` is UNIQUE and `FakeRetell`'s counter restarts per process.** `fake_call_1`, `fake_call_2`, … begin again at 1 on every boot, so a restarted worker collided with rows the previous process wrote and every job died on a unique-constraint violation. Any worker restart — or any redeploy — broke the next call. **Decision:** `createRetellPort` namespaces the generator per process. Tests constructing `FakeRetell` directly keep the deterministic counter.

4. **`node dist/server.js` is unreachable in this workspace.** All seven workspace packages declare `"main": "./src/index.ts"` with no JS-emitting build, so even a fully compiled `apps/api/dist` would `import '@dentabill/db'` and resolve it to TypeScript. Shipping compiled output is a seven-package refactor, not a Dockerfile change. **Decision:** all three services run under `tsx`, extending the tradeoff the plan already accepted for the workers. Recorded in `docs/DEPLOY.md` with what compiling would actually require.

**Consequences.**

- Three demo-only flags now exist, each interlocked so it cannot weaken production: `DEMO_AUTOPILOT` and `DEMO_IGNORE_PAYER_HOURS` are inert once `RETELL_API_KEY` is set; `DEMO_SUMMARIZER_FALLBACK` is inert once `ANTHROPIC_API_KEY` is set. The safety property is that configuring the real dependency always wins over the demo flag.
- The demo pipeline is proven, not asserted: enqueue → autopilot call (42s, 16 events) → summary (confidence 0.88) → claim transition → audit row carrying `summaryId` + `confidence` + `promptVersion`.
- **Process lesson, and the reason this ADR exists:** every one of these four passed typecheck, lint, and 828 unit tests. Fakes built for tests are driven _by_ tests; they do not spontaneously work when a real job arrives. Any future "fake adapter" must be exercised by an actual end-to-end run before it is called done, and a phase is not complete because its gates are green — only because its path has been walked.

## ADR-053 — Vercel-only serverless backend: job dispatcher abstraction, inline execution, Redis optional

**Date:** 2026-10-12. **Status:** accepted. **Amends ADR-051 D1** (cloud target) for the $0-infra deployment; ADR-035 (queue topology) and ADR-046 (SSE over Redis pub/sub) remain the default topology. **Runbook:** `docs/DEPLOY_VERCEL.md`.

**Context.** The owner will not pay for hosting beyond the existing Vercel Pro plan. Railway (always-on api + two workers + Redis) is out, and Redis itself is out: the Vercel Marketplace Upstash integration has no free plan, and BullMQ's blocking/polling workers would exhaust a free Redis command quota anyway. Postgres moves to Neon free. Everything in the backend that assumed a long-lived process — BullMQ workers, the DLQ consumer, Redis pub/sub for SSE, the Redis cost-guard lock — needs a serverless path, without breaking the Docker/Railway/local-dev topology.

**Decisions.**

1. **`JobDispatcher` in `@dentabill/queue`** (`dispatchCall` / `dispatchSummary`, returning the job id). Every producer — the enqueue and summary-retry routes, the call handler's summary fan-out, the hold-detector reschedule — uses it instead of `queue.add`. The BullMQ implementation is a thin wrapper with identical wire format (job name, `jobId = idempotencyKey`, priority, queue default options). Selected by `JOB_DISPATCH_MODE=bullmq|inline`, default `bullmq`.
2. **Inline mode = self-invocation, not a queue.** The dispatcher POSTs the payload to `/v1/internal/jobs/{calls,summaries}` (shared secret `INTERNAL_JOB_SECRET`, constant-time compare, hidden from OpenAPI) inside `waitUntil`. The route acks `202` and runs the unchanged processor under `waitUntil` in its own invocation (maxDuration 800 s). The worker handlers are imported from `@dentabill/call-worker` / `@dentabill/summary-worker` as workspace dependencies — the least invasive option; no code moved.
3. **BullMQ semantics reproduced where they matter:** a minimal Job adapter (`id`, `name`, `data`, `attemptsMade` — all the handlers read); retries with BullMQ's own backoff formula, capped by a 760 s budget; on final call failure the DLQ consumer's handler runs directly; duplicate triggers are suppressed by an atomic `IN_QUEUE → CALLING` claim lease (summaries: skip when a `CallSummary` exists, since `callId` is unique). Hold reschedules re-dispatch immediately, as BullMQ did.
4. **Redis is optional in inline mode.** Without `REDIS_URL`: no ioredis/BullMQ objects are created; the SSE route replays from Postgres and then polls `CallEvent` (1 s), closing with `event: close` at a terminal call status; `/v1/readyz` reports `redis: {ok: true, skipped: true}`; the summary cost guard is a process-local lock (`CostGuard` interface, Redis-backed by default). With `REDIS_URL` set (including `rediss://`), behaviour is exactly as before.
5. **Packaging = Build Output API, not zero-config.** Workspace packages ship raw TypeScript with NodeNext `.js` specifiers; rather than depend on how the platform builder treats them, `apps/api/scripts/build-vercel.mjs` bundles with esbuild (only `@prisma/client` external), traces with `@vercel/nft`, and emits `.vercel/output` with one streaming Node 22 function. `schema.prisma` gains `binaryTargets = ["native", "rhel-openssl-3.0.x"]`. SSE streams are cut at 780 s without `close` so clients reconnect and re-replay (de-duplicated by event id).

**Consequences.**

- One codebase, two topologies; bullmq mode is unchanged and remains the target for real telephony.
- A job must finish within one invocation. 75 s demo calls fit; the 15-min real-call cap does not — live telephony needs a durable runner (Vercel Queues/Workflow) or the workers back.
- No persisted queue: an invocation that dies mid-job loses the job (claim left `IN_QUEUE`/`CALLING`, recoverable per RUNBOOK). The trigger is fire-and-forget, so trigger failure after three attempts is only logged.
- The daily summary token budget becomes a soft cap across instances; rate limiting stays per instance.
- SSE costs ~2 queries/s per open stream on Neon; streams self-close at call end.
- Deployment Protection blocks self-calls to `*.vercel.app` deployment URLs: production uses the production domain (`INTERNAL_API_BASE_URL` / `VERCEL_PROJECT_PRODUCTION_URL`); previews need Protection Bypass for Automation, whose secret the dispatcher forwards.

## ADR-054 — Fireworks-hosted open-weight AI direction; production plan and feasibility gates

**Date:** 2026-10-12. **Status:** accepted product constraint; implementation architecture proposed.
**Plan:** [FIREWORKS_IMPLEMENTATION_PLAN.md](./FIREWORKS_IMPLEMENTATION_PLAN.md).

**Context.** The user requested a candid gap analysis against Lunabill, current domain
and AI research, an industry-grade implementation plan, and open-weight models hosted
on Fireworks for all AI. The repository contains a working simulated call/summary path
and an Anthropic/Retell implementation; this request supersedes the prior provider
direction for future model inference, but does not itself deploy a replacement.

**Accepted decisions.**

1. All future production model inference is to use approved open-weight models hosted
   by Fireworks: text, vision, embeddings, reranking, model-based evaluation, and voice
   inference if available. No hidden proprietary-model or other-provider fallback.
2. Model/provider migration must preserve reviewability, evidence, tenant boundaries,
   and historical data. Existing summaries remain readable. A previously approved
   Fireworks release or human handling is the rollback path.
3. The audit/implementation plan is the current planning baseline. It does not mark
   any discovered runtime defect fixed or certify production readiness.

**Proposed, not yet implemented or purchased.** A typed model gateway; dental
line/coverage/evidence/payment entities; transactional inbox/outbox and durable
execution; electronic-channel-first source sync; evidence review and version-bound
approvals; quality/reliability release gates. Initial model candidates and the small
Open Dental practice segment require evaluation and pilot validation.

**Unresolved gates.** Confirm Fireworks-hosted open-weight streaming ASR and TTS,
model/deployment identity and region, applicable agreements and content licenses,
PMS/clearinghouse access, and a funded durable runner. Audio-input support alone does
not establish TTS. If voice is unavailable under the strict requirement, ship the
electronic-channel/human-review scope first. ADR-053's existing hosting constraint
and free-forever pricing remain in force pending separate decisions; the plan does
not authorize infrastructure spend or change pricing.

**Consequences.** Future implementation starts with containment of unsupported
financial metrics, model-only claim closure, identity fallback, and external-contract
gaps, alongside vendor feasibility and evaluations. Durable production workflows
cannot rely on the demo inline executor. The 14–18 week estimate is conditional on
three engineers, billing expertise, vendor access, and a deliberately narrow scope;
it is not a parity or autonomy promise.

## ADR-055 — AWS baseline and the ElevenLabs speech/orchestration exception

**Date:** 2026-10-13. **Status:** accepted user direction; provider choice unverified.

User explicitly permits ElevenLabs speech models and voice orchestration while requiring
Fireworks-hosted open-weight business reasoning, extraction, vision, retrieval and evaluation.
This amends ADR-054's all-Fireworks voice constraint; it does not approve hidden fallback LLMs,
post-call analysis models, or a production provider switch. Existing Retell remains available
for controlled comparison; no real third-party calls were authorized. See
[provider evidence](./PROVIDER_EVIDENCE.md) for account/contract/behavior gates.

User also corrected the backend to AWS. Fetch confirmed `origin/main` was already included;
actual newest backend revision was `origin/infra/aws=bfd4e8f`, incorporated with all prior
work preserved. Lambda API and SQS worker plus shared Aurora are the current baseline;
Vercel remains the frontend and historical inline mode remains supported. ADR-053's
Vercel-only assumption must not drive new production work. Existing budgets remain binding:
no service purchase, expansion, or production cutover is authorized by this decision.

The user has no pilot clinic yet and directs development with fake patient data. This enables
synthetic development but leaves real workflow/connector, billing-expert and PHI launch
verification incomplete. No eventual PMS/payer/product/region scope was silently removed.

## ADR-056 — Financial containment, identity gates, and summary commit boundaries

**Date:** 2026-10-13. **Status:** implemented locally; release and live workflow proof pending.

Claim workflow disposition, call completion, payer-reported amounts, and actual matched cash
are distinct facts. Remove unsupported recovered-revenue sums rather than relabel uncertain
payments as zero. Reports expose operational unique-claim/call counts and unavailable verified
payments until reconciliation exists. This is containment, not a payment ledger.

A model's `RESOLVED` advice never closes a claim. Eligible terminal-call observations can route
to review or nonfinancial information gathering; protected claim states, intervening edits,
and newer calls prevent stale transitions. Summary persistence, conditional state change,
audit, and existing usage tally commit atomically; sequential replay does not re-run committed
inference. Notifications request review. Active calls cannot persist a partial final summary.

Missing/blank subscriber or provider NPI blocks enqueue and dialing without substituting a
claim number. Worker failure records NEEDS_INFO with scoped CAS/audit and is non-retryable in
BullMQ, inline, and SQS; it must not be overwritten by final-receive DLQ escalation.

Limits remain explicit: approved amount is not actual payment; exact evidence-bound action
approval and financial reconciliation are unimplemented. A DB transaction does not make
external inference/notifications transactional. Incurred inference cost needs its own ledger,
notifications need an outbox, and external call acceptance needs durable intents/reconciliation.
Separate-process crashes, real vendor behavior, and authorized clinic end-to-end runs remain
required. Current synthetic tests do not establish production accuracy or recovery attribution.

## ADR-057 — Normalize provider evidence through a transactional inbox

**Date:** 2026-10-13. **Status:** implemented locally; no deployment/live certification.

Retell's actual signed `{event,call}` payload is separate from our simulation envelope.
Accept only the timestamped SDK signature over raw bytes, using the API key designated
for webhook signing. No random generated credential or untimestamped fixture fallback.
The provider supplies no delivery event ID: lifecycle identity is event type plus call ID;
transcript snapshots have a content hash and remain provisional rather than claimed
provider revision order. Unsupported analysis never supplies business facts.

Store normalized early events before acknowledging 202. Bind them only via our Call's
unique provider ID, never webhook tenant metadata. Receipt ownership, source event,
call metadata/status and audit form one transaction; rollback leaves retry possible.
Clear inbox payload after tenant-bound event persistence. Known duplicate effects collapse,
conflicting lifecycle data remains a review/reconciliation case. The worker reads terminal
evidence from Postgres across processes. A hangup does not establish human contact;
provider timing is independent of local cancellation/workflow status.

Final source transcripts replace cumulative snapshots. Preserve exact text and speaker
uncertainty; abstain from summarizing missing/empty/provisional evidence. UI streams are
scoped to call, credential and API origin, including late asynchronous responses.

Use documented Stop Call, never Delete Call, for termination requests. A successful stop
request is not terminal confirmation; bounded errors propagate for reconciliation.
Retell remains a comparison adapter, not an approved GPT/Claude business-inference fallback.

This slice does not solve call acceptance ambiguity, worker-crash redial, outbox delivery,
source revision ordering, unmatched inbox retention/operations, or real vendor behavior.
Synthetic separate-process producer-crash proof must not be presented as those stronger
claims. Production migration and provider actions retain the user's approval boundaries.

## ADR-058 — A persisted intent owns external submission, not a queue delivery

**Date:** 2026-10-13. **Status:** first safety slice implemented and verified locally;
reconciliation/outbox/deadlines remain open release gates.

Reserve one active CallIntent per tenant/claim with the exact queued claim version and
atomic audit. Queue keys identify that reservation; legacy/unreserved or mismatched jobs
cannot place calls. Composite database references prevent cross-tenant claim/call binding.
Commit READY → SUBMITTING, exact request/hash and conditional claim transition before any
provider create request. The opaque intent ID supplies provider idempotency/correlation.
Current Retell create documentation specifies a one-hour body `idempotency_key` window;
SDK 5.16.0 transmits this field although its types predate it. Disable create retries and
bound the request to 30 seconds. Provider errors never prove non-acceptance.

An uncertain response persists UNKNOWN; a crashed submitter can remain SUBMITTING. Both
retain active ownership indefinitely until verified reconciliation. Do not automatically
reset them, create another intent, switch providers or treat an empty lookup as non-acceptance.
Known ACCEPTED calls resume from durable IDs/evidence. Call completion and conditional claim
state/audit/intent terminalization form one transaction. Missing current identity does not
prevent observing an already accepted call. DLQ cancels only an exact READY intent; failed
terminal persistence keeps SQS delivery retryable. Stop acceptance alone cannot authorize
hold rescheduling. Local cancellation status cannot close the SSE transcript prematurely.

Two OS-process crash tests use an independent synthetic acceptance ledger, with SDK network
contract tests separate. This is synthetic no-redial evidence, not real Retell/AWS validation
or completed durable delivery. Next add transactional outbox/relay, scoped provider recovery,
observer leases/deadlines, versioned HTTP request replay and PHI snapshot retention. An old
worker that ignores these records is not a safe rollback while intents remain unresolved.

## ADR-059 — Commit delivery obligations with state; cancellation waits for evidence

**Date:** 2026-10-13. **Status:** implemented locally; deployment and real-provider verification pending.

Persist a tenant-scoped JobOutbox row with every new CallIntent and with terminal call
finalization/summary fan-out. Summary retry reservations serialize on the scoped terminal
Call and commit their audit and command together. A broker failure after commit returns
HTTP202 for the saved request; queue availability does not decide whether work exists.
Payloads contain validated queue routing fields and opaque IDs, with an immutable hash and
unique `(organizationId, kind, idempotencyKey)`. They do not contain transcripts.

Deliver at least once through a token-fenced, expiring lease. Persist each attempt before
sending; use bounded transport timeouts, exponential backoff and quarantine after ten
attempts. Invalid/hash-conflicting payloads never dispatch. Broker acceptance followed by
a crash leaves the same command eligible for replay. DELIVERED means transport receipt,
not a completed phone call or inference. External-action deduplication remains the consumer's
responsibility: the CallIntent fence prevents redial, while concurrent summary inference
and incurred-cost accounting still require FW-26. A timed-out transport may complete later.

The BullMQ worker sweeps at startup and every five seconds without overlapping its own
sweeps. AWS reuses the private worker Lambda and existing SQS dispatcher through a fixed
EventBridge event, 25 rows and a 20-second work budget. The schedule is disabled by default;
no cloud resource was deployed or enabled. DB operations are not preempted by this work
budget. Leases handle concurrent/repeated invocations; they do not establish exactly-once
transport. Old inline HTTP202/fire-and-forget is not a durable receipt: await a matching
HTTP200 only after the runtime records a disposition, otherwise retain pending delivery.
Its authenticated fixed-bound relay endpoint still needs an operator-configured scheduler.

Cancellation atomically saves a request marker, event and audit, with a conditional
CALLING-claim transition to review. It never invents terminal status, end time or duration.
Duplicate requests are no-ops; a committed provider terminal event wins. The frontend shows
pending cancellation and keeps polling; Stop Call acceptance alone is not termination.

Local separate-process tests kill the producer before first delivery and the relay after an
independent broker fsyncs acceptance but before its acknowledgement. A fresh relay replays
the identical command; two consumers produce one synthetic provider acceptance. This proves
these crash boundaries, not real AWS/Retell behavior. Persisted observer deadlines,
ambiguous provider-ID reconciliation, quarantine operations/alerts and authorized external
validation remain required. Keep additive evidence on rollback; never deploy an old worker
that ignores unresolved intents as a supposed safe recovery.

## ADR-060 — Reconcile positive provider identity; never infer permission to redial

**Date:** 2026-10-13. **Status:** implemented and tested locally; live compatibility and deployment remain release gates.

An Owner/Admin may check an UNKNOWN or sufficiently old SUBMITTING intent from claim
detail. Read-only Retell discovery is a separate port, with no create/delete/stop operation.
Use current v3 metadata predicates and opaque pagination; retrieve the one candidate through
v2 Get Call. Default bounds are three pages, twenty candidates, ten per page, two MiB per
response and a ten-second whole-operation deadline. Core bounds combined lookup to twenty-five
seconds; no automatic remote retry occurs. Provider response/error bodies never become API
errors or audit metadata. General database log/PHI controls remain a broader W8 gate.

Persist lookup attempts with a sixty-second token-fenced lease before reading remotely;
allow sixty seconds after SUBMITTING and between completed checks. Validate the canonical
stored request hash, opaque intent nonce, payer, agent, outbound direction and both numbers.
Recheck identity on detail. Empty, incomplete, failed, conflicting or multiple matches never
reset the intent, release its active-claim uniqueness, or authorize another provider/action.
Lease expiry permits another read-only check, not another call. Human review remains explicit.

One verified positive match commits Call/intent binding, normalized final source when present,
audit and a resume outbox command together. Source evidence is labeled `retell_get_call` with
retrieval time, never a synthetic signed-webhook receipt. No post-call analysis becomes business
evidence. Missing provider timing stays null. Reviewed Claim state is left untouched.
The provider Call ID remains globally unique; composite references preserve tenant/claim scope.

The call queue carries optional strict `resume:{intentId,callId}` with transport key
`call.resume.<intentId>`. Reusing the original key would be suppressed by retained BullMQ
jobs. Resume must match the scoped binding and all immutable routing fields; only ACCEPTED
observation or TERMINAL no-op is permitted, never the READY submission path. Inline receipt
validation follows that exact binding and requires TERMINAL. Atomic finalization still owns
one summary obligation even if original and resume observers overlap; observer leases are FW-36.

When the original create response races recovery, either binding order keeps the same Call.
An in-flight lookup may attach verified terminal evidence to the exact already-bound Call only
while it still owns the unexpired lookup lease. It also commits the durable resume obligation;
dropping that source could otherwise strand the original observer when the webhook is missing.
A newer lease/token is never overwritten. Stale UI results are claim-bound and do not invent
IN_QUEUE on an accepted-request replay.

Synthetic contract, Postgres, HTTP, UI, separate-process SIGKILL and race checks are evidence
for these local invariants only. A positive nonterminal match can still stall after a lost
end webhook. Accepted-call deadlines, account sweeps, quarantine operations, real-provider
compatibility, authorized clinic tests and production rollout remain open. Upgrade/drain old
workers before exposing recovery so an older parser cannot discard the resume command.

## ADR-061 — Observe accepted calls in bounded steps with durable termination state

**Date:** 2026-10-13. **Status:** local implementation and synthetic verification; deployment and live termination remain release gates.

An accepted provider call must outlive a particular queue consumer. Migration twelve adds
CallIntent deadlines, due time, observer lease/attempts, last checked result/review marker,
and separate stop request/attempt/acknowledgement/confirmation timestamps. Submission freezes
the deadline before the external request. The same duration is appended to the canonical
request snapshot and sent as `agent_override.agent.max_call_duration_ms`; old request hashes
remain valid. Accepted binding gives the first subscriber a thirty-second scheduling grace.
Recovery and legacy backfill anchor to original submission/creation, never worker restart.

Each observation acquires a sixty-second token-fenced lease. The initial same-process window
is one second; explicit no-key demo autopilot retains a bounded ninety-second window with a
longer lease. Persisted sources are checked before remote work. Known-ID Get Call is bounded
to ten seconds and must match the saved hash and exact outbound identity. Verified terminal
source, terminal intent/call, conditional version-bound claim transition, audit and one summary
outbox obligation commit atomically. Stale owners cannot insert source or overwrite finalization.
Concurrent biller edits remain intact. Persistence failures retain ACCEPTED with a due time;
transport acknowledgement is not a claim that the call or summary finished.

A cancellation marker or saved duration deadline can request Stop. Persist the attempt before
sending, then recheck current ownership. Retry the same provider ID no sooner than sixty
seconds, at most three times; confirmation ends five minutes after the first stop request.
An acknowledged or failed Stop never manufactures endedAt, terminal status, transcript, or a
summary. Exhaustion requires review. After confirmation expiry, automatic remote reads stop;
DB-source checks continue every five minutes and an authorized manual status check can retrieve
later terminal evidence. Read-only checks cannot Stop or create calls. A fresh missing-key
FakeRetell cannot acknowledge a real persisted call; only the just-started known synthetic
adapter can stop its own in-memory scenario. Crashed demos require evidence/review.

The existing trusted recovery entrypoints run outbox relay and up to five due accepted-call
observations independently. Observer selection prioritizes null legacy timers so they cannot
starve behind recurring calls. A twenty-five-second wall budget admits another row only when
two ten-second external operations fit; database latency itself is not preempted. No queue
message generation is needed per tick. AWS recovery remains disabled until explicitly deployed
and enabled; a saved due time alone is not deployed recovery. Drain old workers before rollout.

The stop/check/lease protocol cannot provide exactly-once Stop across a process pause or lost
acknowledgement; retries target the same existing call and never authorize redial. The provider
cap is additional protection, not verified real-line termination. Hold detection/DTMF and
actual provider behavior remain unverified. Synthetic process tests prove the documented crash
boundaries only. FW-38 separately replaces raw Prisma event logging with allowlisted target/
timestamp records; thrown errors elsewhere still need their own safe handling.

## ADR-062 — Scoped operations review and bounded delivery recovery

**Date:** 2026-10-13. **Status:** implemented locally; deployment and operational evidence pending.

Delivery acknowledgement cannot establish that a call or summary finished. Operators need to
see due work, quarantine and missing legacy commands without raw payloads or a blind redial.
An exhausted transport job may also remain in BullMQ, where re-adding its original ID does
not run it again.

1. Additive migration thirteen adds per-row `deliveryAttemptLimit`, monotonic `recoveryCount`
   and a separate `CLOSED`/`closedAt` disposition. Attempts are never reset. Owner/Admin
   approval grants exactly three additional delivery attempts for an exhausted, valid,
   quarantined READY command with the unchanged queued claim version. Early quarantine,
   active leases, invalid bindings, ambiguous submissions and accepted calls cannot be reset.
2. Recovery revalidates the canonical command/hash, scoped actor, domain state and review
   version in a serializable transaction. Audit and allowance/disposition commit together.
   No endpoint accepts replacement payloads, provider IDs or freeform patient-bearing reasons.
   Existing UNKNOWN/SUBMITTING calls use read-only reconciliation; ACCEPTED calls use their
   existing status control. Summary redelivery remains blocked until inference ownership and
   incurred-cost accounting are durable (FW-26).
3. A confirmed terminal/cancelled intent or existing summary may close its exact quarantined
   delivery as no work needed. `CLOSED` is not `DELIVERED`; closing never fabricates a receipt,
   call outcome, transcript, summary, payment or new external action.
4. Approved BullMQ recovery uses `outbox.<rowId>.recovery.<count>` as transport job ID while
   preserving the immutable domain idempotency key and command. Retries within the allowance
   share that transport generation. SQS carries validated optional envelope `transportJobId`; inline carries the same value
   in an authenticated private header. Their domain bodies/receipt keys stay unchanged. The
   runtime retains provenance through failure handling, and rechecks durable intent state
   before acknowledging it. An older-generation failure cannot cancel newer recovery; an
   unresolved READY/SUBMITTING no-op returns SQS retry or inline503. Domain consumers still
   own external-action deduplication.
5. `/v1/operations` and its cursor-paginated delivery/call lists require the stored Owner/Admin
   role and organization scope. The Settings screen exposes safe counters, dates and closed
   error codes, snapshot review and explicit approval. Five-minute delivery age is measured
   from due time, not creation time; call observation uses a two-minute overdue threshold.
   Missing legacy READY commands are visible but reads never invent them. No zero-backlog
   result is a service-health or scheduler-heartbeat claim.

Only synthetic localhost databases are migrated. No production deployment, recovery-schedule
activation, live call, notification to others or account change is authorized by this ADR.
Notification escalation, transport execution monitoring, unmatched inbox operations and staged
AWS evidence remain separate gates. The original outbox/evidence must survive rollback.

## ADR-063 — Release-gated Fireworks observation boundary

**Date:** 2026-10-13. **Status:** implemented locally; no model approval or production integration.

Business reasoning must use approved Fireworks-hosted open weights. An API key, catalog route
or valid JSON is insufficient approval or evidence. A separate leaf package implements the
first task, versioned claim observation from final transcripts, without changing live worker
selection or the Retell comparison baseline.

1. Trusted server configuration selects an explicit immutable release ID. Candidate and
   disabled releases cannot send requests. Enabled entries bind exact endpoint/route, measured
   response identity, organizations, task/prompt/schema/rule hashes, implementation artifact,
   safety limits and reviewed evidence references. A policy SHA-256 and dated approval prevent
   accidental scope/limit changes from reusing review. Protected input also requires separate
   contractual/source approval. References are operator-reviewed records, not cryptographic
   vendor attestation; artifact identity must be supplied by the future trusted build integration.
2. Input objects are strict and cloned, with matching organization/claim/version and unique
   sources. Output requires exact source/version/UTF-16 spans, identity, bounded integer USD
   amounts, explicit code nomenclature or UNKNOWN, compatible actions and strict abstention.
   Source anchors and lexical rules prove consistency only. They do not prove attribution,
   applicability, clinical correctness or settlement. Every result requires human review.
3. Native fetch fixes US host/path and denies redirects. Only allowlisted nonstreaming fields
   are sent; tenant/release cache keys contain no source text. No tool execution, storage option,
   prompt repair, implicit fake or cross-model/provider fallback exists. Fake fixtures are
   explicitly synthetic and tied to the entire input; an unknown fixture abstains.
4. One monotonic deadline covers headers, body, parsing, validation and backoff. Request128KiB,
   response1MiB, depth32, output4096 and thirty seconds are maxima that releases may tighten.
   At most one retry follows explicit429/500/502/503/504 and applicable Retry-After within the
   same budget. Ambiguous network failure, cancellation and invalid output do not retry.
   Abort cannot establish that generation stopped or was free.
5. Safe progress preserves each completed/active transport attempt even when the gateway's
   cancellation watchdog wins. Unknown token usage remains null, never zero or inferred.
   Errors expose closed codes/status/timing/usage only. Observations and evidence themselves
   contain sensitive content and must not be logged. FW-14 still owns application telemetry;
   FW-26 must persist ownership/spend before worker replay is allowed.

Both checked-in routes remain CANDIDATE. No inference, speech, call, deployment or cutover
occurred. New credentials passed one bounded read-only authenticated account/user GET each;
remaining account policy/entitlement inventory proceeds alongside FW-26. Qualified dental evaluations, source authorization, actual model revision/license/region/
retention and capped inference authorization remain release gates. Streaming/tools and the
ElevenLabs voice chain require separate implementation and comparative evidence.

## ADR-064 — Durable inference ownership before summary recovery

**Date:** 2026-10-13. **Status:** implemented locally for synthetic generation 1; no live inference or production rollout.

The old summary transaction saved usage only when summary/state/audit writes succeeded.
Crashes or duplicate transport jobs could also repeat model requests. A Redis lease could not
preserve provider evidence or distinguish a never-sent request from uncertain acceptance.

1. Add organization-scoped `InferenceBudget`, `InferenceRun`, and `InferenceAttempt` with
   additive migrations fourteen/fifteen. One call has exactly one generation and one admitted
   send in this slice; transport retry keys cannot create inference generations. Composite
   call/claim/organization and run/organization foreign keys enforce ownership. A database
   trigger preserves request/release/source/claim snapshots; sensitive payloads never enter
   safe audit/error projections.
2. Organization row locks serialize token admission, attempt start and settlement. RESERVED
   can be reclaimed after lease expiry because no send was committed; SUBMITTING becomes
   UNKNOWN and cannot authorize another send. The original owner may still save a late
   positive receipt. An attempt marker commits before provider contact. An immutable saved
   response is resumed from its original claim/source snapshot, with the original claim
   version and later-call guards controlling application.
3. Per-day bigint budgets include reported usage plus every outstanding reservation across
   all days. Existing same-day summary usage is imported once as unattributed baseline.
   Known usage, including schema-rejected and above-allocation responses, is recorded once
   independently of summary application. Missing usage stays null and retains its allocation;
   expiry, timeout, HTTP failure, midnight and absent billing deltas do not prove zero cost.
   `Organization.summaryTokensUsed` is only a bounded legacy display projection. The synthetic
   byte/output allocation is an operational admission unit, not an attested token or dollar cap.
4. Receipt persistence precedes summary/state/audit application. APPLIED commits with those
   effects; review disposition has its own transactional `reviewAppliedAt` marker so failure
   after a rejection receipt cannot lose claim-review effects. Replays apply local effects
   once without model resubmission. No process-local or Redis lock governs ownership.
5. SQS/inline review acknowledgement requires the exact scoped UNKNOWN/REJECTED run and
   committed review marker. Busy/unconfirmed exceptions remain retryable/redriveable even on
   the final delivery attempt. Owner/Admin summary status exposes safe state only; retry
   preserves existing summaries and refuses submitted/unknown/rejected runs. It never selects
   a replacement generation. General quarantined-summary recovery remains closed pending its
   distinct approval/recovery proof.
6. Only the fixed synthetic summary adapter is accepted. A configured Anthropic key now makes
   production factory creation fail closed; explicitly constructed LiveClaude comparison
   fixtures remain, with SDK retries disabled and nullable reported usage. Neither new API
   key enables inference. Fireworks's observation task cannot honestly populate legacy
   confidence/representative fields: versioned summary mapping is FW-27. The gateway's void
   progress callback is best effort, so FW-41 must add awaited admission and receipt storage
   for every HTTP attempt before any retrying live integration.

Independent review reproduced and fixed lost rejection application, changed-config allowance
validation and lock-order hazards. PostgreSQL concurrency/rollback and independent-process
SIGKILL tests use only synthetic localhost requests with fsynced acceptance evidence. They do
not establish provider idempotency, dental accuracy, spend caps or real recovery parity.
At this ADR's date, the best-effort post-commit review notification could still be lost; its
transactional replacement is now implemented locally in ADR-079/FW-40, with external delivery
and rollout still open. No production deployment, account mutation, paid inference, speech or calls
were performed. Production rollout must drain old consumers and preserve this evidence on
rollback; this ADR does not authorize deployment or messaging.

## ADR-065 — Journal each native Fireworks request before sending

**Date:** 2026-10-13. **Status:** implemented and verified locally; production routing and
model approval remain disabled.

The gateway's progress callback could describe a request but could not await a reservation
or preserve a response across process death. A retrying worker therefore needed a durable
boundary for each HTTP attempt, separate from validated observations and later claim effects.

1. Require an awaited journal at native transport and gateway entry. The worker's explicit
   durable observation adapter binds scoped terminal call, claim/source versions, request and
   wire hashes, release-policy hash, attempt cap and original send deadline. Migrations16–18
   extend the existing ledger with per-attempt billing day, bounded raw response, completion
   identity/history and fractional elapsed time. Only isolated localhost databases were changed.
2. Commit admission before every fetch, and recheck cancellation and the original deadline
   after storage returns. At most one retry follows an explicit supported HTTP error; its
   response and interpretation commit first, then a fresh full allocation commits. Different
   UTC days cannot erase outstanding liability. The progress callback remains diagnostic.
3. Save complete bounded response evidence before interpreting it. Non-success bodies are
   discarded; status and normalized retry delay are sufficient for retry policy. Known usage
   commits independently of model/finish/schema/semantic rejection or final-result audit.
   Missing usage stays null. Contradictory totals/cache values reject the response and cannot
   release a reservation using a false zero; the database also rejects inconsistent DTOs.
   Invocation usage is unknown if any constituent attempt is unknown.
4. A later owner locally revalidates saved raw evidence without another provider request,
   including after the original send deadline. A response lost before durable storage leaves
   an uncertain attempt that cannot be resent. A cancelled/deadline interpretation with unknown
   usage may be refined once from its immutable saved response; retain the original completion
   in history and never overwrite known component values. A definite parsed interpretation and known usage survive later caller cancellation unchanged.
   Completion identity excludes replay timing so recalculating elapsed time cannot duplicate accounting.
5. A final result requires matching committed attempt DTOs; cached reads create no new send
   lease. Raw receipts survive failure of final-result audit/application. Expired zero-attempt
   reservations refund the exact original allocation under the org lock, clear ownership and
   remain terminal. No refund follows expiry alone when an attempt may have been sent.
6. Keep the production summary handler synthetic. The new adapter returns versioned reviewed
   observations but does not apply them to claims, create legacy confidence/representative
   fields, replace historical summaries or introduce a new API/runtime selector. FW-27 owns
   that workflow; FW-40 owns notifications. Credentials alone cannot activate a release.

Independent review found and corrected cancelled-response replay lockout, contradictory usage
settlement and a permanently held unsent reservation. Real localhost transport exposed the
fractional-timing schema mismatch and cached-result lease contention. Process proofs kill
workers at durable boundaries and compare separate fsynced synthetic provider acceptances;
they also cover cancellation while a real admission transaction is blocked. These are local
invariants, not provider idempotency, accuracy, end-to-end clinical evidence or dollar caps.
No paid inference, speech, call, account mutation, production migration or deployment ran.

## ADR-066 — Immutable native observations and exact-version biller review

**Date:** 2026-10-13. **Status:** accepted for local implementation; not deployed.

Native Fireworks observations do not contain the legacy confidence/representative fields, and
an acknowledged payer statement is not financial settlement. The application needs inspectable
sources and review receipts without fabricating a CallSummary or mutating claim/payment state.

1. Store append-only ClaimObservation rows per durable inference run and append-only review
   receipts, protected by tenant-scoped foreign keys and database immutability triggers.
   Freeze output, exact source text, request/source hashes, release/task/prompt/schema versions
   and provenance. Publish the observation, APPLIED marker and safe audit atomically; preserve
   provider usage independently so application failure cannot erase spend or cause a resend.
2. Bind one source to a persisted final CallEvent on the run's call. Its identifier contains
   the event ID, and its version is SHA-256 of exact raw text. A new reservation requires the
   latest final event; replay/publication verify the original bound event. Publication holds
   a shared event lock while verifying, avoiding a validation-to-publication mutation gap.
   Provisional, missing, mismatched and fabricated sources fail closed.
3. Append publication versions for history, but use original CallIntent creation chronology
   (legacy Call creation as fallback), then call ID, to choose current evidence. Reconciliation
   can create an older call later; receipt arrival must not make its evidence current.
4. Require a stored organization billing role, exact observation digest and claim version
   for acknowledgment/dismissal. Dismissal needs a note. Changed claims, newer calls and
   superseded observations and changed/missing final transcripts reject new reviews. Identical retries return the original receipt,
   even if later work makes the finding stale. A review is a snapshot decision; an overlapping
   later call may subsequently make it stale, which current eligibility and UI disclose.
5. Expose scoped list, saved-result publish and review APIs, generated SDK types and an evidence
   section on claim detail. Display payer-reported amounts as unverified and label synthetic
   data independently of provider provenance. Preserve reviewed history alongside stale
   warnings. Actor-attributed access audits precede GET/POST evidence responses, including
   retries; failed audit withholds the response. No review writes claim status, confirms payment
   or dispatches external actions.

This completes the local publication/review portion of FW-27. One generation per call remains:
explicit replacement authorization and automatic native job routing require follow-on work. Both model releases remain unapproved; synthetic/local HTTP
proofs do not establish dental accuracy or external parity. No provider generation, speech,
real calls, production migrations or deployments ran.

## ADR-067 — Explicit same-call regeneration and recovery without another send

**Date:** 2026-10-13. **Status:** accepted for local implementation; not deployed.

A corrected transcript needs a new observation while preserving the original finding, review,
and provider liability. Retrying an interrupted HTTP request must not silently authorize a
second generation or erase an uncertain provider send.

1. Add immutable tenant-scoped `ObservationRegeneration` approvals (migrations 20/21). An
   Owner/Admin approves the exact claim version, latest final transcript, prior observation/run,
   next generation, release policy and implementation artifact, with a reason and opaque
   idempotency key. Approval lasts 15 minutes. Identical actor/key/reason/preview retries return
   the original authorization before current-source checks; a changed binding conflicts.
   Store the parsed release as a serialized JSON scalar to preserve policy-hash field order.
2. Derive generations only from durable approval. Recheck stored role, current claim/source,
   latest call, supersession, approval expiry and policy/artifact before new reservation and
   every new attempt. Unknown/active prior work cannot authorize replacement. Completed failed
   responses retain unknown usage holds. A proven-unsent failure requires zero attempts/usage,
   exact durable failure evidence and an audit before a separately reviewed generation.
3. Preserve all observations and reviews; currentness follows original call chronology, then
   inference generation, then publication version. A newer unexpired unused approval or any
   newer run prevents reviewing the old finding (`NEWER_GENERATION`). Late older publication
   cannot displace a newer generation.
4. Execute explicit regeneration synchronously through the existing native journal. The API
   bounds response waiting at 30 seconds and aborts send permission on disconnect/timeout;
   database work may settle later, so callers recover the exact saved authorization. No new
   background queue is implied. The UI preserves the frozen submission/key after an ambiguous
   response, checks saved work, and resumes that ID or explicitly retries the identical body.
5. Final receipts publish locally without credentials. Raw-receipt recovery validates the saved
   approved manifest and current implementation pin in replay-only mode, even after original
   approval/deadline expiry. It requires durable evidence, ignores injected transport, forbids
   new attempt admission and uses a transport that cannot send. A saved503 cannot trigger a
   fresh retry. Normal sends recheck release validity after awaited admission.
6. Keep runtime model releases CANDIDATE and automatic jobs synthetic. API keys and the new
   optional artifact pin do not activate an approved release. Source/request/model/endpoint
   overrides are never accepted from clients. Every evidence response requires a safe actor
   access audit. Regeneration changes no claim status, payment, legacy summary or external action.

Real Postgres, native synthetic transports and a separate-process SIGKILL proof verify local
execution/recovery; browser checks use mocked auth/API. These are not live dental quality,
provider contract evidence or production parity. AWS remains unchanged. Automatic native job
routing, release evaluation/approval, voice and supported real connectors remain open.

## ADR-068 — Automatic native findings through durable post-call jobs

**Date:** 2026-10-13. **Status:** accepted for local implementation; not deployed.

The durable native adapter and approved regeneration API did not participate in ordinary
post-call jobs. Existing consumers, delivery retry, operations recovery and call detail understood
only legacy summaries, so a native response could remain invisible or lack a safe completion path.

1. Reuse `summary.generate` across BullMQ, inline and AWS SQS. Select new work explicitly with
   `SUMMARY_ANALYSIS_PROVIDER` (default SYNTHETIC) and `OBSERVATION_RELEASE_ID`. Existing generation
   one runs always retain their persisted provider/request. There is no provider fallback and
   queue payloads cannot select models, sources, data class or generations. A concurrent provider
   selection mismatch is retryable, never a successful unsupported-provider disposition.
2. Build native requests from scoped terminal calls and the latest final event on that call.
   Default to PROTECTED; synthetic data class and transports are trusted constructor-only test
   seams. Native publication produces immutable findings, not fabricated legacy summary fields
   or financial state transitions. Delayed analysis of an older call is permitted; existing
   chronology/currentness rules prevent it from displacing newer evidence.
3. Migration22 stores an immutable serialized release manifest on InferenceRun. New native
   reservations bind it, and each new HTTP attempt rechecks approval/artifact/current claim and
   final transcript. Saved raw responses recover with the archived manifest and matching current
   implementation artifact, even after expiry or catalog removal, in no-send replay mode. Fresh
   sends still require the exact release to remain approved in the current catalog. Final
   results publish without configuration. Legacy null snapshots are not backfilled; generation2
   can rely on its existing immutable authorization snapshot.
4. Busy owners, missing/unapproved configuration, admission budget/source problems before a
   terminal result, and persistence failures remain delivery failures. A durable terminal
   rejection (including stale source or retry-budget denial after reservation) is not resent.
   UNKNOWN/REJECTED completes delivery only after a review marker and
   safe audit commit; no claim/financial transition follows. Unknown acceptance is never resent.
   Expired zero-attempt reservations settle from saved identity without keys or artifact config.
   Native publication and review dispositions can close a quarantined operations command only
   after its exact durable evidence is bound to the reviewed recovery snapshot.
5. Expose safe provider/observation/review status to authenticated same-organization users.
   Owner/Admin delivery retry can recover saved results/raw receipts or persist missing review
   effects after ownership expiry, without submitting another model request;
   it never creates a replacement generation. Call detail uses bounded visible polling, explicit
   refresh and a link to claim findings; findings refresh respects organization/user cache scope.

Checked-in model releases remain CANDIDATE. Credentials and a selector cannot establish approval,
dental quality, provider-contract suitability or production readiness. Validation uses localhost
Postgres and synthetic providers; no paid inference, real calls or AWS deployment is implied.
Model evaluation/approval, operational monitoring, voice and supported connectors remain
required by the full objective. The notification outbox gap recorded here is locally addressed
by ADR-079; external notification delivery and rollout remain open.

## ADR-069 — Independent reference annotations and deterministic evaluation evidence

**Date:** 2026-10-13. **Status:** accepted for local tooling; no model approval.

The native gateway's structural and lexical checks cannot establish payer attribution,
negation handling, dental correctness or settlement. Reusing expected labels as fake model
outputs would create circular evidence. FW-15/16 therefore adds a separate `@dentabill/evals`
workspace with a complete offline seed, score and verification workflow.

1. Reference annotations are authored independently. The initial 25 examples remain DRAFT,
   synthetic and DEVELOPMENT, with explicit rationale and prohibited interpretations. These
   are engineering hypotheses, not domain adjudication. An adjudicated record must retain two
   distinct reviewers' original annotations, evidence references and input digests, plus final
   adjudication bound to the entire case. Declarations alone cannot prove qualifications.
2. Corpus and result schemas are strict. Every declared case must have exactly one result
   bound to the exact target-adjusted request. Missing, extra, duplicate or swapped entries
   reject the evaluation. Practice/patient/claim/scenario groups, claim IDs and exact duplicate
   source texts cannot cross development/calibration/held-out partitions. Undeclared near
   duplicates still need human detection; this seed is not an untouched evaluation set.
3. Scoring separates schema/lexical validity, complete reference values, exact field-bound
   citation agreement, coverage and abstention. Errors, malformed outputs and failed requests
   stay visible. Null fields on abstention do not generate trivial successes. Every tag/split
   has denominators; empty rates are null. Citation multiset agreement is deliberately
   conservative and does not establish entailment or clinical truth.
4. Usage counts attempt receipts once, including failed/retried work; unknown usage is not
   zero. Costs and measured human review seconds remain null. Saved latency is unverified
   reported latency. Field/citation edits are a correction proxy. The correlated draft seed
   cannot justify a confidence interval or production quality threshold.
5. The CLI's seed baseline calls the existing fake gateway with no registered outputs and
   therefore abstains. Score performs no inference. Verify recomputes the full report and
   review packet, including original inputs, target policy, current evaluator/gateway source
   and dependency fingerprints. Artifacts use exclusive private local files. Closed error
   codes and redacted reports exclude transcript/output bodies.
6. Imported provenance and review IDs remain unauthenticated declarations. Every review
   packet keeps `productionApproval: false`; this tool has no authority to promote a release.
   Runtime model policy is unchanged. Actual provider capture, independent human adjudication,
   ratified thresholds, applicable vendor evidence and authorized deployment remain required.

No new inference provider, paid request, production migration or deployment is introduced.

## ADR-070 — Bounded synthetic contract discovery before release approval

**Date:** 2026-10-13. **Status:** accepted for local capture tooling; no production approval.

FW-42 encountered a bootstrap dependency: production release approval requires a measured
response-model identity and serving evidence that cannot be honestly populated before a first
response exists. Credentials and publisher model cards cannot supply that evidence. Introducing
fictional release IDs/evidence or weakening normal gateway approval would conceal the gap.

1. A separate discovery transport shares the fixed US host, bounds, cancellation and awaited
   journal implementation. It returns only capture status, attempts and usage after saving raw
   JSON; it never returns a validated observation, model identity or generated content. The
   ordinary gateway and expected-model transport retain their existing approval/identity rules.
2. A local capture plan freezes at most25 synthetic cases, one exact candidate, request bytes,
   code/dependency fingerprint, host/path, account digest, current price/context/license evidence
   and a 24-hour execution window. The target remains CANDIDATE. An exact plan-digest confirmation
   is a trusted local operator action, not authenticated proof of a human's authority.
3. The whole inventory reserves a conservative micro-USD allowance before execution, using
   uncached input and completion rates at the full documented model context on both sides.
   This intentionally over-reserves reasoning until measured, rounds upward and never refunds
   uncertainty. It is not a verified provider-side invoice cap; regional model mapping and actual
   usage/billing still need evidence. Reported counts above the bound stop further cases.
4. One immutable admission publishes identity and its allowance together before HTTP. Private
   0700/0600 records use temp-file fsync, exclusive atomic link, then directory fsync. Response
   bytes precede interpretation; an interrupted receipt replays without sending. An admission
   without a response retains liability and becomes UNKNOWN only after the same-host owner is
   confirmed dead. A live/reused PID blocks takeover. NO_SEND claims the same slot to prevent a
   cancelled concurrent runner from masking another runner's provider request.
5. Reverse publication-order reads validate every receipt and final-result binding. Raw usage
   is checked again on restart so an earlier cancellation receipt cannot hide a known overrun.
   Every frozen case retains a disposition; missing usage/failures never become free or accurate.
6. The CLI has separate prepare, inspect and run commands. Only run uses a key and verifies its
   exact account read-only before sending. It cannot buy credits, change account policy, approve
   a model, touch application data, migrate/deploy AWS or place calls. Local filesystem durability
   is not a distributed/account-wide spending service. Authorized runs must not be cloned,
   relocated, edited or deleted to obtain another allowance.

Actual read-only account/model evidence is in the provider register. Fake HTTP/process tests
validate mechanics only. First real discovery requests require the concrete spending scope to be
confirmed; quality measurement then requires a reviewed synthetic-evaluation release and normal
gateway captures. Qualified reference review and the full connector/voice/product scope remain open.

## ADR-071 — Explicit CSV source identity and non-destructive import reports

**Date:** 2026-10-13. **Status:** implemented locally; deployment and real PMS evidence pending.

The prior importer discarded the detected source and source patient reference, treated
`(organizationId, claimNumber)` as identity without a unique constraint, checked outside
transactions, and committed 500-row chunks independently. Same-file/concurrent duplicates
could be inserted; changed and cross-source claims could be silently skipped. No existing
legacy identity can be inferred safely from that data.

New CSV claims use `(organizationId, sourceSystem, sourceNamespace, sourceClaimId)`.
The source database namespace is explicitly declared by the operator, and `SourceClaimId`
is explicitly exported; only Open Dental’s documented internal `ClaimNum` has a native
alias. Display identifiers, DOB and subscriber IDs are never fallbacks. Optional source
versions are opaque. The nullable expand-only migration preserves every legacy row,
adds a scoped unique index and complete-provenance CHECK, and makes imported provenance
immutable. Legacy duplicates remain reportable rather than deleted or merged.

The importer holds an organization NO KEY UPDATE lock across lookup, insert chunks and
aggregate audit. A keyed fingerprint binds normalized fields plus all exact source cells
(sorted normalized headers), including currently unmodeled data; raw cells remain transient.
Equal rows deduplicate. Conflicting same-file identities are all withheld. Changed source
records and legacy display matches are reported with no mutation of the existing claim.
The unique index additionally fences writers outside this importer. Namespace and hash-secret
changes require intentional reconciliation; an operator declaration is not authenticated
PMS identity. A source-format change can still require reviewed cross-system reconciliation.

The UI requires the source database, separates unchanged rows from conflicts, exposes row
outcomes/links and downloads a report without raw source data. Missing source IDs are visible
row outcomes, never invented values. CSV parsing rejects ambiguous headers/aliases, malformed
records, invalid calendar dates, out-of-range amounts and invalid UTF-8. A record-aware preview
bounds parsing before normalization at 5,000 data records; no newline counting is used.
A local real-Postgres migration replay preserves duplicate reviewed records byte-for-byte;
concurrent uploads and a late-chunk failure are covered by real database tests.

This slice implements import admission/reporting, not reviewed source updates or real source
synchronization. FW-43 tracks versioned source reconciliation and legacy binding; FW-21 and
contracted connectors retain their full scope. No production migration, deployment or
third-party request is authorized by this decision.

## ADR-072 — Immutable procedure and coverage import snapshots

**Date:** 2026-10-13. **Status:** implemented locally; external connector/deployment evidence pending.

Claim-level code arrays cannot identify procedures for partial payment or reversal allocation.
Codes may repeat across teeth and source procedure IDs are not the same as submitted claim
line IDs. Coverage order alone does not identify the payer billed by a secondary claim.
Current Open Dental documentation distinguishes ClaimProc billed fees from procedure fees,
quantities, estimates and adjustments; not every ClaimProc is a billed line. This decision
models an explicit custom import contract, not an inferred native PMS adapter.

1. Optional `ClaimLines`/`Coverages` JSON columns preserve explicit source facts. Per-line
   billed totals reconcile exactly in integer cents; quantity is independent and nullable.
   Repeated submitted codes survive with distinct source line IDs. Raw location/numbering
   system text is bounded, never restricted to adult teeth1–32 or interpreted as clinical truth.
   Unknown child keys, invalid dates/totals, duplicate identities and ambiguous target coverage
   reject the entire CSV row. Upload bounds include10,000 children and512 KiB per details cell.
2. Expand-only migration24 adds `ClaimSourceDetails`, `ClaimSourceLine`, `ClaimSourceCoverage`.
   Composite tenant/claim foreign keys, scoped child/position/sequence uniqueness, admission
   checks and deferred exact counts/totals/target checks seal the snapshot at commit. The
   schema rejects updates, additions and individual deletion while the claim exists; existing
   parent-claim cascade deletion still works. No legacy row or reviewed state is backfilled.
3. Snapshot admission requires an identified source claim and its current amount. Subsequent
   local claim corrections do not change imported facts. Parent, snapshot, child chunks and
   aggregate audit share one transaction. A details-specific fingerprint prevents an older
   unmodeled JSON export from being mistaken for a fully imported snapshot on replay.
4. Coverage sequence and `isClaimCoverage` are separate explicit facts. Source subscription,
   plan, subscriber and patient-member IDs remain distinct and nullable. This display/import
   slice never populates outbound subscriber identity, verifies eligibility or changes financial
   state. The current adapter continues to require its own explicit subscriber identity.
5. GET detail exposes scoped ordered source facts; POST/PATCH/list retain their summary
   response shapes. The claim page separates original totals from current local amounts and
   paginates procedure lines. Detail cache keys include the selected practice and status edits
   preserve the snapshot through refetch. Summary-only claims show absent detail rather than
   fabricated one-line procedures.

The contract and fabricated upload are documented in `apps/api/test/fixtures/csv/README.md`.
Public sources: [ClaimProcs](https://www.opendental.com/site/apiclaimprocs.html),
[Procedures](https://www.opendental.com/site/apiprocedurelogs.html),
[PatPlans](https://www.opendental.com/site/apipatplans.html),
[InsSubs](https://www.opendental.com/site/apiinssubs.html),
[Claims](https://www.opendental.com/site/apiclaims.html).

Stable line identities enable the next FW-21 slice; payment events, allocations, adjustments,
reversals, reconciliation and source revision approval are not implemented by these snapshots.
No live connector, migration of AWS, production rollout, real payment or parity claim follows.

## ADR-073 — Reviewed remittance evidence with bounded reversals

**Date:** 2026-10-13. **Status:** local implementation; deployment, real remittance connectors and cash evidence pending.

A payer's remittance reports adjudication; it does not prove receipt, posting, settlement or
incremental recovery. CMS distinguishes EFT transfer instructions from ERA explanations and
allows one payment across multiple claims. Its Medicare recoupment example shows a corrected
claim reversal preceding actual recoupment; that example is Medicare-specific, not a universal
payer rule. Open Dental likewise separates claim procedure insurance amounts from batch checks,
estimates and write-offs. We preserve these distinctions rather than treating a reviewed report
as a bank transaction.

1. A strict custom version1 JSON contract imports one claim-level PAYMENT or REVERSAL event.
   USD amounts are exact signed decimal strings. Line amounts decompose the claim report;
   adjustments retain independent signed amounts and raw code/reference fields. The source
   declares COMPLETE, PARTIAL or ABSENT line detail. Missing line/coverage identities remain
   unmatched; procedure codes, claim numbers and traces are never identity substitutes.
   Provider-level adjustments, native835 parsing, cash movements and PMS postings are outside
   this contract and remain required future work.
2. Source identity is `(organizationId, sourceNamespace, sourceRecordId)`, unique across claims.
   Canonical evidence is keyed with the existing hash secret and bound to its claim. Identical
   retries return the same record; changed evidence conflicts without overwriting history.
   Traces/document IDs are correlation fields and may repeat across independent claim events.
   The operator's declaration is not proof that the evidence came from a payer.
3. A fresh preview binds evidence hash, current claim timestamp and scoped evidence/review
   counts. Stored OWNER, ADMIN or BILLING_STAFF roles can accept/reject. The review stores the
   actor, token, exact evidence/version, original reference and idempotency key. Request replay
   binds the actor and identical decision/token, returning the original result even after later
   ledger changes. A changed preview requires a fresh review; a timeout retains the same request.
4. Accepted rows mirror the imported header, line allocations and adjustments exactly. Rejected
   evidence contributes no amount or children. A reversal can arrive first and remain unresolved;
   accepting it requires an accepted original PAYMENT with matching tenant, claim, source,
   payer identity and explicit coverage. Cumulative reversals cannot exceed the original header,
   each line, unallocated residual or each signed adjustment. None represents actual recoupment.
5. Migration25 adds four immutable tables, scoped restrictive FKs and deferred exact child/mirror
   checks. A review-admission tuple write serializes direct SQL writers even under repeatable-read
   snapshots while preserving claim updatedAt. API transactions lock the claim and commit the
   complete review/children/audit together. Source admission additionally locks the organization
   for uniqueness across claims. No workflow status, claim amount or recovered-revenue metric changes.
6. Financial evidence prevents parent claim deletion; the API returns409 rather than losing
   evidence or emitting a raw FK error. Actor/source references are also retained. This is an
   integrity safeguard, not a completed legal retention/deletion program. Approved correction,
   erasure, legal-hold and backup policies remain production work; immutable evidence must not
   be dropped as an operational workaround.
7. The biller screen imports custom JSON, exposes exact source facts and fresh mappings, supports
   acceptance/rejection and preserves uncertain retry commands. Amount summaries count only
   accepted claim reports, with line allocations and residual as their components. Cash receipt,
   posting and settlement remain explicitly UNVERIFIED. User/practice cache scoping prevents late
   auth resolution or mutation completion from crossing the initiating scope.
8. Import raw and normalized payloads are bounded to1MiB, with500 allocations/500 adjustments.
   Pages fetch at most11 records and return at most10, additionally bounded to2MiB including
   summary/cursor allowance. This leaves room for the Lambda proxy envelope and JSON escaping
   within the documented6MiB synchronous response limit. Clients follow hasMore/cursor and
   cannot assume requested limit equals returned count. Validation/DB errors never log source
   payloads. Read, import, review and exact-replay access have PHI-safe audit entries.

Primary sources checked2026-10-13:
[CMS EFT/ERA](https://www.cms.gov/priorities/key-initiatives/burden-reduction/administrative-simplification/transactions/health-care-payment-remittance-advice-electronic-funds-transfer),
[CMS claim/provider adjustments](https://www.cms.gov/medicare/coding-billing/electronic-billing/health-care-payment-remittance-advice),
[Medicare2012 recoupment example](https://www.cms.gov/regulations-and-guidance/guidance/transmittals/downloads/r1101otn.pdf),
[Open Dental ClaimPayments](https://www.opendental.com/site/apiclaimpayments.html),
[Open Dental ClaimProcs](https://www.opendental.com/site/apiclaimprocs.html),
[AWS Lambda quotas](https://docs.aws.amazon.com/lambda/latest/dg/gettingstarted-limits.html).

The fabricated files in `apps/api/test/fixtures/remittances` are a custom contract, not an ERA,
PMS export or supported connector. Full financial correctness still requires independent cash,
posting, provider adjustments, source reconciliation and defensible attribution. No production
migration, AWS deployment, paid inference, actual call or real financial action ran.

## ADR-074 — Reviewed bank-account source observations before claim reconciliation

**Continuation:** additive migration27 closes the direct SQL/API token admission mismatch.
Cash-only CHECKs count UTF-16 units, reject ECMAScript edge whitespace and Unicode Cc/Cf/Cs,
and validate all required/nullable payload tokens. Migration26 and shared source/remittance
helpers remain unchanged. The migration validates existing rows atomically; incompatible
retained facts stop the migration without rewriting or deleting evidence. Exact verification
and the next dependency are recorded in `docs/HANDOFF_2026-10-13.md`.

**Date:** 2026-10-13. **Status:** local implementation; no bank connector, live receipt,
production migration or deployment approved.

A payer remittance, a PMS deposit and a bank-account transaction are independent evidence.
A bank credit may cover multiple claims and provider adjustments; multiplying it across claim
records is incorrect. Bank feeds can also revise or remove a posted transaction. We therefore
retain source observations at practice/account level before implementing claim reconciliation.

1. Three immutable scoped tables retain source transaction identity, ordered source observations
   and actor-bound accept/reject decisions. Account identity includes source namespace/account;
   system/product cannot change within that tuple. Original source amount/sign convention is
   retained beside the canonical positive-credit/negative-debit amount. Only USD is supported.
2. Explicit positive sourceSequence orders a transaction's revisions. Opaque sourceVersion,
   observedAt and arrival time do not order financial state. Exact source-record retries replay;
   changes to a record/sequence conflict. Newer observations never overwrite earlier evidence.
3. The highest accepted sequence is the accepted history state. It contributes to account totals
   only when it is also the latest observed sequence and POSTED. PENDING/REMOVED/UNKNOWN,
   unreviewed and stale accepted observations are excluded. Rejecting the latest observation
   does not resolve an earlier accepted version's uncertainty. A removed record is not a debit
   or refund; actual debits are separate signed observations. Null remains unknown.
4. Historical accepted pending-transaction links form an account-scoped undirected identity
   graph, including missing parent IDs, sibling replacements, chains and cycles. Later null
   links do not erase identity; a changed non-null link blocks acceptance. For every proposed
   ACCEPT status, the prospective component may contain at most one accepted POSTED transaction.
   Stale accepted POSTED nodes still fence overlap until a nonposted revision is reviewed.
   Traversal above100 IDs blocks review explicitly; it never silently returns a partial safe answer.
5. All cash admission writes the organization tuple without changing updatedAt. This serializes
   direct SQL and repeatable-read writers as well as the API. Review stores exact evidence hash,
   sequence, previous accepted ID, current stored role and org-wide evidence:review counts.
   Composite restrictive references and deferred parent sealing retain complete immutable facts.
6. Fresh previews bind evidence/current state and the organization ledger version. Immutable
   decisions bind actor, payload, token and idempotency key; identical retries return the original
   result even after later imports. Every import/review/read/replay requires a scoped audit;
   audit failures roll back mutations or withhold reads. Closed errors never log source payloads.
7. Five API routes and the actual cash-evidence dashboard implement upload, account summaries,
   transaction/revision paging, previews and review. Fixed provenance is MANUAL_UPLOAD;
   bank verification and settlement remain UNVERIFIED regardless of provider-like input names.
   The UI retains uncertain commands, isolates user/practice caches and requires fresh review
   after409. Custom JSON is not a native bank/PMS export or an authenticated integration.
8. Raw/canonical imports are limited to64KiB. Pages return at most100 records and2MiB, sometimes
   fewer than the requested count. Account summaries cover whole accounts represented on the
   returned transaction page, so the envelope is bounded; there is no cross-account total.

Token admission follows [ECMAScript trim](https://tc39.es/ecma262/multipage/text-processing.html#sec-trimstring)
and the [Unicode category database](https://www.unicode.org/Public/17.0.0/ucd/extracted/DerivedGeneralCategory.txt).
The cash-only ranges match Unicode15–17; regressions compare the database rules with the running
JavaScript engine's categories and trim behavior, including every forbidden scalar and adjacent
boundaries. Runtime Unicode upgrades must keep these checks green before release.

Primary sources checked2026-10-13:
[CMS EFT/ERA](https://www.cms.gov/priorities/key-initiatives/burden-reduction/administrative-simplification/transactions/health-care-payment-remittance-advice-electronic-funds-transfer),
[CMS claim/provider adjustments](https://www.cms.gov/medicare/coding-billing/electronic-billing/health-care-payment-remittance-advice),
[Open Dental deposits](https://www.opendental.com/site/apideposits.html),
[Open Dental reconciliation](https://www.opendental.com/manual/reconcile.html),
[Plaid transaction lifecycle](https://plaid.com/docs/transactions/transactions-data/),
[Plaid transaction API](https://plaid.com/docs/api/products/transactions/), and
[Plaid Transfer reconciliation](https://plaid.com/docs/transfer/reconciling-transfers/).
Plaid Transactions uses positive outflow; its pending-to-posted replacement can change IDs and
amounts, and posted records can be modified/removed. Plaid Transfer is a different product whose
posted/settled states cannot be reused as bank Transactions or final settlement proof. A future
sync adapter must commit an entire consistent pagination window and checkpoint atomically.

Next: reconcile bank transaction net amounts to remittance batches, then preserve gross claim
allocations and provider adjustments without exceeding cash capacities. A100+80 claim report
with a30 provider deduction yields150 cash, not180. Independent PMS posting receipts, reviewed
external posting, actual supported connectors, source corrections and outcome attribution remain
required. No claim status, payment, remittance amount, settlement or recovered revenue changes
as a side effect of this slice.

## ADR-075 — Explicit remittance batch net and provider adjustments

**Date:** 2026-10-13. **Status:** local synthetic implementation; no external connector,
production migration, posting or bank verification.

A batch can report multiple claims and provider-level adjustments. Claim reports100+80 and a
provider deduction30 yield a reported batch net150. Neither the180 claim total nor accepting
the batch establishes cash received. CMS distinguishes claim and provider adjustments; Open
Dental exposes batch payment amounts separately from individual claim procedure payments.

1. Migration28 adds immutable batch evidence, review, accepted claim-member and provider-adjustment
   tables. Identity is organization/namespace/batch plus a unique namespace/source record. Exact
   replay succeeds; changed evidence conflicts. This slice admits one snapshot per batch. Source
   revisions/corrections remain unsupported; inventing a new batch identity is not a correction.
2. Explicit namespace/record references resolve already reviewed claim remittance events. Full
   signed PAYMENT or REVERSAL amounts are bound to their exact evidence/review/claim IDs. One
   accepted event belongs to at most one batch. Trace, document, payer name and equal amounts
   never infer membership or cash allocation.
3. Provider adjustments retain raw code system/reason/reference/provider/date plus original
   amount and sign convention. Canonical amount is the signed net effect; REDUCTION_POSITIVE
   negates the source amount. Unknown codes remain uninterpreted source facts. No provider
   adjustment becomes a fabricated claim payment, write-off or recovery.
4. Incomplete, unknown and unbalanced observations remain importable/rejectable. Acceptance
   requires COMPLETE detail, all three known headers, exact listed claim/adjustment sums and
   net equality. Provider-only, zero and negative batches are supported. Unknown is never zero.
5. Fresh preview tokens bind batch hash, organization batch ledger counts and exact member
   evidence/review/amount/status. Reviews bind actor, stored role, token and idempotency key.
   Exact retries return the original result. Organization tuple writes serialize admission
   without changing updatedAt. Restrictive composite FKs, exact mirrors, deferred parent sealing
   and direct SQL checks retain complete accepted facts and reject stale repeatable-read writers.
6. Four authenticated routes and the dashboard implement import, paged inbox, preview and
   accept/reject with scoped generated-SDK transport. Successful reads/replays/mutations require
   audit. Raw validation/source/Prisma errors stay closed. Raw, canonical and PostgreSQL JSONB
   representations are bounded to256KiB; arrays to100 each; list pages to20 records and2MiB.
7. Provenance remains MANUAL_UPLOAD; cash receipt, posting and settlement remain UNVERIFIED.
   This is a custom JSON contract, not a native835 parser, authenticated payer/bank/PMS source,
   reconciliation, external posting instruction or recovered-revenue calculation.

Primary sources checked2026-10-13:
[CMS payment/remittance advice](https://www.cms.gov/medicare/coding-billing/electronic-billing/health-care-payment-remittance-advice),
[Open Dental ClaimPayments](https://www.opendental.com/site/apiclaimpayments.html).
Next: reviewed bank-to-batch reconciliation with revision/staleness handling and bounded cash
capacities, then independent PMS posting receipts. Batch corrections, native connectors and
defensible recovery attribution remain open.

## ADR-076 — Reviewed cash-to-batch matches retain reservations until released

**Date:** 2026-10-14. **Status:** local synthetic implementation; no authenticated bank/PMS
connector, verified cash receipt, external posting, settlement or production migration.

A bank source can be revised, removed or replaced after a biller matches it to a remittance
batch. Silently freeing that reservation would let the same reported money be reused. Matches
therefore retain their exact accepted evidence/review bindings and both capacity reservations
until a separately reviewed full release. A fresh source observation can make a match stale;
it cannot erase the decision or change its retry receipt.

1. Migration29 adds immutable `CashBatchMatch` and `CashBatchRelease`, scoped restrictive source,
   review and actor references, direct SQL admission and organization tuple serialization. It
   leaves prior evidence and helper definitions unchanged. The organization timestamp is preserved.
2. Signed nonzero matches support partial many-to-many matching. Both sources must have the
   proposed direction; the cash evidence must be accepted, latest-observed and POSTED, and the
   batch must be accepted. Active absolute match sums cannot exceed either absolute source amount.
   Batch capacity is reviewed net: claim reports180 less provider deduction30 permit150.
3. Historical accepted pending-link components retain replacement identity across revisions,
   missing parents, siblings, chains and cycles. A reservation against another evidence in that
   component blocks reuse until explicit release. A later null never erases an earlier link.
   Traversal over100 source IDs fails closed. Identity remains scoped to source namespace/account;
   this does not resolve two connectors referring to the same real bank account or transaction.
4. Fresh match previews bind both sources, reviews, amount, component, capacities and the six-part
   cash-evidence:cash-review:batch-evidence:batch-review:match:release ledger. Stored roles remain
   OWNER/ADMIN/BILLING_STAFF. Exact retries bind actor, command, token and idempotency key.
5. A full release records WRONG_MATCH, SOURCE_CHANGED or OTHER_REVIEWED_ERROR and requires its
   own fresh preview and exact retry binding. Release never depends on current source validity
   or successful graph traversal, so a stale or overflowed source cannot trap its reservation.
   There is one release per match; partial releases are not supported. No source record is deleted.
6. Mutation receipts remain immutable on replay. Paged reads separately derive CURRENT, STALE
   or RELEASED status. All reads/replays/mutations require scoped audit; audit failure withholds
   reads or rolls back changes. Raw validation/source/Prisma errors stay closed. Five handlers
   use four `/v1/cash-reconciliations` path keys; bodies4KiB, pages default10/max20 and2MiB.
7. The generated-SDK dashboard requires explicit source selection and signed amount, shows
   original source signs separately from nonnegative capacity magnitudes, and preserves uncertain
   retry commands across both actions. User/organization changes clear scoped state. Source labels
   or matching traces never infer a relationship. Provenance is MANUAL_REVIEW; bank verification,
   posting and settlement remain UNVERIFIED and claim cash remains UNALLOCATED.

Primary sources refreshed2026-10-14: [Open Dental reconciliation](https://www.opendental.com/manual/reconcile.html),
[CMS payment/remittance advice](https://www.cms.gov/medicare/coding-billing/electronic-billing/health-care-payment-remittance-advice).
Next: independent PMS posting receipts, explicit source/batch corrections, claim cash allocation
and defensible attribution. Real connectors and authorized end-to-end evidence remain mandatory.

## ADR-077 — Resolve organization identity before tenant rate limits

**Date:** 2026-10-14. **Status:** local regression reproduced and fixed; not deployed.

The installed `@fastify/rate-limit`10.3 defaults route overrides to `onRequest`, before the
application's `requireAuth` preHandler populates organization identity. Two overrides—
PATCH `/v1/me/organization` and POST `/v1/claims/:id/calls`—therefore put every requester into
the same route-local `anon` bucket. Ten anonymous requests or one practice's traffic could
block unrelated practices. Existing recovery/operations routes already use the correct hook.

Set these two overrides to `hook: 'preHandler'`. The installed plugin appends its limiter after
the existing authentication hook, which rejects anonymous requests before the organization
bucket is consulted. Keep10/minute per practice, shared by its users/IPs, and the current global
limiter unchanged. Route overrides replace the global limiter; this is not a new distributed
fleet quota or an anonymous-traffic admission layer. Production infrastructure controls and
deployed multi-instance behavior remain separate operational validation.

Four real-Postgres route regressions fail before the fix and pass after it, proving authentication
ordering, shared practice quotas, different-practice isolation and blocked writes. Focused
rate-limit/me/calls77/77 pass. The test call route uses a nonexistent synthetic claim and cannot
create a call intent or external call. No schema, provider configuration or external action changed.

## ADR-078 — Independent PMS posting observations and retained entry identity

**Date:** 2026-10-14. **Status:** local synthetic implementation validated; not deployed, no authenticated PMS connector or external financial action.

PMS payment headers and procedure-payment entries are separate source facts. Open Dental's
batch API allows a payment header that differs from its claim-procedure payment sum; entry
records can be detached and attached to another partial payment. A payment-record observation
is neither bank receipt nor authorization to write a payment.

1. Migration30 adds immutable PostingSourceReceipt/Evidence/Review/Entry. Identity is scoped to
   organization/source system/namespace/receipt ID; the product is stable within that source
   scope. Exact source-record replay and unique receipt sequence prevent silent replacement.
   Explicit positive source sequence orders the full snapshot; opaque versions, observation
   times and arrival order never substitute. Child source versions are retained separately.
2. The custom PMS_PAYMENT_RECEIPT input preserves nullable signed header and entry amounts,
   original signs, raw statuses and partial/transfer flags, source entry/issued dates, deposit/
   trace references and claim/line/procedure IDs. Source entry ID is distinct from procedure ID.
   PAYMENT/TRANSFER/ADJUSTMENT/UNKNOWN categories remain importer assertions. Native source
   adapters must interpret documented sentinel dates as absent, not meaningful posting dates.
3. Header and entry totals need not match. Known listed subtotal includes every supplied entry
   kind; unknown entry count remains visible. A complete total and header difference exist only
   with COMPLETE detail and known entry amounts (and a known header for the difference). No
   difference becomes a fabricated adjustment, allocation or paid amount. REMOVED has no amount
   or entries and does not establish a refund. Partial and unknown facts remain reviewable.
4. ACCEPT requires the latest observed sequence and a fresh evidence/prior-review/ledger token;
   older evidence may be rejected. Newer unreviewed or rejected evidence makes the prior accepted
   observation stale. Exact actor/command/token/key retries return the original immutable review.
5. One source entry cannot be held by two accepted receipt histories in the same source scope.
   The most recent accepted COMPLETE snapshot replaces its retained entry IDs; accepted REMOVED
   clears them. Later accepted PARTIAL/ABSENT snapshots union observed IDs with retained history,
   rather than freeing omitted entries. Rejected/unreviewed revisions never release identities.
   This reservation is source membership only, not a monetary reservation or cash allocation.
6. Accepted child rows mirror every payload entry/index exactly, including nullable values;
   rejected reviews create none. Scoped restrictive references, deferred seals, organization
   tuple admission, stored role checks, audit and closed errors protect API and direct SQL writes.
   Raw/canonical/JSONB inputs256KiB,100 entries and20-record/2MiB pages bound the workflow.
7. The five API handlers, SDK and dashboard support import, inbox/history, preview and review.
   References remain UNLINKED: acceptance creates no local claim/procedure relationship or total.
   MANUAL_UPLOAD provenance and UNVERIFIED source/bank verification/settlement remain explicit.
   A separate evidence-bound relationship review and real supported read/write connectors are
   required before posting can be reconciled to claims or an external payment action authorized.

Primary documentation refreshed2026-10-14:
[Open Dental ClaimPayments](https://www.opendental.com/site/apiclaimpayments.html),
[Open Dental ClaimProcs](https://www.opendental.com/site/apiclaimprocs.html).
This design preserves their distinct identities and partial-header behavior without claiming
that the custom manual input is a native export, authenticated API capture or connector.

## ADR-079 — Transactional review notifications with frozen delivery identity

**Date:** 2026-10-14. **Status:** partial local implementation; migration 31 applied only to
localhost isolated/shared databases. Local verification recorded below. External delivery disabled;
not merged or deployed.

The earlier post-commit notification could be lost after a summary commit and could not safely
recover an ambiguous submission. Store the review alert with its source transaction, then keep
submission ownership and receipts separate from domain publication and actual email delivery.

1. Migration 31 `20261014190000_review_notification_outbox` adds ReviewNotificationIntent,
   ReviewNotificationDelivery, ReviewNotificationAttempt and ReviewNotificationReceipt.
   Intent/domain publication/audit commit atomically for synthetic summary transitions, native
   observation publication and inference-review outcomes, including approved regeneration.
   Organization/run/purpose uniqueness prevents duplicate intents. No historical backfill or
   rewrite is introduced; prior summaries, observations, financial evidence and audit remain.
2. Immutable intents bind source/request hashes, generation, claim versions, source marker,
   summary/observation and regeneration actor. The oldest eligible OWNER/ADMIN by createdAt/id
   is selected deterministically and its user ID, role and email are frozen. Missing recipients
   block delivery; recipient drift never silently rebinds or resets a blocked intent.
3. The frozen `review-available.v1` payload contains only the recipient and fixed generic
   subject/text/application path, with an independently checked SHA-256 hash and permanent UUID
   delivery key. It contains no patient, claim, payer, amount, transcript or inference content.
   These private delivery fields are omitted from Operations responses and audit metadata.
4. Database admission checks retained source/current claim versions, latest call/generation,
   source transcript, review state and recipient identity. A native human review suppresses
   never-submitted PENDING/BLOCKED alerts atomically; it cannot erase prior submission history.
   A source or recipient change after a submission boundary quarantines further attempts.
5. A one-minute lease, immutable attempt and first-submission timestamp/fixed 23-hour deadline
   are persisted before submission. At most five attempts reuse the same key and identical
   payload within that deadline. Retryable receipts wait at least one minute and honor bounded
   retry-after. Conflicts, exhausted attempts and expired uncertain work quarantine; no new-key
   retry extends the window. Late/wrong leases cannot overwrite receipts or newer ownership.
6. The dispatcher accepts only an explicitly injected SYNTHETIC transport and defaults to
   DISABLED. It bounds each call by 25 seconds, remaining lease and remaining retry window.
   SIMULATED receipts remain distinct from provider ACCEPTED and actual delivery. There is no
   callable live adapter, scheduled live relay, send endpoint, retry control or recipient-rebind
   action in this slice. Existing legacy notification history is retained.
7. Two audited OWNER/ADMIN GETs expose scoped status counts, filtered cursor pages and at most
   five attempt receipts. They return closed reason codes, recipient-binding status and safe
   claim/call links, excluding emails, bodies, hashes, delivery keys and provider receipt IDs.
   The Operations list/history uses the generated SDK and explicitly labels delivery disabled.

Resend documents a 24-hour idempotency window; the local 23-hour deadline is a conservative
application bound, not measured provider behavior. Handoff and delivery remain separate facts.
[Idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys),
[usage limits](https://resend.com/docs/api-reference/rate-limit),
[event types](https://resend.com/docs/webhooks/event-types) and
[retrieve sent email](https://resend.com/docs/api-reference/emails/retrieve-email) were reviewed
read-only on 2026-10-14. No real provider request or message was sent.

**Verification checkpoint:** DB 37 direct invariants plus 1 migration-preservation test pass;
prior inference/observation/regeneration 53 and native accounting 34 pass. Focused producers 69
across 3 files and process/transport 9 pass, including restart/deduplication, competing leases,
expiry without submission, bounded timeout, malformed receipts, retry-after, conflict and receipt-
audit rollback. Migration 31 applied to both localhost databases; API/Lambda/Next builds pass.
SDK 56, notifier 20 and UI 35 plus web typecheck/lint pass. One synthetic 1280/390px component
batch reports no overflow, page errors or axe violations; separate visual review returned ship
and documentation review required no system change. Detector exit 126 provides no verdict.
Focused notification API 15 and affected workspace lint/typecheck 30 pass. Independent API/
dispatcher review found no actionable issues. Full API passes 878/878 across 43 files in 532.38s
(`/tmp/dentabill-notification-api-full.log`). The full worker run passed 144/145 across 12 files;
one existing inference-process test hit its 5-second timeout while the host had 0% CPU idle.
The first two process-test timeouts were aligned to the adjacent crash test's 25-second bound;
the focused recheck passed 3/3 in 5.32s (`/tmp/dentabill-notification-inference-process-recheck.log`).
All 145 worker cases have passing evidence across those runs; this is not a single clean full
145-case rerun. Focused suites overlap and are not summed. No full authenticated-shell or
deployment evidence is claimed.

## ADR-080 — Stable remittance batch revisions and retained reservations

**Date:** 2026-10-14. **Status:** implemented and verified locally. Migration 32
is frozen and applied only to localhost isolated/shared databases. Not merged or deployed.
The preceding FW-40 slice is committed as `4af99ec`; its external delivery remains disabled.

A corrected batch must preserve its source identity, accepted member history and existing cash
reservations. Uploading a replacement under a new batch ID could otherwise bypass ownership or
reuse capacity. Source revision ordering must also remain independent of arrival and review time.

1. Migration 32 `20261014200000_remittance_batch_revisions` adds immutable RemittanceBatch,
   RemittanceBatchRevision and RemittanceBatchMemberOwnership sidecars. It backfills structural
   links only: existing version 1 payloads, hashes, review receipts, member bindings, cash matches,
   releases and timestamps remain unchanged. Existing helper definitions remain intact; new
   versioned admission/link/seal triggers extend the contract. Organization-scoped restrictive
   references and deferred seals prevent missing or forged sidecar bindings, including direct SQL.
2. Version 1 remains an explicitly unsequenced baseline (`sourceSequence: null` in the response
   sidecar, absent from its original payload). Version 2 requires a positive integer sequence and
   a new immutable source record under the original namespace/batch ID. Sequence uniqueness and
   source order govern history; no timestamp, sourceVersion string or arrival order invents a
   sequence. An exact source retry retains the original evidence and hash.
3. Only the latest observed revision can be accepted. A newer unreviewed or rejected observation
   makes prior acceptance stale rather than silently falling back to it. Preview tokens bind
   source/currentness, member bindings, membership changes and ledger state. Review objects stay
   immutable on exact retry, while their response envelope refreshes currentness metadata; the
   entire response is not byte-immutable. History is audited, tenant/batch cursor-bound and paged
   within the existing 20-record/2MiB bounds.
4. Exact accepted claim-remittance events may recur across revisions of the same stable batch.
   Each event's first accepted membership establishes permanent ownership by that batch. Preview
   distinguishes added, retained and omitted members against the prior accepted source revision.
   Omission never releases ownership or permits another batch to claim the event. No cross-batch
   ownership transfer or claim-remittance correction chain is introduced.
5. Cash reservations aggregate by stable batch identity across all source revisions. Existing
   matches become stale when their exact source binding changes, but retain their reservations.
   New matches require the latest accepted observed revision and are blocked while another
   revision has an unreleased match. Only a separately reviewed full release frees a reservation;
   prior match/release receipts stay immutable. Lower, higher, negative or zero corrected nets do
   not silently resize or release existing matches. Zero net is not a withdrawal operation.
6. Five batch API handlers and the generated SDK expose import, list, source history, preview
   and review. The existing batch and cash dashboards show sequence/currentness, membership
   changes and retained reservations. The version 2 download and fixture 07 are fabricated manual
   examples, each preserving its respective original batch identity while changing net 150 to 140. The public v2 download derives from the public v1 example; public and API fixture bytes
   are not identical. Neither rewrites the original evidence.

**Local verification:** DB 27 plus expanded migration preservation 1,
prior financial regressions 344 across 5 files in 131s, SDK 57, focused batch API 71/71 in 39.21s, cash API 66/66 in 33.04s, UI 70, web/API typechecks
and scoped lint pass. Version 1 raw/canonical fixture hashes and review HMAC compatibility remain
verified after revision support. Expanded preservation covers accepted/rejected/unreviewed v1,
active/released cash matches and earlier posting/inference/notification rows and helper definitions.
Independent cash admission/service and batch API reviews found no actionable issues. Migration 32
is applied only to localhost isolated/shared databases; its SQL remains unchanged since freezing.
Full API passes 909/909 across 43 files in 216.61s; API/Lambda builds pass. UI 70 includes the
public v1/v2 download-pair regression. The final coherent 1280/390px actual-component capture
batch reports zero overflow, page errors and axe violations; earlier mismatched batch captures
are excluded. Root nonauthor review returned ship, and the separate documenter found no durable
PRODUCT/DESIGN/sidecar delta. This is synthetic auth/API evidence, not the authenticated full app
or a detector verdict. Next production build passes; batch route is 8.55kB/184kB first load and
cash reconciliation 8.38kB/184kB. Affected workspace lint/typecheck passes 30/30 in 31.268s
(19 cached), after two test-only lint corrections. Counts from overlapping suites are not summed.

This slice does not authenticate source evidence, receive or allocate cash, post a payment or
settle a claim. Reviewed posting relationships, claim cash allocation/attribution, explicit
cross-batch ownership transfer, claim-remittance correction chains and real bank/PMS connectors
remain open, alongside the full original parity plan. No real financial/provider action,
external notification, merge or deployment is authorized by this local implementation.

## ADR-081 — Reviewed posting-entry identity associations

**Date:** 2026-10-14. **Status:** implemented and verified locally. Migration 33
is frozen and applied only to localhost isolated/shared databases. Not merged or deployed.
ADR-080 is the preceding committed slice (`710060b`).

Raw posting references must remain source facts, while a biller can separately review their
association with an imported claim and optional immutable source line. Matching display numbers,
procedure codes or amounts is insufficient, and linking an entry must not mutate financial state.

1. Migration 33 `20261014210000_posting_claim_relationships` adds immutable
   PostingClaimRelationship and PostingClaimRelease tables. Composite organization/source/review/
   entry/claim/line/actor references, organization and claim admission locks, ledger checks and
   direct SQL guards protect the association. There is no historical backfill or modification of
   prior helper definitions, raw snapshots, evidence/review receipts or financial records.
2. Only DENTRIX, EAGLESOFT and OPEN_DENTAL source systems can resolve targets. Source system,
   namespace and source claim ID must exactly match the imported claim and its retained source
   hash. A supplied source line ID requires the exact immutable local source line; a supplied
   procedure ID must agree on that line. Without a source line ID, only a claim-level association
   is allowed, even if a raw procedure reference exists. That procedure remains unresolved;
   duplicate display numbers, repeated procedure codes and monetary similarity are never keys.
3. The posting observation must be the latest observed revision and accepted. Preview binds the
   exact source entry/review/hash/currentness, claim version/source hash, optional line, blockers
   and ledger. Review revalidates those bindings. A newer unreviewed/rejected observation or a
   changed local claim makes a retained association stale; prior acceptance is not a fallback.
4. Link and full-release decisions have immutable actor-bound receipts and audited exact retries.
   A changed request under an existing idempotency key conflicts. List responses separately
   expose dynamic CURRENT/STALE/RELEASED status. Original posting evidence, source references,
   header/detail differences, unknowns and signs are never rewritten by the relationship.
5. An unreleased relationship reserves organization/system/namespace/source-entry identity across
   revisions and receipt IDs, including omitted, removed, rejected or changed entries. Staleness
   cannot free it. A fresh separately reviewed full release frees only that association; it remains
   available when the source or claim is stale. No partial release, automatic relink or transfer
   occurs. Neither linking nor release changes claim amounts/status, cash, posting evidence,
   settlement or recovered revenue.
6. Six authenticated OWNER/ADMIN/BILLING_STAFF handlers provide source targets, filtered history,
   relationship preview/create and release preview/create. Reads/replays are audited; decision
   audits commit atomically. Mutation bodies are 4KiB; history pages are bounded to 20 records/
   2MiB with tenant/filter-bound cursors. Generated SDK and the existing posting dashboard expose
   exact target review, immutable retry receipts, stale reservations and explicit full release.
   Source/bank verification and settlement remain UNVERIFIED; claim cash remains UNALLOCATED.

**Local verification:** DB 68 plus migration preservation 1, SDK 63,
UI 56 and API typecheck/scoped lint pass. Focused API passes 47/47 in 15.42s after an initial 45/47
with two timeout-only failures; a bounded 30-second test/hook allowance resolved them without a
product change. Prior DB regressions have passing evidence for all 292 cases across initial 290
passes plus two timeout rechecks in 721ms under observed host memory paging, not one clean full
rerun. Independent API and SQL reviews found no actionable issue. The synthetic actual-page/hook/
SDK capture batch at 1280/390px reports no overflow, page errors or axe violations and proves exact
create/release retries, explicit release reasons and retained unallocated cash. An initial harness
async assertion needed a bounded wait; no UI product fix was required. Root nonauthor review
returned ship; separate documentation inspection found no durable PRODUCT/DESIGN/sidecar delta.
Detector exit 126 gives no verdict, and this is not an authenticated full-app rehearsal. Full API
passes cleanly: 956/956 across 44 files in 320.50s
(`/tmp/dentabill-posting-relationships-api-full.log`). Affected workspace lint/typecheck passes
30/30 in 1m21.295s (14 cached). API TypeScript, Lambda and Next production builds pass; the posting
route is 11.6kB/184kB first load. Overlapping suites are not summed.
No real source/provider request or financial action ran.

Next independent slice: FW-45 guarded synthetic fixtures/manifest, read-only preflight and a
reproducible walkthrough, followed by authenticated rehearsal and finished-video support. Plan one coherent exact-identity
bundle: CSV claims, remittance 100/80, provider adjustment -30 and batch net 150, cash 150 matched
as 100 then 50, posting header 150/entries 180, then corrected batch 140 and explicit releases.
Use a dedicated localhost demo database and read-only preflight; external configuration remains
absent except intentional Clerk authentication. Actual authenticated rehearsal/recording and asset
integration follow the fixture pack. Existing seed/simulator paths are not demo-ready and no
recording asset exists yet. FW-43 canonical source observations, reviewed legacy binding and additive
source snapshots/application, claim-remittance correction chains, explicit cross-batch ownership
transfer, claim cash allocation/attribution, real connectors and the full remaining plan stay open. Local associations do not prove external
posting, source authenticity, cash receipt, settlement or recovered revenue.

## ADR-082 — Connected synthetic demo bundle and read-only preparation gate

**Date:** 2026-10-14. **Status:** local preparation and startup isolation implemented and verified.
ADR-081 is committed as `8dd6f11`. No migration, public API or product UI change is introduced.
Authenticated rehearsal, recording and landing-page asset integration remain unverified/open.

The earlier seed/simulator path used stale financial assumptions and was not an authenticated
walkthrough of the current source-review workflow. Prepare one coherent synthetic fixture chain
and check a dedicated local environment without silently creating, resetting or modifying it.

1. `apps/web/public/examples/demo/manifest.json` defines `financial-review-v1` and hashes the
   connected custom fixtures. The existing CSV/financial parsers validate exact claim/line/
   namespace references, source signs and expected totals. The sequence is remittance100+80,
   provider adjustment−30/batch150, cash150 matched100 then50, posting header150/entries180 and
   optional same-batch correction140. Posting claim A has an exact line; claim B's transfer has
   no line and its raw procedure reference remains unresolved. These are fabricated manual
   inputs, not authenticated exports or evidence of source/bank verification or recovered revenue.
2. Bundle admission uses strict manifest/contract shapes, bounded regular files, path-safe names,
   symlink refusal, SHA-256 checks and cross-file identity/financial invariants. Hashes establish
   consistency with this local manifest; they do not authenticate a provider. The preflight does
   not import, accept, match, post or otherwise apply the bundle.
3. `demo-preflight.mts` accepts only explicit organization/user and Clerk organization/user IDs.
   It validates configuration before application/client imports and does not call the legacy
   seed/reset/simulator. Database targets must use
   PostgreSQL on localhost/loopback with a `dentabill_demo_` name and only optional public schema;
   application/API origins must be distinct consistent local HTTP origins. Explicit development,
   inline jobs, synthetic analysis, disabled auto-transition and demo interlocks are required.
   Known live-provider/cloud/billing/mail/telemetry settings, Redis/SQS URLs, model-release
   selectors, Clerk webhook secret, NODE_OPTIONS, NODE_PATH, ESBUILD_BINARY_PATH,
   DOTENV_CONFIG_PATH and DEBUG are rejected. Clerk test-key format is the
   intentional exception, and is never reported as successful authentication.
4. The database inspector uses a repeatable-read transaction set READ ONLY and verifies the
   actual database name/mode. Every applied migration must match the current local checksum,
   be finished and not rolled back, with no missing/duplicate/extra migration. The exact local
   organization/user must bind to the supplied Clerk IDs and stored OWNER/ADMIN role; any other
   practice or actor fails the exclusive-demo check. It reads binding/count metadata without
   selecting other tenant facts or writing audit/application records.
5. Successful output is limited to safe status/scenario/manifest-hash/migration-count/role and explicit
   `CLERK_TEST_CONFIGURATION_PRESENT_NOT_VERIFIED`, rehearsal `NOT_VERIFIED` and recording
   `NOT_VERIFIED` markers. Failure exposes a closed reason code, without URLs, credentials or
   raw fixtures. Preflight success cannot stand in for browser authentication, provider proof,
   actor provisioning, server startup or a recording.
6. `DEMO.md` follows the implemented screens with the connected bundle and separates optional
   call/correction chapters. Claims and evidence remain manual/synthetic, cash stays unallocated,
   and no recovered-money narrative is invented. The old `seed:demo --reset`, 40-claim seed,
   `demo:call` and `simulate-live-call.mts` are not the supported walkthrough. Guarded local
   provisioning and an environment-clean launcher remain separate work; raw `pnpm dev`, dotenv
   symlinks or test-header browser bypasses are not a verified launch path.

7. Startup isolation uses a private runtime because the repository's generated Prisma client can
   auto-load `packages/db/.env` through `warnEnvConflicts` after initial configuration validation.
   The outer CLI now validates first, then `prepareIsolatedDemoRuntime` creates a private0700
   temporary directory, copies the tracked schema and uses the installed pinned Prisma generator/
   client with the native engine and automatic installation disabled. Generated metadata must
   contain no configured environment-file paths, and the private tree must contain no dotenv file.
   Generation and esbuild run as separate children with minimal explicit environments. All workspace
   application modules are bundled; only the fresh private Prisma client and trusted pino/pino-pretty
   packages remain external. The command executes with an explicit environment allowlist and its
   output must match the closed JSON report schema. Temporary artifacts are cleaned up on success
   and failure. This trusts the installed Node/pnpm/tsx/dependency toolchain and cannot undo a parent
   preload that already executed; it is not a hostile-host sandbox or authenticated app launcher.

**Local verification:** the earlier115 tests and read-only
smoke remain fixture/financial/database evidence but did not prove startup isolation. Fresh
root checks pass122/122 across5 files in27.53s (bundle29, HTTP flow1, policy82, database4, CLI6;
`/tmp/dentabill-demo-isolated-focused.log`). The isolated-runtime helper separately passes15/15
in5.72s (`/tmp/dentabill-demo-isolated-runtime.log`), including generated metadata admission,
zero dotenv reads under the guard, private Prisma engine initialization, bundled workspace code
and rejected override canaries. This is137 passing cases across two runs, not one combined run.
An admitted real private command against an unreachable database returns the closed
DEMO_DATABASE_UNAVAILABLE report. Independent review found no remaining actionable issue.

A fresh positive smoke of the actual isolated CLI passed after all33 migrations with an exact
OWNER binding and readOnly status (`/tmp/dentabill-demo-isolated-smoke.log`). Migration setup used
a private copied schema/migration chain, pinned CLI and explicit fresh environment. Nonworking
synthetic Clerk test keys left authentication, rehearsal and recording NOT_VERIFIED. Postcheck
retained1 organization/1 actor/0 claims/0 audits; only the newly owned ephemeral database was
removed afterward. Provisioning/dropping belongs to the smoke harness, not preflight. The earlier
manifest formatting changed its own hash but no fixture hashes; no stale hash is pinned as current.

The runtime remediation is verified. Current affected API/dependency lint/typecheck passes24/24
(22 cached,19.697s; `/tmp/dentabill-demo-isolated-checks.log`), and strict CLI.mts typecheck and
API production build pass. The earlier30/30 used a broader pre-fix filter; it is not the current
remediation check count. Test-flow cleanup stays limited to the
two explicit localhost test databases. No additional browser, Next or Lambda build is claimed
for this slice; there is no product UI or runtime API import change. No authenticated Clerk
rehearsal, recording, landing-page asset, production change or real provider/financial action
is claimed.

Next: ADR-083 create-only guarded local provisioning, then an isolated web/API launcher without
dotenv symlinks that reintroduce live configuration. An authenticated walkthrough follows before
recording and integrating the finished asset. FW-43 source observations, reviewed legacy binding,
additive snapshots/application, claim-remittance corrections, cross-batch ownership transfer,
claim cash allocation/attribution and the complete remaining plan stay open.

## ADR-083 — Create-only isolated synthetic demo provisioning

**Date:** 2026-10-14. **Status:** implemented and verified locally.
ADR-082 is committed as `be680d6`. No new schema migration, public API or product UI change is
introduced. The app launcher, real Clerk rehearsal, recording and landing asset remain open.

The supported walkthrough needs a fresh dedicated database and exact actor binding before the
read-only preflight can pass. Bootstrap those facts through a separate isolated command without
reusing the legacy seed/reset/simulator or importing workflow fixtures.

1. `demo-provision.mts` and the existing preflight entrypoint are thin wrappers around
   `command-cli.ts`. The shared runner validates the explicit localhost/demo-name, local-origin,
   synthetic-mode and external-configuration rules before importing the private runtime. It
   generates a provision UUID, executes only the bundled command with the environment allowlist,
   validates a closed report with a matching process exit status and disposes private artifacts.
   ADR-082's installed-toolchain trust and inability to undo an already-run parent preload remain.
2. The provision command admits only the private runtime's schema path, verifies the connected
   fixture manifest and stages the complete migration chain before starting database work.
   Bounded regular-file/no-follow reads and SHA-256 comparisons preserve the checked SQL bytes;
   a versioned digest binds the sorted migration names/checksums. The private tree contains only
   those migrations and the known PostgreSQL lock file. No new migration is added by this slice.
3. The maintenance connection must identify the actual writable `postgres` database. CREATE
   DATABASE runs outside a transaction with a strictly admitted, quoted fresh `dentabill_demo_`
   identifier and `template0`. Existing targets and concurrent creation are refused. There is no
   reset, drop, resume or automatic creation retry. The pinned Prisma migration CLI applies the
   private staged chain with a minimal explicit environment; it does not use repository dotenv.
4. A read-only transaction verifies the actual target, every exact finished/non-rolled-back
   migration checksum and empty workflow/bootstrap tables. One transaction then creates exactly
   the supplied organization/user and Clerk binding, a synthetic Owner, a Delta Dental payer
   configuration using synthetic NPI `9999999999`, and one mandatory `demo.provisioned` audit.
   The audit binds the provision UUID, scenario, manifest hash and migration digest/count; failure
   rolls back all bootstrap facts. No claims, calls, inference, notifications, billing usage or
   financial evidence are imported or generated.
5. A second read-only check verifies the exact actor/practice/payer/audit facts, migration journal
   and absence of workflow data. Only then may stdout report PROVISIONED with provision UUID,
   database name, actor/audit IDs, manifest hash and migration digest/count. Authentication,
   authenticated rehearsal and recording remain NOT_VERIFIED. Configured test-key presence does
   not prove a Clerk session or authorize an external action.
6. Failures expose a closed code, phase and database state without credentials or raw error output.
   Acknowledged creations are preserved after migration/seed/postcheck failures. Create ambiguity
   is CREATE_OUTCOME_UNKNOWN; a child, cleanup or report failure that prevents the parent from
   knowing the outcome is OUTCOME_UNKNOWN. Such uncertainty must never claim NOT_CREATED. An
   existing target stays EXISTING_UNCHANGED and must not be modified by a subsequent invocation.

**Local verification:** 15/15 database cases pass in 37.86s, including competing processes, existing
refusal, migration-failure preservation, atomic audit rollback and postcheck failure. Cleanup
removed only seven acknowledged test databases (`/tmp/dentabill-demo-provision-database.log`).
Focused checks pass 27/27 across 5 files in 13.72s: shared CLI 8, contract 2, staging 5, provision CLI 6 and
preflight CLI 6 (`/tmp/dentabill-demo-provision-focused.log`). These are 42 cases across two runs,
not a single combined run. Independent bootstrap review found no actionable issue.

The actual CLI smoke created a fresh target with all 33 migrations and a receipt matching the
stored audit ID/metadata. It held 1 organization/1 Owner/1 payer/1 audit and 0 claims/calls/inference/
billing. A second actual invocation returned EXISTING_UNCHANGED, read-only preflight passed and
before/after hashes of organization/user/payer/audit data agreed. Only the newly owned smoke
database was removed (`/tmp/dentabill-demo-provision-smoke.log`). Nonworking synthetic Clerk keys
were used; authentication and browser rehearsal were not exercised.

Final affected API/dependency lint/typecheck passes 24/24 (22 cached, 18.531s;
`/tmp/dentabill-demo-provision-checks-final.log`). Strict types for both CLI entrypoints and API
production build pass (`/tmp/dentabill-demo-provision-cli-types.log`,
`/tmp/dentabill-demo-provision-api-build.log`). Initial lint findings in UUID validation, braces
and the private-path filesystem annotation were fixed; the final contract/actual provision CLI
recheck passes 8/8 in 4.23s (`/tmp/dentabill-demo-provision-final-recheck.log`). Those cases overlap
the original 42 distinct cases, not 50. No additional browser, Next or Lambda build is claimed
for this CLI-only slice.

Next: an isolated API/web launcher, including a private Next copy that avoids repository dotenv,
then actual Clerk authentication and a complete synthetic walkthrough. Recording and landing-page
asset integration follow. FW-43 source reconciliation, remaining financial corrections/ownership/
allocation work and the full original assignment remain open; no production deployment or real
provider/financial action is claimed.

## ADR-084 — Isolated local API and Next demo launcher

**Date:** 2026-10-14. **Status:** implemented and verified locally.
ADR-083 is committed as `f3c8796`. No new schema migration, public API contract or product UI
change is part of this slice. Authentication, authenticated rehearsal and recording remain open.

The supported synthetic walkthrough needs actual app processes without reintroducing repository
dotenv through ordinary development startup. Extend the isolated preparation/provisioning path
with an explicit launcher and honest startup/stop reports.

1. `demo-launch.mts` delegates to `launch-command.ts`. The parent validates a fresh environment
   snapshot against the same dedicated localhost/demo-name, exact actor, synthetic-mode and
   external-configuration rules, then derives explicit API and web allowlists. The web hostname
   must be `localhost`; API hosts may use any admitted loopback address. API/app ports must be
   distinct and nonzero, with no silent hostname rewrite. Only macOS/Linux owned process groups
   are supported; there is no shell or alternate-port
   fallback. No migration, seed, reset, database drop or fixture import is a launcher action.
2. The private API/Prisma child repeats the complete read-only preflight in the same process before
   importing the actual server, requires configured Clerk keys and binds only the approved loopback
   origin. It emits a closed ready/failure IPC message tied to the launch UUID and origin. Signals,
   parent disconnect and startup failures initiate bounded shutdown, including API/database cleanup.
   Configured Clerk keys are required for the real authentication path, not evidence of a session.
3. Next uses its actual public custom-server interface in development mode against a new private0700
   physical copy of web source, public assets, required configuration and shared UI. Dotenv names,
   build/test/cache artifacts are excluded; other source symlinks and nonregular files are refused,
   with bounded file/tree reads. Two explicit links reuse trusted installed dependencies at the
   private root `node_modules` and `apps/web/node_modules`. Before Next starts, the private copy
   must resolve the installed TypeScript, React types and Node types setup requirements to the
   same files as the source workspace, including the type declaration entrypoints. The
   copied manifest and each fixture hash must agree with that launch's preflight. The web child
   receives local origins and Clerk configuration but no database URL or job secret. Its exact
   loopback listener emits launch-bound ready/failure IPC and has bounded shutdown handlers.
4. The parent accepts only closed messages matching its launch UUID and approved origins, then
   probes API readiness and the served manifest bytes/hash before reporting SERVICES_RUNNING.
   These are startup/asset checks; they do not exercise Clerk login or the authenticated dashboard.
   The report keeps providerMode SYNTHETIC and authentication, authenticatedRehearsal and recording
   NOT_VERIFIED. Installed Node/dependencies remain trusted; the guard cannot undo an already-run
   parent preload and is not a hostile-host sandbox.
5. Child stdout/stderr are discarded; lifecycle diagnostics expose closed codes. Readiness timeouts,
   cancellation or an unexpected child exit stop the owned processes. Shutdown targets only the
   detached groups created by this launcher, with bounded graceful and forced phases, and never
   discovers/kills a process by port. Private files are disposed only after process cleanup is
   confirmed. `forcedBySupervisor` records only the supervisor's forced termination; child
   watchdogs may also exit forcibly, and no job-drain guarantee is made. STOPPED/LAUNCH_FAILED
   preserve the database and expose process-cleanup uncertainty;
   startup/stop itself does not modify workflow data. Normal authenticated app actions may write
   to the dedicated demo database during the later rehearsal.

**Local verification:** the single final combined suite passes 70/70 across8 files in16.80s after
final typing/lint repairs (`/tmp/dentabill-demo-launch-focused-final.log`). Affected API/dependency
lint/typecheck passes24/24 (22 cached,19.979s; `/tmp/dentabill-demo-launch-checks-final.log`); strict
types for all three CLI entrypoints and API production build pass
(`/tmp/dentabill-demo-launch-cli-types.log`, `/tmp/dentabill-demo-launch-api-build.log`). Independent
API/process/web review found no actionable issue after the port-zero, dependency and self-proxy fixes.
The actual CLI smoke passes (`/tmp/dentabill-demo-launch-smoke.log`): SERVICES_RUNNING, exact served
manifest hash, a public page returning200, test headers rejected with401 on `/v1/me`, and SIGTERM
followed by STOPPED. Owned listeners were released, database hashes remained unchanged and only
the owned test database was removed. The smoke used fake/nonworking Clerk keys; it does not
verify authentication, authenticated rehearsal or recording. No additional Next production build
is claimed for this slice without product UI changes; the actual staged Next public page compiled
and served200 during the smoke.

The first actual Next startup failed because the private app lacked root-level TypeScript
resolution. Next attempted npm metadata GETs and cache/log writes, then failed on `workspace:*`
before installation; original workspace packages were unchanged. The failed private runtime was
removed. The second explicit dependency link and three installed setup-requirement checks above
address that path. This failed attempt has no zero-network claim. A later Next/Clerk self-proxy
loop arose because NextURL normalizes127/IPv6 loopback names to `localhost` while Clerk rewrites
the same request. The launcher now explicitly requires web `localhost` and distinct nonzero ports,
without silently rewriting configuration; API hosts retain admitted loopback support. Successful
startup smoke and final combined tests/checks are recorded above. No actual Clerk
authentication, full-app browser rehearsal, recording, finished asset or deployment is claimed.

The requested read-only Clerk CLI discovery identified the development instance/domain and
matching existing admin associated with `usedentabill.xyz`, without printing keys or mutations.
Next: actual Clerk authentication and the full synthetic capabilities rehearsal. The requested full dummy IVR and claim-collection chapter still
needs preparation and proof; no production source cutover, real calls or paid inference is implied.
Recording and landing-page asset integration follow. FW-43 source
reconciliation, financial corrections/ownership/allocation and the full original scope remain open.

## ADR-085 — Real Clerk-authenticated synthetic rehearsal and truthful call evidence

**Date:** 2026-10-14. **Status:** local rehearsal, validation and owned-resource cleanup complete.
ADR-084 is committed as `19f4b9b`. Edited media, landing integration and the full plan remain open.

The user requested an authenticated app demonstration, including simulated IVR/claim-information
collection and a landing-page recording. Exercise the real local UI while describing synthetic
phone, analysis and financial evidence accurately.

1. Read-only Clerk CLI discovery verified an existing development application, instance,
   organization and matching admin. An official short-lived ticket established the real browser
   session. Bearer-token `/v1/me` returned 200 for the exact local OWNER, without test headers.
   Keep credentials, ticket/token/session values and identifying account data out of committed
   files. This proves scoped development authentication, not production or live connectors.
2. The actual UI imported two connected claims and completed one 39-second payer-matched synthetic
   call. Its readable conversation includes synthetic practice/subscriber/service-date information
   and a reference. The saved legacy CallSummary is pending, with Denise, `REF-SIM-DELTA-001` and
   CALL_BACK; claim A remains MANUAL_REVIEW. No native ClaimObservation is created. Scripted menu
   choices and hold text are not audio or actual DTMF; `ivrNavigated` and `humanReached` remain
   false. The inference run is SYNTHETIC/APPLIED with 150 synthetic ledger tokens, not paid usage.
3. The call page selects canonical transcript evidence, separates conversation from operational
   events and displays the exact saved summary. Call/summary reads and cancellation cache updates
   bind to the originating actor/practice. Synthetic representative turns may show collection
   progress without establishing real human contact. The account-switcher label contrast was fixed.
4. The authenticated UI accepted reports of $100 + $80, batch gross $180/provider adjustment −$30/
   net $150, cash $150 and matches of $100 + $50. Posting header $150 and entries $180 stayed
   separate, with an exact-line association for A and a claim-only association for B. Correction
   to $140 staled the old reservations and blocked another match. Full releases of $50 then $100
   preserved history; rematching $140 left cash capacity $10 and batch capacity $0. The simulated
   call did not cause these separately imported facts or establish cash allocation, posting,
   settlement or recovered revenue.
5. Read-only database proof confirms 2 claims, 2 lines, 1 completed call, 1 legacy summary,
   0 observations, 1 inference run/attempt, 3 matches, 2 releases and 2 posting relationships.
   The dedicated local rehearsal database is preserved. Raw footage and review captures are
   evidence of the rehearsal, not an edited/captioned final video or landing integration.
6. The audit UI previously expected an expanded user object and mislabeled recorded actors as
   System. It now uses SDK wire types, recorded actor IDs or Actor not recorded, exact saved-case
   Claim/Call/CallSummary/Organization filters and scoped reads. Future auditLog.list writes record
   the local actor. Historical null actors are preserved rather than assigned an invented identity.

**Verification:** 205 distinct focused cases pass across 147 earlier cases and 58 new audit cases
(API 11 + web 47), not one combined run. The final web run passed 47/47 across five files in 2.51s;
a 24/24 recheck after lint-only repairs overlaps those cases. Final affected lint/type checks pass
30/30 (24 cached, 41.961s). API and fresh isolated Next production builds pass; the private Next
runtime was disposed. Logs: `/tmp/dentabill-demo-audit-api.log`,
`/tmp/dentabill-demo-audit-web-final.log`, `/tmp/dentabill-demo-audit-tests-final.log`,
`/tmp/dentabill-demo-rehearsal-checks-final.log`, `...-api-build.log` and `...-web-build.log`.

Actual authenticated call and audit pages at 1440px and 390px, including the audit drawer, pass
with no overflow/page errors and zero axe WCAG 2 A/AA + 2.1 AA violations. Call contrast failed
initially at 4.21 and passed after the label repair; the failed check is not counted as a pass.
Call QA and read-only database proof are under `/tmp/dentabill-authenticated-demo.cdscvk/`, including
`responsive-call-proof.json`, call-review captures, `verify.sql` and `database-proof.txt`.

The original raw capture completed at 1440×900, VP8, 25fps and 1242.24s, with 11 additional actual
review shots. Keep raw media outside public assets. The created Clerk session is revoked, the
launcher exited 0, owned services are stopped and ports 4480/4481/4490 have no listeners. Owned
private build/test cleanup is complete and the rehearsal database remains preserved.

**Narrow follow-up, not a recording blocker:** eight older authenticated API audit writes omit
local actor attribution and misname `metadata.clerkUserId`: `calls.ts` call.enqueue/list/read and
callSummary.read/retry; `claims.ts` claim.list/read; `reports.ts` report.read. Repair separately
with persisted-actor fixtures, without historical rewrites. This milestone fixes future
auditLog.list attribution only; current financial actions are attributed and verified.

Next: commit ADR-085, edit the actual footage, produce poster/captions/descriptive transcript and
integrate verified user-controlled responsive landing playback. No finished media, deployment,
real payer call, paid inference or external financial action is claimed. FW-43 source observations,
reviewed legacy binding/additive snapshots and the entire remaining financial/connector plan stay
open. FW-45 and the full goal are not complete.
