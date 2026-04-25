# Security policy

DentaBill processes Protected Health Information (PHI) on behalf of dental
billing teams. Security findings are taken seriously.

## Reporting a vulnerability

Email **security@dentabillai.com** (or, until that domain is live, the
maintainer listed in `.github/CODEOWNERS`). Include:

- Clear description of the issue
- Steps to reproduce, with proof of concept where applicable
- Affected components and versions
- Impact assessment (cross-tenant, single-tenant, denial of service, etc.)

**Acknowledgement:** within 3 business days.
**Resolution target:** 30 days from acknowledgement, severity-dependent.

Please do not file public GitHub issues for security findings.

## In scope

- Web app (`apps/web`), API (`apps/api`), workers (`apps/call-worker`, `apps/summary-worker`)
- Authentication / authorization flaws
- Multi-tenancy boundary failures (cross-organization data access)
- PHI leakage via logs, errors, traces, or third-party events
- Webhook signature bypasses
- Injection (SQL, command, prompt)
- Secret exposure in logs, repo, or API responses

## Out of scope

- Reports without a proof of concept
- Volumetric DDoS without a remediation proposal
- Vulnerabilities in third-party services we integrate with — escalate to
  the upstream vendor (Retell, Telnyx, Clerk, Stripe, Resend, Anthropic)
- Findings against unsupported browsers or out-of-date SDKs

## Branch protection — `main`

The following must be enabled in the GitHub UI for `main`:

- [ ] Require a pull request before merging
- [ ] Require status checks to pass: `quality`, `test` (`e2e` once Phase 2 lands)
- [ ] Require branches to be up to date before merging
- [ ] Require linear history (no merge commits)
- [ ] Block force pushes
- [ ] Block deletions
- [ ] Require conversation resolution before merging
- [ ] Restrict who can dismiss pull request reviews

## HIPAA controls implemented

See `docs/SECURITY.md` for the full inventory (created in P1-T12). Phase-1
controls already in place via `.claude/hooks/`:

- `secret-scanner.sh` — blocks hardcoded API keys, private keys, OAuth tokens
- `env-read-blocker.sh` — blocks reading `.env*` files (only `.env.example`)
- `phi-log-detector.sh` — warns on PHI field names inside `console.*` / `logger.*`
- `typecheck.sh` — runs `tsc --noEmit` on every changed package

These are project-level Claude Code hooks, not a substitute for code review.
