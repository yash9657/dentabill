# DentaBill AI — Product Requirements Document

## How to Use This File
This is the single source of truth for the entire project. Read it
completely at the start of every Claude Code session before writing
a single line of code. After completing any task, update PROGRESS.md.
Never deviate from the decisions made in this document without flagging
it explicitly.

---

## 1. Product Overview

DentaBill AI automates the most time-consuming task in dental billing:
calling insurance companies to follow up on outstanding claims.

A dental billing coordinator spends 80% of their day on hold with
insurance companies. Each call averages 25 minutes. They can manually
follow up on roughly 20 claims per day. Our AI voice agent handles
300+ per day.

The agent calls insurance companies, navigates their automated phone
menus using DTMF tones, reaches a human representative, collects claim
status and denial reasons, and delivers a structured action plan back
to the billing team via a dashboard.

**Target users:** Dental billing coordinators at dental practices.

**Target payers Phase 1:** Delta Dental PPO, Cigna Dental, MetLife.

**Closest competitor:** LunaBill (YC F25) — we are the dental-specific
version targeting smaller practices they are not focused on.

---

## 2. Tech Stack

Every decision below is final for Phase 1. Do not substitute without
flagging it.

**Monorepo:** Turborepo with pnpm workspaces. Never use npm or yarn.

**Frontend:** Next.js 15 App Router, TypeScript strict mode, Tailwind
CSS v3, shadcn/ui components, Framer Motion for micro-animations.

**Backend:** Fastify v5 with @fastify/cors, @fastify/helmet,
@fastify/multipart, @fastify/type-provider-zod. TypeScript strict mode.

**Database:** PostgreSQL 16 via Prisma v6 ORM. No raw SQL ever.
PrismaClient exported as a singleton from packages/db.

**Queue:** BullMQ with ioredis. Upstash Redis free tier for development.

**Voice:** Retell AI SDK for outbound calls and IVR navigation.

**Auth:** Clerk with Organizations. Each dental practice is one Clerk
organization. All routes under /dashboard require authentication.

**Email:** Resend free tier (3,000 emails/month).

**Payments:** Stripe with metered billing per call minute.

**Deployment now:** Railway for PostgreSQL, Redis, and all backend
services. Vercel free tier for the Next.js frontend.

**Deployment later:** AWS when monthly Railway costs exceed $150 or
a customer requires it for compliance reasons.

**Package manager:** pnpm always.

---

## 3. Repository Structure
```
dentabill/
├── apps/
│   ├── web/              Next.js 15 frontend
│   ├── api/              Fastify REST API on port 3001
│   ├── call-worker/      BullMQ worker for Retell AI calls
│   └── summary-worker/   BullMQ worker for Claude analysis
├── packages/
│   ├── db/               Prisma schema, migrations, client
│   ├── types/            Shared TypeScript types
│   ├── ui/               Shared shadcn component library
│   ├── config/           Shared ESLint and TypeScript configs
│   ├── queue/            BullMQ job definitions and factories
│   └── payer-ivr/        Insurance IVR navigation maps
├── PRD.md                This file
├── PROGRESS.md           Updated after every task
├── .env.example          All environment variable placeholders
├── .gitignore
├── .claudeignore
├── turbo.json
└── pnpm-workspace.yaml
```

---

## 4. Coding Standards

These apply to every file written in this project.

**TypeScript:** Strict mode always. Never use `any`. Use `unknown` and
narrow it. Every function has explicit return types.

**Error handling:** Every async function wrapped in try/catch. API
routes return `{ error: true, message: string, code: string }` on
failure. Never expose stack traces to clients.

**PHI protection:** Patient names, dates of birth, and SSNs must never
appear in any log statement, error message, console output, or
monitoring event. This is non-negotiable.

**Multi-tenancy:** Every database query includes `organizationId` as a
filter. No exceptions. This is enforced via Prisma middleware that
throws if `organizationId` is missing from any write operation.

**Validation:** Zod schemas for every API endpoint input. Validate
before touching the database. Return descriptive validation errors.

**Commits:** Conventional commits format always.
`feat(scope): description` for new features.
`fix(scope): description` for bug fixes.
`chore(scope): description` for tooling and config.
`docs(scope): description` for documentation changes.

**Imports:** Use workspace package imports like `@dentabill/db` and
`@dentabill/types`. Never use relative imports across package boundaries.

