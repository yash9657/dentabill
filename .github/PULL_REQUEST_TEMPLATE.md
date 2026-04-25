<!--
PR title MUST follow Conventional Commits, e.g. `feat(api): add claims router`.
Linked task ID belongs in the Summary (e.g. P1-T4).
-->

## Summary

<!-- 1–2 sentences describing what this PR does and which task it closes. -->

## Changes

<!-- Bullet list of the concrete changes — no narrative. -->

-

## Testing

<!-- How was this verified? Reference the exact commands. -->

- [ ] `pnpm turbo run typecheck lint test build` green locally
- [ ] New tests added/updated for changed behavior

## Security / HIPAA impact

<!-- Mark any that apply and explain. Default-deny: if you're unsure, the answer is yes. -->

- [ ] This PR introduces or changes logging
- [ ] This PR touches PHI fields (patient names, DOB, SSN, member IDs, claim text)
- [ ] This PR adds or changes a database schema/migration
- [ ] This PR adds or changes auth or org-scoping logic
- [ ] This PR adds or changes webhook handling
- [ ] None of the above

## Checklist

- [ ] No PHI in any `console.*` or `logger.*` call
- [ ] New env vars added to `.env.example` with a one-line comment
- [ ] Migrations are backward-compatible (or have a documented multi-step plan)
- [ ] Cross-package imports use workspace names (`@dentabill/...`), not relative paths
- [ ] Every Prisma query against multi-tenant models is `organizationId`-scoped
- [ ] Every API input is Zod-validated before any DB call
- [ ] Conventional Commits format followed
