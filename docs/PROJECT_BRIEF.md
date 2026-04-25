# DentaBill AI — Project Brief

**One-liner:** AI voice agent that calls dental insurance payers, navigates IVRs, talks to reps, and returns structured claim status + next-action plans to billing teams.

**Users:** Dental billing coordinators (small/mid practices).
**Phase 1 payers:** Delta Dental PPO, Cigna Dental, MetLife Dental.
**Competitor framing:** Dental-focused alternative to LunaBill (YC F25).

## Value

- Manual: ~20 follow-ups/day, 25-min calls, 80% on hold.
- DentaBill: 300+/day, structured outputs, dashboard-driven.

## Stack (locked for Phase 1)

Turborepo + pnpm · Next.js 15 (App Router, TS strict) · Tailwind v3 · shadcn/ui · Framer Motion · Fastify v5 (Zod type provider) · PostgreSQL 16 + Prisma v6 · BullMQ + ioredis (Upstash dev) · Retell AI (voice/IVR) · Telnyx (numbers) · Anthropic Claude (summaries) · Clerk (auth + Orgs = tenants) · Resend (email) · Stripe (metered per call-minute) · Railway (PG/Redis/workers) · Vercel (web).

## Repo layout

`apps/{web,api,call-worker,summary-worker}` · `packages/{db,types,ui,config,queue,payer-ivr}`

## Non-negotiables

- TS strict, no `any`. Zod-validate all API inputs.
- Multi-tenant: every query filtered by `organizationId` (Prisma middleware enforces on writes).
- PHI never logged (no names/DOB/SSN in logs, errors, traces).
- Conventional commits. Workspace imports only across package boundaries.
- pnpm only.

## Core data model (see PRD §5)

`Organization → Users, Claims, PayerConfigs, AuditLogs`
`Claim → Calls → CallSummary + CallEvents`
Priority: `round(min(amount/100,100)*0.6 + min(daysOutstanding*2,100)*0.4)`.

## Phase 1 success

End-to-end: CSV upload → queued claim → Retell call w/ IVR navigation → human reached → transcript → Claude summary → status update + email → visible in dashboard, deployed on Railway/Vercel.

## Source of truth

Full requirements live in `PRD.md` (root). This brief never duplicates it — only compresses. Refer back to PRD only on ambiguity.
