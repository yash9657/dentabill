# Engineering Rules

## Language & types
- TypeScript strict everywhere. No `any` — use `unknown` and narrow.
- Explicit return types on every exported function.
- Zod schemas validate every API input before any DB call.

## Multi-tenancy & PHI
- Every query filtered by `organizationId`. Prisma middleware enforces on writes.
- PHI (names, DOB, SSN, full claim text) **never** in logs, errors, traces, or 3rd-party events. Redact in pino config.

## Errors
- Async functions wrapped in try/catch where errors must be handled or transformed.
- API failure shape: `{ error: true, message: string, code: string }`. No stack traces to clients.

## Imports & packages
- Cross-package imports use workspace names (`@dentabill/db`, `@dentabill/types`). No relative `../../` across package boundaries.
- pnpm only. Never npm/yarn. Never global installs.

## Env vars
- Never hardcode secrets. Add every new var to `.env.example` with a one-line comment above it.

## Logging
- pino structured logs in all backend services. Levels: error/warn/info/debug.

## Testing (mandatory per task)
- Unit/integration: **Vitest**. Co-locate as `*.test.ts` next to source.
- E2E / browser: **Playwright** in `apps/web/e2e`.
- A code task is not done until its tests pass locally.
- Coverage target: 80% on packages with business logic (`db`, `queue`, `payer-ivr`, API routes, workers).
- No mocking the database in integration tests for workers — use a local Postgres.

## Git & PRs
- Feature branches: `phase-<n>/<short-slug>` (e.g., `phase-1/monorepo-init`).
- Conventional commits: `feat(scope): …`, `fix(scope): …`, `chore(scope): …`, `docs(scope): …`, `test(scope): …`.
- One task = one PR when reasonable. PR description links the task ID (e.g., `P1-T4`).
- PR target is `main`. Never force-push shared branches.
- Never commit secrets, `.env*` files (except `.env.example`), or generated artifacts.

## Code shape
- Self-documenting names > comments. Comment only non-obvious *why*.
- No placeholder files "to be replaced later" — build it right or don't build it yet.
- Don't add features beyond the task. Don't refactor untouched code.

## Performance & safety
- Index every column used in a `where` filter that runs in user request paths.
- Background jobs idempotent and retry-safe.
- Webhook endpoints verify signatures before any side effect.