**Environment variables:** Never hardcode secrets. Every new env var
must be added to `.env.example` with a descriptive comment on the
line above it.

**Logging:** Use pino for structured logging in all backend services.
Log levels: error, warn, info, debug. Never log PHI. Redact sensitive
fields in the pino config.

---

## 5. Database Schema

### Enums
```prisma
enum Plan {
  TRIAL
  STARTER
  PRO
  ENTERPRISE
}

enum UserRole {
  OWNER
  ADMIN
  BILLING_STAFF
}

enum ClaimStatus {
  PENDING
  IN_QUEUE
  CALLING
  COMPLETED
  DENIED
  NEEDS_INFO
  APPEALING
  RESOLVED
  WRITTEN_OFF
  FAILED
  MANUAL_REVIEW
}

enum CallStatus {
  INITIATED
  NAVIGATING_IVR
  ON_HOLD
  HUMAN_REACHED
  COLLECTING
  COMPLETED
  FAILED
  VOICEMAIL
}

enum PayerCode {
  DELTA_DENTAL_PPO
  DELTA_DENTAL_PREMIER
  CIGNA_DENTAL
  METLIFE_DENTAL
  AETNA_DENTAL
  GUARDIAN_DENTAL
  UNITED_CONCORDIA
  HUMANA_DENTAL
  UNKNOWN
}

enum NextAction {
  RESUBMIT
  APPEAL
  SUBMIT_DOCS
  CALL_BACK
  WRITE_OFF
  RESOLVED
  MANUAL_REVIEW
}
```

### Models
```prisma
model Organization {
  id          String   @id @default(cuid())
  clerkOrgId  String   @unique
  name        String
  npi         String?
  plan        Plan     @default(TRIAL)
  callsUsed   Int      @default(0)
  settings    Json     @default("{}")
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  users        User[]
  claims       Claim[]
  payerConfigs PayerConfig[]
  auditLogs    AuditLog[]
}

model User {
  id             String   @id @default(cuid())
  clerkUserId    String   @unique
  organizationId String
  role           UserRole @default(BILLING_STAFF)
  email          String
  name           String?
  createdAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id])
  auditLogs    AuditLog[]
}

model Claim {
  id              String      @id @default(cuid())
  organizationId  String
  patientDOBHash  String
  patientDOBLast4 String?
  claimNumber     String
  cdtCodes        String[]
  claimAmount     Decimal     @db.Decimal(10, 2)
  payerCode       PayerCode
  serviceDate     DateTime
  submittedDate   DateTime?
  status          ClaimStatus @default(PENDING)
  priority        Int         @default(0)
  lastCallAt      DateTime?
  nextCallAt      DateTime?
  retryCount      Int         @default(0)
  maxRetries      Int         @default(3)
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id])
  calls        Call[]

  @@index([organizationId, status])
  @@index([organizationId, priority])
}

model Call {
  id                String     @id @default(cuid())
  organizationId    String
  claimId           String
  retellCallId      String     @unique
  retellAgentId     String?
  status            CallStatus @default(INITIATED)
  ivrNavigated      Boolean    @default(false)
  humanReached      Boolean    @default(false)
  holdTimeSeconds   Int?
  startedAt         DateTime?
  endedAt           DateTime?
  durationSeconds   Int?
  audioQualityScore Float?
  callCostCents     Int?
  createdAt         DateTime   @default(now())

  claim   Claim        @relation(fields: [claimId], references: [id])
  summary CallSummary?
  events  CallEvent[]

  @@index([organizationId])
  @@index([claimId])
}

model CallSummary {
  id              String     @id @default(cuid())
  callId          String     @unique
  claimStatus     String
  denialReason    String?
  denialCode      String?
  nextAction      NextAction
  confidence      Float?
  repName         String?
  referenceNumber String?
  callbackDate    DateTime?
  amountApproved  Decimal?   @db.Decimal(10, 2)
  notes           String?
  rawTranscript   String     @db.Text
  claudeSummary   String     @db.Text
  createdAt       DateTime   @default(now())

  call Call @relation(fields: [callId], references: [id])
}

model CallEvent {
  id        String   @id @default(cuid())
  callId    String
  eventType String
  data      Json     @default("{}")
  timestamp DateTime @default(now())

  call Call @relation(fields: [callId], references: [id])

  @@index([callId])
}

model PayerConfig {
  id             String    @id @default(cuid())
  organizationId String
  payerCode      PayerCode
  enabled        Boolean   @default(true)
  providerNpi    String?
  groupNumber    String?

  organization Organization @relation(fields: [organizationId], references: [id])

  @@unique([organizationId, payerCode])
}

model AuditLog {
  id             String   @id @default(cuid())
  organizationId String
  userId         String?
  action         String
  resourceType   String
  resourceId     String
  ipAddress      String?
  userAgent      String?
  metadata       Json     @default("{}")
  createdAt      DateTime @default(now())

  organization Organization @relation(fields: [organizationId], references: [id])

  @@index([organizationId, createdAt])
}
```

