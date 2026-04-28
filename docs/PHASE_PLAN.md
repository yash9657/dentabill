# Phase Plan

Each phase ends with a working, demo-able slice. Do not start a phase until the previous one is green (build + tests + manual smoke).

## Phase 1 — Foundations (PRD Steps 1–2) — **complete 2026-04-25**

Backend foundations only (UI moved to Phase 2 per ADR-004). Monorepo + shared config + commit/PR enforcement + GitHub Actions CI + local dev orchestration (docker-compose Postgres + Redis) + `@dentabill/logger` (pino + PHI redaction) + `@dentabill/types` (ApiError + Zod + branded IDs) + `@dentabill/db` (Prisma schema + singleton client + audit helper + `getOrgScopedDb` read scope + write middleware) + Architecture / API / Security docs.
**Exit:** `pnpm turbo run typecheck lint test build` green; CI green on draft PR; Prisma migrates cleanly against local Postgres; all three multi-tenancy enforcement layers (write middleware, read helper, audit log) covered by integration tests against a real Postgres.

## Phase 2 — UI + API + Ingestion (PRD Steps 3–6)

UI scaffold (Next.js 15 + Tailwind + shadcn) + Clerk auth + dashboard shell + Playwright e2e + Fastify API w/ Clerk JWT + claims router (over `getOrgScopedDb`) + CSV upload (Dentrix/Eaglesoft/Open Dental) + DOB hashing + payer mapping + priority scoring + upload UI.
**Exit:** Upload a sample CSV → claims appear in `/dashboard/claims` with correct priorities and payer mapping.

## Phase 3 — Queue + Voice (PRD Steps 7–9) — **complete 2026-04-29**

BullMQ queue + call-worker (port-and-adapters Retell, FakeRetell + LiveRetell, ADR-033) + IVR maps + DTMF navigator + hold detector + per-call cap + DLQ consumer + full e2e against real Postgres + real Redis + FakeRetell. API: enqueue (T16), HMAC-verified webhook (T17), cursor-paginated calls list (T18), detail (T19), idempotent soft-cancel (T20), aggregate stats (T25). SDK regen + contract test (T21). UI: Call-Now Pill (T22), live-status indicator unlocking the muted-teal accent (T23), `/dashboard/calls` virtualised list + detail (T24), live KPI tiles (T25). Observability: PHI redact additions (T26), `audit()` Call lifecycle (T27), oncall runbook (T28). Closeout: retro ADR-041 (T29).
**Exit:** A signed-in biller clicks "Call now" on a PENDING claim during business hours; within 5s the claim transitions to IN_QUEUE → CALLING, the muted-teal indicator activates, and the call appears at `/dashboard/calls`. Full lifecycle e2e (T15) green; webhook signature gauntlet (T17) rejects tampered/replayed/missing-header in constant time; per-call cap (T13) sends a 16-min synthetic call to DLQ + MANUAL_REVIEW; runbook walks oncall through stuck-CALLING recovery in under one page.

## Phase 4 — Intelligence + Realtime + Billing (PRD Steps 10–11)

summary-worker → Claude → structured CallSummary (`SummarizerPort` + `FakeClaude` + `LiveClaude` per ADR-041), claim status updates, Resend notifications, SSE live updates on `/dashboard/calls/[id]` for transcript text. Stripe metered billing wired off the existing `audit()` spine. Clerk Organizations migration (synthetic `clerkOrgId="local_<userId>"` retired per ADR-031). Schema migration: `Claim.subscriberId` (the placeholder retired, see ADR-041).
**Exit:** Completed call writes a `CallSummary`, updates `Claim.status`, triggers email, the overview page reflects changes via SSE, and a Stripe usage record posts when a claim transitions to RESOLVED.

## Phase 5 — Deployment (PRD Step 12)

Dockerfiles for api/workers, Railway PG+Redis+services, Vercel web, env wiring, prod smoke.
**Exit:** End-to-end demo on production URL.

## Phase 6 (post-MVP, not scoped yet)

Billing/Stripe metered, analytics charts polish, additional payers, audit log UI.
