# DentaBill Demo Seed Guide

**Demo data engine** — deterministic, idempotent, reproducible seeding for local development and live demos.

## Overview

The demo seed creates a realistic test organization ("Bright Smile Dental") with:

- **1 organization** with 3 enabled payers (Delta Dental PPO, Cigna Dental, MetLife Dental)
- **40 synthetic claims** across realistic statuses:
  - 12 PENDING
  - 2 IN_QUEUE
  - 1 CALLING
  - 10 COMPLETED
  - 6 DENIED
  - 5 MANUAL_REVIEW
  - 4 NEEDS_INFO
- **Calls + transcripts** for all non-PENDING claims
- **Call summaries** with synthetic rep dialogue and denial codes
- **Billing usage records** for metered billing flows

All data is **fully synthetic** — invented patient names, subscriber IDs, NPIs, and claim numbers. Runs are **deterministic** via a seeded PRNG (`Mulberry32`), so reseeding always produces identical data.

## Quick Start

```bash
# Full dev stack
pnpm install
pnpm --filter @dentabill/api exec npm run seed:demo

# In separate terminals:
pnpm --filter @dentabill/api exec npm run dev      # Port 3001
pnpm --filter @dentabill/web exec npm run dev      # Port 3000

# Open http://localhost:3000
```

## Commands

### Seed Demo Data

```bash
pnpm --filter @dentabill/api exec npm run seed:demo
```

Creates or updates the demo organization. Safe to run repeatedly.

### Seed + Reset

```bash
pnpm --filter @dentabill/api exec tsx scripts/demo-seed.mts --reset
```

Deletes the demo org first, then seeds fresh. Useful for a clean slate.

### Simulate Live Calls _(future)_

```bash
pnpm --filter @dentabill/api exec npm run demo:call
```

_(Placeholder for Phase 5 live-call simulation.)_

## Demo Organization Details

After seeding, you'll see:

```
Org ID:         cuid_xxxx...
Clerk Org ID:   demo_bright_smile_org
User ID:        cuid_yyyy...
Clerk User ID:  demo_bright_smile_user
Email:          demo@brightsmile.local
```

Use these IDs for test-header auth when the Clerk dev environment is offline.

## KPI Targets

The seed prints achieved KPI values at the end:

```
📊 KPI Snapshot:
   callsToday: 3 (target >= 3)
   queueDepth: 3
   recoveredThisWeekCents: $487.50 (target ~$400–$800)
   avgCallSeconds: 345 (target: realistic 180–600s)
```

**Expected ranges:**

- **callsToday**: ≥ 3 (status = CALLING or COMPLETED, startedAt within UTC day)
- **queueDepth**: 3–5 (PENDING + IN_QUEUE + CALLING)
- **recoveredThisWeekCents**: ~$400–$800 (sum of claim amounts for RESOLVED claims from last 7 days)
- **avgCallSeconds**: ~180–660 (mean of durationSeconds for calls ending in last 7 days)

## Payers & Denial Codes

All claims use one of three Phase-3 payers:

- `DELTA_DENTAL_PPO`
- `CIGNA_DENTAL`
- `METLIFE_DENTAL`

Denial codes in generated summaries are from the allow-list in `packages/payer-ivr/src/denial-codes.ts`:

- `CO-50` (non-covered service)
- `CO-29` (timely-filing exceeded)
- `CO-97` (benefit included elsewhere)
- `N362` (frequency limit)
- Plus others — see the source file.

## Idempotency & Re-running

The seed is **fully idempotent**:

1. First run: creates org, user, payers, claims, calls, summaries.
2. Second run: finds existing rows by `clerkOrgId` / `claimNumber`, skips duplicates.
3. Subsequent runs: all `upsert` operations succeed without error or duplication.

Safe to run repeatedly in CI, local dev, or staging prep.

## Architecture

### `demo-builders.mts`

Exported, typed builder functions (all `buildX()` helpers):

