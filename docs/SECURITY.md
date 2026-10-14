# Security & HIPAA Inventory

Operational security guide for DentaBill. This is the engineering view —
for vulnerability disclosure, see the top-level `SECURITY.md`. For wire-level
API contracts, see `docs/API_CONVENTIONS.md`.

## HIPAA technical safeguards

DentaBill processes Protected Health Information (PHI) on behalf of dental
practices. We do not have formal HIPAA certification yet, and that's fine
for Phase 1. What is _not_ fine is building the system in a way that makes
later certification expensive. The table below tracks each technical
safeguard's status.

| Safeguard                     | Implementation                                                                                        | Status                                  |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Access control                | Clerk auth + RBAC (Owner, Admin, Billing Staff)                                                       | Phase 1 (RBAC enforcement Phase 2)      |
| Audit controls                | `AuditLog` row on every PHI access via `audit()` helper                                               | Phase 1 (P1-T4A)                        |
| Data integrity                | Prisma strict types + Zod input validation; no raw SQL                                                | Ongoing                                 |
| Transmission security         | TLS 1.3, HSTS — enforced by deploy platform                                                           | Phase 5 (cloud target — ADR-004)        |
| Encryption at rest            | Postgres + Redis encrypted volumes via deploy platform                                                | Phase 5                                 |
| PHI minimization              | DOB hashed (SHA-256), member IDs not logged, redaction list                                           | Phase 1 (logger) + Phase 2 (DOB hash)   |
| Business associate agreements | BAAs with all PHI-bearing vendors (Retell, Telnyx, Clerk, Anthropic, Resend, Stripe + cloud provider) | Day-1 task before first paying customer |
| Breach notification           | Sentry + on-call rotation                                                                             | Phase 5 (alongside cloud target)        |
| Workforce controls            | GitHub branch protection, MFA required, no shared creds                                               | Repo settings — see `SECURITY.md`       |
| Contingency plan              | Postgres automated backups, restore procedure documented                                              | Phase 5                                 |

## PHI handling rules

PHI in DentaBill = patient names, DOBs, SSNs, member/subscriber IDs, full
claim narrative, contact info (email, phone, address), call transcripts.

### Logging — non-negotiable

- Use `@dentabill/logger` `createLogger`. Never `console.*`. Never raw `pino`.
- The redact list in `packages/logger/src/index.ts` covers the standard
  PHI field names. **Add a path immediately when you introduce a new
  shape that could contain PHI** — false positives (over-redacting a
  non-PHI field with the same name) are acceptable.
- The `phi-log-detector.sh` Claude Code hook warns when PHI field names
  appear in `console.*` / `logger.*` calls. It is best-effort, not
  authoritative — do the redaction yourself.

### Database

- Every PHI-bearing column lives on a multi-tenant model with `organizationId`.
- Every read against a multi-tenant model goes through
  `getOrgScopedDb(orgId)` so the org filter cannot be forgotten.
- Every write is gated by the `org-scope` Prisma middleware (P1-T5).
- DOB is stored as `patientDOBHash` (SHA-256) plus `patientDOBLast4` for
  rep verification — never the raw value.

### Audit log

Every PHI read SHOULD call `audit({ action: 'claim.read', resourceType,
resourceId, organizationId, userId })` so we can replay who saw what when.
The helper rejects calls without `organizationId` — see `packages/db/src/lib/audit.ts`
(P1-T4A).

### API surface

- 404 over 403 when the existence of the resource is sensitive across
  tenants — see `docs/API_CONVENTIONS.md`.
- Never echo a raw `Error.message` to the client.
- Never include PHI in error `message` strings — only codes + opaque IDs.

## Secret management

| Secret class                                                | Where it lives in dev    | Where it lives in prod                                         |
| ----------------------------------------------------------- | ------------------------ | -------------------------------------------------------------- |
| API keys (Retell, Telnyx, Anthropic, Stripe, Resend, Clerk) | `.env` (gitignored)      | Deploy platform secret store (decision in Phase 5 per ADR-004) |
| Webhook signing secrets                                     | `.env`                   | Same                                                           |
| Database / Redis URLs                                       | `.env` (compose locally) | Vendor-managed Postgres + Redis URLs                           |
| Application-level encryption keys (Phase 4+)                | Not used yet             | Cloud KMS (Phase 5)                                            |

Hard rules:

- **Never commit `.env*` files.** Only `.env.example`. The `env-read-blocker.sh`
  Claude Code hook prevents accidental reads of `.env*` (other than
  `.env.example`).
- **Never hardcode secrets in source.** The `secret-scanner.sh` hook blocks
  writes containing common secret patterns (sk-…, ghp\_…, AKIA…, BEGIN
  PRIVATE KEY).
- New env vars MUST be added to `.env.example` with a one-line comment
  describing purpose. Codify the requirement in PR review (template
  checklist).

