# Phase Plan

Each phase ends with a working, demo-able slice. Do not start a phase until the previous one is green (build + tests + manual smoke).

## Phase 1 — Foundations (PRD Steps 1–4)
Monorepo, DB schema, auth, dashboard shell.
**Exit:** Logged-in user lands on `/dashboard/overview` with sidebar nav, all 4 dashboard routes render placeholder content, Prisma migrates cleanly against local Postgres.

## Phase 2 — API + Ingestion (PRD Steps 5–6)
Fastify API w/ Clerk JWT, claims router, CSV upload (Dentrix/Eaglesoft/Open Dental), DOB hashing, payer mapping, priority scoring, upload UI.
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
