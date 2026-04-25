# Phase Plan

Each phase ends with a working, demo-able slice. Do not start a phase until the previous one is green (build + tests + manual smoke).

## Phase 1 — Foundations (PRD Steps 1–2) — **complete 2026-04-25**

Backend foundations only (UI moved to Phase 2 per ADR-004). Monorepo + shared config + commit/PR enforcement + GitHub Actions CI + local dev orchestration (docker-compose Postgres + Redis) + `@dentabill/logger` (pino + PHI redaction) + `@dentabill/types` (ApiError + Zod + branded IDs) + `@dentabill/db` (Prisma schema + singleton client + audit helper + `getOrgScopedDb` read scope + write middleware) + Architecture / API / Security docs.
**Exit:** `pnpm turbo run typecheck lint test build` green; CI green on draft PR; Prisma migrates cleanly against local Postgres; all three multi-tenancy enforcement layers (write middleware, read helper, audit log) covered by integration tests against a real Postgres.

## Phase 2 — UI + API + Ingestion (PRD Steps 3–6)

UI scaffold (Next.js 15 + Tailwind + shadcn) + Clerk auth + dashboard shell + Playwright e2e + Fastify API w/ Clerk JWT + claims router (over `getOrgScopedDb`) + CSV upload (Dentrix/Eaglesoft/Open Dental) + DOB hashing + payer mapping + priority scoring + upload UI.
**Exit:** Upload a sample CSV → claims appear in `/dashboard/claims` with correct priorities and payer mapping.

## Phase 3 — Queue + Voice (PRD Steps 7–9)

BullMQ queue + call-worker, Retell SDK integration, webhook handler, IVR maps for the 3 Phase-1 payers, DTMF navigator respecting Section-6 timing.
**Exit:** Enqueueing a real claim places a Retell call that navigates IVR and reaches a human (sandbox or test line), with state transitions persisted.

## Phase 4 — Intelligence + Realtime (PRD Steps 10–11)

summary-worker → Claude → structured CallSummary, claim status updates, Resend notifications, SSE live updates on dashboard.
**Exit:** Completed call writes a `CallSummary`, updates `Claim.status`, triggers email, and the overview page reflects changes without refresh.

## Phase 5 — Deployment (PRD Step 12)

Dockerfiles for api/workers, Railway PG+Redis+services, Vercel web, env wiring, prod smoke.
**Exit:** End-to-end demo on production URL.

## Phase 6 (post-MVP, not scoped yet)

Billing/Stripe metered, analytics charts polish, additional payers, audit log UI.