### Priority Score Formula
```typescript
// Higher score = call sooner. Max 100.
function calculatePriority(
  claimAmount: number,
  daysOutstanding: number
): number {
  const amountScore = Math.min(claimAmount / 100, 100)
  const ageScore = Math.min(daysOutstanding * 2, 100)
  return Math.round(amountScore * 0.6 + ageScore * 0.4)
}
```

---

## 6. IVR Navigation

### How It Works

Each insurance payer has a different automated phone menu. The
`packages/payer-ivr` package contains one TypeScript file per payer
that maps out the full navigation sequence. The call worker loads the
correct map for each claim and executes the steps in order via the
Retell AI DTMF API.

### PayerIvrMap Type
```typescript
// packages/payer-ivr/src/types.ts

export type IvrStep =
  | { type: 'WAIT'; ms: number }
  | { type: 'DTMF'; digit: string; waitBefore: number; waitAfter: number }
  | { type: 'SPEECH'; say: string; waitAfter: number }
  | { type: 'WAIT_FOR_HUMAN'; maxWaitMs: number }

export type PayerIvrMap = {
  payerCode: string
  displayName: string
  providerLine: string
  timezone: string
  hoursStart: number
  hoursEnd: number
  estimatedHoldMinutes: number
  steps: IvrStep[]
  notes: string[]
}
```

### Phase 1 Payer Details

**Delta Dental PPO**
- Provider line: 1-800-765-6003
- Hours: 8 AM to 5 PM CT (America/Chicago)
- Estimated hold: 5 to 12 minutes

**Cigna Dental**
- Provider line: 1-800-244-6224
- Hours: 8 AM to 6 PM ET (America/New_York)
- Estimated hold: 8 to 20 minutes

**MetLife Dental**
- Provider line: 1-800-942-0854
- Hours: 8 AM to 8 PM ET (America/New_York)
- Estimated hold: 6 to 15 minutes

### DTMF Timing Rules

- Wait 2500ms after call connects before sending any DTMF
- Wait at least 1500ms between each DTMF digit
- Wait at least 3000ms after any speech prompt before responding
- When entering NPI digits, wait 800ms between each digit
- If a DTMF press fails, retry once with doubled wait times

### Information to Collect from Representatives

When a human rep answers, the agent collects in this order:
1. Claim status (pending, approved, denied, in process)
2. Denial reason and exact denial code if denied
3. Reference number for this call
4. Representative name
5. Amount approved if claim was approved
6. Next steps the representative recommends
7. Callback date if representative requests one

### Common Denial Codes and Default Actions

- CO-4: Service inconsistent with patient age → RESUBMIT
- CO-11: Diagnosis inconsistent with procedure → RESUBMIT
- CO-22: Coordination of benefits → SUBMIT_DOCS
- CO-29: Filing deadline expired → MANUAL_REVIEW
- CO-50: Non-covered service → MANUAL_REVIEW
- CO-97: Bundled with another service → RESUBMIT unbundled
- PR-1: Deductible → RESOLVED patient responsibility
- PR-2: Coinsurance → RESOLVED patient responsibility
- Frequency limit: → MANUAL_REVIEW check service dates
- Missing tooth clause: → APPEAL with prior records

---

## 7. Design System

### Colors
```
Primary:    #1B4F72  Navy — sidebar, primary buttons, headers
Secondary:  #2E86AB  Blue — links, accents, active states
Success:    #27AE60  Green — approved, completed, resolved
Warning:    #F39C12  Amber — needs attention, on hold, retrying
Error:      #E74C3C  Red — denied, failed, critical errors
Surface:    #F8FAFC  Off-white — page backgrounds
Card:       #FFFFFF  White — card and panel backgrounds
Border:     #E2E8F0  Cool gray — dividers and borders
Text:       #1A202C  Near-black — primary text
Muted:      #718096  Gray — secondary text and captions
```