## Branch protection — `main`

Enable in GitHub UI (cannot be configured via committed file):

- [ ] Require a pull request before merging
- [ ] Require status checks to pass: `Quality (typecheck + lint + build)`, `Test (vitest + real Postgres)`, `Analyze (javascript-typescript)` (`e2e` added once Phase 2 lands)
- [ ] Require branches to be up to date before merging
- [ ] Require linear history (no merge commits)
- [ ] Block force pushes
- [ ] Block deletions
- [ ] Require conversation resolution before merging
- [ ] Restrict who can dismiss pull request reviews

When the team grows beyond solo maintenance, also enable "require approval
of most recent reviewable push" and "require review from CODEOWNERS".

## Repository security settings (GitHub UI)

These are repo-level toggles that cannot be set via a committed file:

- [ ] **Code scanning** — Settings → Code security → Code scanning → "Set up"
      → Default. Required for the CodeQL workflow's SARIF upload to land in
      the Security tab. Until enabled, the CodeQL workflow runs but the
      upload step is `continue-on-error` (see `.github/workflows/codeql.yml`).
      Once enabled, remove that flag so high-severity findings block merges.
- [ ] **Secret scanning + push protection** — Settings → Code security →
      Secret scanning. Augments GitGuardian (already passing).
- [ ] **Dependency review** — Settings → Code security → Dependency review.
      Surfaces vulnerable dependencies on every PR.
- [ ] **Private vulnerability reporting** — Settings → Code security →
      Private vulnerability reporting. Wires the disclosure address from
      `SECURITY.md` (root) to a GitHub-managed reporting channel.

## Threat model — top 5

Listed in declining order of likelihood × impact. Mitigations are tracked
in code, not just on paper.

### 1. Cross-tenant data leak

**Threat.** A handler forgets to scope a Prisma query by `organizationId`,
leaking another practice's claims into the response.

**Mitigation.**

- `getOrgScopedDb(orgId)` is the only sanctioned read API for multi-tenant
  models (P1-T4A).
- Prisma middleware (`org-scope`, P1-T5) blocks writes missing
  `organizationId`.
- `code-reviewer` and `security-reviewer` agents check this on every PR.
- Integration tests (P1-T4A onward) include a "two orgs, no leak" case.

### 2. PHI in logs

**Threat.** A developer logs an error object that contains a request body
with patient data; the log lands in CloudWatch / Sentry / a dump file.

**Mitigation.**

- `@dentabill/logger` ships with PHI redaction; using `console.*` is an
  ESLint error.
- `phi-log-detector.sh` hook warns at write time.
- Logger unit tests assert redaction (P1-T3A).

### 3. Webhook spoofing

**Threat.** An attacker calls our Retell or Stripe webhook URL directly
with a forged payload, triggering a phantom call summary or a free
upgrade.

**Mitigation.**

- All webhooks verify HMAC-SHA256 signature against
  `RETELL_WEBHOOK_SECRET` / `STRIPE_WEBHOOK_SECRET` BEFORE any side effect.
- Pattern documented in `docs/API_CONVENTIONS.md`; helper lands in Phase 2.

### 4. Claim CSV injection

**Threat.** A malicious CSV upload contains formula content (=cmd|...) or
malformed Unicode that, when re-exported, executes in Excel or breaks
downstream parsers.

**Mitigation.**

- CSV ingestion (Phase 2) Zod-validates every cell.
- Cells beginning with `=`, `+`, `-`, `@` are prefixed with `'` on
  re-export.
- Files larger than 5 MB or with more than 50,000 rows are rejected.

### 5. BullMQ job poisoning

**Threat.** A poison-pill job in Redis crashes the call-worker repeatedly,
causing the queue to back up and (worst case) leaking Retell credentials
in retry logs.

**Mitigation.**

- Workers wrap job handlers in try/catch and emit a typed failure event
  via `@dentabill/queue` (Phase 3).
- Max retry count + exponential backoff per job; failures past the limit
  go to a dead-letter queue and a `MANUAL_REVIEW` claim status.
- Worker logs use `@dentabill/logger` with PHI redaction.

## Incident response

For a confirmed PHI exposure:

1. Identify the scope: how many records, which orgs, which fields.
2. Halt the leaking pipeline (disable the offending route via env flag
   or roll back the deploy).
3. Email all affected orgs within 24 hours; full HIPAA notification within
   60 days (HIPAA Breach Notification Rule).
4. File a post-mortem in `docs/INCIDENTS/<date>-<slug>.md` (created on
   first incident).
5. Add a regression test that would have caught the issue.

The incident-response template lands when (if) we have a first incident,
not preemptively.

### Imported procedure and coverage facts (ADR-072; local implementation)

