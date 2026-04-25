---
name: security-check
description: HIPAA and OWASP security checklist for DentaBill. Run before any PR merge. No arguments needed.
---

# Security Check

Run `git diff main...HEAD --name-only` to get the list of changed files, then work through each item below for those files.

## PHI & HIPAA

- [ ] No `console.log` / `logger.*` calls containing `patientName`, `ssn`, `dob`, `dateOfBirth`, `memberName`, `subscriberName`, `firstName`, `lastName`, `memberId`
- [ ] No PHI in API error responses returned to unauthenticated or wrong-org callers
- [ ] PHI-containing DB fields only accessible via authenticated, org-scoped queries

## Multi-tenancy

- [ ] Every `prisma.<model>.findMany/findFirst/update/delete` in changed files includes `organizationId`
- [ ] New Prisma models have `organizationId` field

## Input Validation

- [ ] Every Fastify route handler has a Zod schema for body, params, and query
- [ ] No `.passthrough()` on Zod schemas processing external input
- [ ] No raw SQL string interpolation

## Authentication

- [ ] New `/dashboard/*` routes are covered by Clerk middleware
- [ ] New API endpoints require a valid Clerk session token

## Secrets

- [ ] No hardcoded API keys, passwords, or connection strings in any changed file
- [ ] All new credentials are in `.env` (not committed) and documented in `.env.example`

## OWASP Quick Check

- [ ] No `dangerouslySetInnerHTML` with unescaped user content
- [ ] No `eval()` with user-controlled input
- [ ] File uploads (if any) have type + size validation

If any item fails, fix it before creating the PR. For complex findings, invoke the `security-reviewer` agent.