- `buildOrganization(overrides?)`
- `buildUser(orgId, overrides?)`
- `buildPayerConfig(orgId, payerCode, overrides?)`
- `buildClaim(orgId, overrides?)`
- `buildCall(orgId, claimId, overrides?)`
- `buildCallEvent(callId, eventType, data, timestamp)`
- `buildCallSummary(orgId, callId, overrides?)`
- `buildBillingUsageRecord(orgId, claimId, overrides?)`

**Intentionally NOT exported from `@dentabill/db`** — these are scripts-local and should remain internal.

**Determinism:** All builders use a seeded PRNG (`Mulberry32` with seed `12345`) to generate realistic but reproducible data.

### `demo-seed.mts`

Main entry point. Orchestrates:

1. **Organization setup** — upsert by `clerkOrgId`
2. **User creation** — upsert by `clerkUserId`
3. **Payer configs** — one per Phase-3 payer
4. **Claims** — ~40 claims, distributed across statuses
5. **Calls + Events** — for all non-PENDING claims
6. **Call summaries** — with denial codes and rep dialogue
7. **Billing usage** — records for metered billing
8. **KPI computation** — prints achieved targets

**Flags:**

- `--reset` — delete demo org before seeding (clean slate)

## Local Development Workflow

```bash
# One-time setup
pnpm install

# Seed demo data
pnpm --filter @dentabill/api exec npm run seed:demo

# Boot dev servers
pnpm --filter @dentabill/api exec npm run dev &
pnpm --filter @dentabill/web exec npm run dev &

# Open http://localhost:3000
# Sign in with test headers (if Clerk is offline):
#   x-test-user-id: demo_bright_smile_user
#   x-test-org-id: <org ID from seed output>

# View dashboard with:
#   - 40 claims across 7 statuses
#   - KPI tiles populated
#   - Call transcript playback
#   - Summary details (rep name, denial codes, etc.)
```

### Resetting Between Sessions

```bash
# Clean seed for next rehearsal/demo
pnpm --filter @dentabill/api exec tsx scripts/demo-seed.mts --reset
```

All demo data is deleted and recreated identically.

## Rehearsal Checklist

Before a live demo:

- [ ] Seed runs without errors: `pnpm --filter @dentabill/api exec npm run seed:demo`
- [ ] Dashboard loads: http://localhost:3000
- [ ] Claims list shows ~40 rows across all statuses
- [ ] KPI tiles display non-zero values (callsToday >= 3)
- [ ] Call detail view shows transcript with realistic dialogue
- [ ] Call summary shows rep name, denial code, and nextAction
- [ ] Payer tabs filter claims correctly
- [ ] Settings page shows 3 enabled payer configs

## Troubleshooting

### "Claim not found" after seeding

The Prisma client may be using a stale cache. Restart the API server:

```bash
# In the API terminal:
# Ctrl+C to stop
pnpm --filter @dentabill/api exec npm run dev
```

### "Organization name doesn't update"

Runs use `upsert` with an empty `update: {}` to preserve existing rows. To change the org name:

```bash
pnpm --filter @dentabill/api exec tsx scripts/demo-seed.mts --reset
```

This deletes and recreates the org fresh.

### KPI targets not met

If `callsToday < 3` or `recoveredThisWeekCents` is near zero, check:

1. **System time**: stats queries use `now()` and 7-day windows. If the server clock is off, queries may miss rows.
2. **Timezone**: calls use UTC; if your local time doesn't align, adjust test expectations.
3. **Call timing**: some calls are seeded with `startedAt` set to "now - random hours". If all are > 24h ago, `callsToday` will be 0.

For more details, run the seed with the `--reset` flag and inspect the printed KPI values.

## Files

```
apps/api/scripts/
  lib/demo-builders.mts      ← Builder functions (deterministic, seeded PRNG)
  demo-seed.mts              ← Main entry point (idempotent orchestration)

apps/api/package.json        ← Scripts: seed:demo, demo:call

DEMO.md                       ← This file
```

## See Also

- `docs/PHASE_PLAN.md` — phases and roadmap
- `docs/SESSION_CONTEXT.md` — current task + blockers
- `PRD.md` — full product requirements
- `docs/ARCHITECTURE.md` — system topology and call lifecycle