`ClaimSourceLine` and `ClaimSourceCoverage` contain potentially identifying procedure dates,
treatment locations, payer/plan/member/subscriber IDs and source references. They use composite
tenant/claim foreign keys and tenant-filtered GET detail projections; no new public download,
third-party transmission or verified-eligibility assertion is added. Parser errors are closed
messages and import audit retains only aggregate counts. Imported snapshots reject update,
append or individual deletion while the parent claim exists; authorized parent deletion follows
the existing cascade. This does not establish a legal retention schedule or production PHI
approval. Payment-ledger work must define retention/reversal semantics before introducing
financial references to source lines. Practice-scoped browser query keys isolate source detail
caches, including status-update refetch behavior. Local tests do not establish deployed controls.

### Remittance evidence and review (ADR-073; local implementation)

Custom remittance JSON can contain payer claim-control, payment trace, coverage and source
references. Four immutable tables use tenant/claim composite FKs and restrictive evidence,
source and actor retention. Scoped stored-role checks restrict access to owner/admin/billing
staff. Review tokens bind claim/evidence/ledger versions; idempotent request hashes also bind
actor and decision. Pending/rejected records remain evidence and still prevent claim deletion.
This safeguard is not a legal retention schedule, PHI authorization or implemented erasure policy.

All successful reads, including exact import/review replays, require aggregate/opaque-ID access
audit entries. New evidence/review/children and mutation audit commit together. Validation,
malformed JSON and unexpected database failures have closed messages; no input issue values,
payloads or raw errors reach route logs. Raw/canonical input and list-response bounds protect
local processing and AWS payload size. Browser forms and caches bind claim, user and optional
practice; late auth changes cannot transmit under a new scope. No inference, third-party
submission, verified cash receipt, posting or settlement is implied by acceptance.

### Manual cash source evidence (ADR-074; local only)

Cash observations may contain account identifiers, traces, counterparty/source descriptions and
financial data. Treat them as sensitive; the custom manual contract does not certify provider
identity or establish an external PHI agreement. All five routes require authenticated practice
scope and stored OWNER/ADMIN/BILLING_STAFF roles. Reads, previews, exact replays and mutations
require PHI-safe audit; raw validation/Prisma errors are closed before global logging. No raw
payload or source ID is placed in audit metadata. Raw/canonical import64KiB, page2MiB and bounded
replacement traversal reduce unbounded resource exposure. Account summaries never combine
accounts/connectors. Source/review rows and actor references are immutable/restrictive; approved
retention, legal hold, erasure and backups still require a production policy. Acceptance confirms
review of manual evidence only: bank verification and settlement stay UNVERIFIED. No real banking
connector, money movement, claim allocation, payment posting or revenue assertion is enabled.

### Manual remittance batches (ADR-075; local only)

Batch records can contain payer/payee identifiers, traces and provider adjustment references.
Treat all source fields as sensitive. All four routes require scoped stored OWNER/ADMIN/BILLING_STAFF
roles; read/replay audits are mandatory and mutation audits commit atomically. Strict bounded
schemas, closed error messages and opaque audit metadata keep source values out of logs.
Raw/canonical/JSONB256KiB,100 members/adjustments and page2MiB bounds limit processing/response size.
Organization admission locks, immutable exact member/review bindings and restrictive actor/source
FKs prevent tenant crossing and repeated accepted claim events. Manual acceptance establishes
neither source authenticity nor bank receipt, posting or settlement. Production retention,
erasure, PHI agreements, batch corrections and authenticated connectors remain separate gates.

### Manual cash reconciliation (ADR-076; local only)

Five scoped handlers require stored OWNER/ADMIN/BILLING_STAFF roles and mandatory audited reads,
replays and atomic mutations. Source/payment identities remain sensitive; fixed errors and opaque
audit metadata avoid payload logging. Signed capacities, exact accepted-review references and
organization serialization prevent duplicate reservations, including direct SQL and concurrent
reviews. Historical replacement components retain reservations after source changes; traversal
over100 IDs blocks matching. Full release is available independently of stale/overflowed source
state. Mutation receipts never change on retry.4KiB bodies and20-record/2MiB pages bound requests.
Manual review establishes no source authenticity, bank verification, claim allocation, external
posting or settlement. Cross-connector account identity, production retention/erasure, PHI
agreements and authorized bank/PMS integration evidence remain unresolved deployment gates.

### Authenticated tenant rate-limit ordering (ADR-077; local only)

Call enqueue and practice-settings writes now apply their10/minute practice limiter after
`requireAuth`. Four regressions reproduce the earlier shared pre-auth `anon` bucket and verify
that anonymous requests cannot drain authenticated quota, users/IPs share their practice limit
and other practices remain isolated. These are process-local plugin limits; no distributed
quota or production WAF/load evidence is claimed. Production configuration is unchanged.