### Typography

- Headings: Inter Bold
- Body: Inter Regular, 15px, line-height 1.6
- Claim numbers and reference codes: JetBrains Mono
- Minimum font size anywhere: 13px

### Components

Always use shadcn/ui components. Never build form controls, modals,
dropdowns, or tables from scratch. Install components with:
`npx shadcn@latest add [component-name]`

Required components for Phase 1: button, card, badge, dialog, table,
input, label, select, dropdown-menu, toast, skeleton, separator,
avatar, sheet.

### Status Badge Colors
```
PENDING:       gray
IN_QUEUE:      blue
CALLING:       blue with pulse animation
ON_HOLD:       yellow
HUMAN_REACHED: green
COMPLETED:     green
DENIED:        red
FAILED:        red
MANUAL_REVIEW: orange
RESOLVED:      green muted
```

### Layout

Sidebar width: 240px, background #1B4F72, white text.
Top bar height: 64px, white background, 1px gray bottom border.
Content area: white background, 24px padding.
Max content width: 1280px centered.

Breakpoints:
- Mobile under 768px: sidebar collapses to bottom tab bar
- Tablet 768 to 1024px: sidebar shows icons only
- Desktop above 1024px: full sidebar with labels and icons

### Page Specifications

**/ Landing page**
Centered layout. Large headline: "Your dental insurance calls,
handled." Subheadline explaining the product in one sentence.
Two buttons: Get Started (primary) and See How It Works (ghost).
Clean, minimal, no clutter.

**/dashboard/overview**
Row 1: Four equal stat cards — Claims in Queue, Calls Today,
Revenue Recovered This Month, Average Days to Resolution.
Row 2 left 60%: Active Calls Monitor with live call cards.
Row 2 right 40%: Top 5 Priority Claims preview list.

**/dashboard/claims**
Filter bar: Status dropdown, Payer dropdown, Date range picker,
Search input. Buttons: Upload Claims (primary), Queue All Pending
(secondary outline).
Full-width table with columns: Priority dot, Payer, Claim Number,
CDT Codes, Amount, Days Outstanding, Status badge, Last Called,
Actions menu.
Pagination at 50 rows per page.

**/dashboard/calls**
Grid of active call cards, 2 columns on desktop.
Each card shows: payer name, claim number, masked patient DOB,
claim amount, current status with colored left border, duration timer.
Empty state when no calls: centered icon and message.

**/dashboard/analytics**
Four highlight metrics at top.
Charts: Revenue Recovered line chart 30 days, Calls per Day bar
chart 30 days, Resolution Rate by Payer horizontal bars, Denial
Reason Breakdown donut chart.
Export to PDF button top right.

---

## 8. Environment Variables
```bash
# PostgreSQL — from Railway in staging/prod, local Docker in dev
DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/dentabill"

# Redis — Upstash free tier for dev, Railway Redis for prod
UPSTASH_REDIS_REST_URL="https://YOUR_INSTANCE.upstash.io"
UPSTASH_REDIS_REST_TOKEN="YOUR_TOKEN"

# Clerk — from dashboard.clerk.com
CLERK_SECRET_KEY="sk_test_..."
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="pk_test_..."
NEXT_PUBLIC_CLERK_SIGN_IN_URL="/sign-in"
NEXT_PUBLIC_CLERK_SIGN_UP_URL="/sign-up"
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL="/dashboard"
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL="/dashboard"

# Retell AI — from app.retellai.com
RETELL_API_KEY="key_..."
RETELL_AGENT_ID="agent_..."
RETELL_WEBHOOK_SECRET="whsec_..."

# Telnyx — from telnyx.com
TELNYX_API_KEY="KEY..."
TELNYX_PHONE_NUMBER="+15555555555"

# Anthropic — from console.anthropic.com
ANTHROPIC_API_KEY="sk-ant-..."

# Resend — from resend.com
RESEND_API_KEY="re_..."
RESEND_FROM_EMAIL="noreply@dentabillai.com"

# Stripe — from dashboard.stripe.com
STRIPE_SECRET_KEY="sk_test_..."
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY="pk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."

# App
NEXT_PUBLIC_APP_URL="http://localhost:3000"
NEXT_PUBLIC_API_URL="http://localhost:3001"
NODE_ENV="development"

# Workers
WORKER_CONCURRENCY="3"
MAX_CALL_DURATION_MS="1800000"
```

---

## 9. Phase 1 Build Plan

Complete these steps in order. Do not start a step until the previous
one is fully working and tested.

**Step 1 — Monorepo**
Initialize Turborepo with pnpm. Create all app and package directories.
Configure turbo.json with dev, build, lint, and typecheck pipelines.
Configure pnpm-workspace.yaml. Set up shared TypeScript and ESLint
configs in packages/config. Initialize git. First commit.

**Step 2 — Database**
Install Prisma in packages/db. Create schema.prisma with every model
and enum from Section 5. Export PrismaClient singleton. Run first
migration. Verify Prisma client generates without errors.

**Step 3 — Authentication**
Install Clerk in apps/web. Wrap layout with ClerkProvider. Create
middleware protecting /dashboard routes. Create sign-in, sign-up, and
landing pages. Set up navigation bar for both logged-out and logged-in
states. Install and configure shadcn/ui.

**Step 4 — Dashboard Shell**
Build the sidebar layout with all navigation links. Create all four
dashboard pages with placeholder content and correct layout. Verify
routing and responsive behavior.

**Step 5 — API Server**
Initialize Fastify in apps/api. Register all plugins. Add health check
endpoint. Create Clerk JWT verification middleware. Create claims router
with placeholder handlers. Connect to database via packages/db. Add
hot-reload dev script.

**Step 6 — CSV Upload**
Add multipart upload handler. Parse CSV with papaparse. Detect common
column formats from Dentrix, Eaglesoft, and Open Dental exports. Hash
patient DOB with SHA-256. Map payer names to PayerCode enum. Calculate
priority scores. Save claims to database. Build upload modal in frontend
with drag and drop and column mapping preview.

**Step 7 — Job Queue**
Set up BullMQ in packages/queue. Define CallJob type. Create queue
factory. Build call-worker that processes jobs and logs them. Add queue
endpoints to the API. Add queue buttons to the frontend.

**Step 8 — Retell Integration**
Connect call-worker to Retell AI SDK. Implement createPhoneCall with
claim metadata injected into the agent prompt. Build webhook handler
for Retell events. Update call state in database on each event. Enqueue
summary jobs when calls end.

**Step 9 — IVR Maps**
Define PayerIvrMap type. Build Delta Dental PPO map. Build Cigna map.
Build MetLife map. Build IVR navigator service that executes steps via
Retell DTMF API. Handle timing rules from Section 6.

**Step 10 — Call Analysis**
Build summary-worker. Send transcripts to Claude Opus API. Extract
structured JSON with claim status, denial reason, and next action.
Write CallSummary to database. Update claim status. Send email via
Resend when claim is resolved or denied.

**Step 11 — Real-Time Updates**
Add SSE endpoint to API. Publish call state changes to Redis pub/sub.
Subscribe in API and push to connected SSE clients. Connect frontend
EventSource. Update active calls monitor and stat cards without
page refresh.

**Step 12 — Railway Deployment**
Write Dockerfiles for api, call-worker, and summary-worker. Deploy
frontend to Vercel. Add PostgreSQL and Redis to Railway. Deploy backend
services. Set all environment variables. Verify end-to-end on
production URL.

---

## 10. Claude Code Session Rules

**Start of every session:**
Read PRD.md fully. Read PROGRESS.md. Understand exactly what is done
and what comes next before touching any code.

**During the session:**
Work on exactly one step at a time. Complete it fully before moving on.
If something is unclear, state the ambiguity and make a reasonable
decision rather than stopping. Document the decision in PROGRESS.md.

**Token efficiency:**
Do not rewrite files that already work. Do not add comments explaining
what code does — write self-documenting code with clear names. Do not
create placeholder files that will be replaced later — build it right
the first time.

**Testing before moving on:**
After each step, verify the code actually runs. For backend steps,
test with curl or a simple script. For frontend steps, verify in the
browser. Do not mark a step complete if it has not been tested.

**End of every session:**
Update PROGRESS.md. Mark completed items. Set the Next Task field
precisely so the next session starts without confusion.