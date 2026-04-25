# API Conventions

How the Fastify API speaks. Every route MUST follow these rules — code
review and the `code-reviewer` agent reject violations.

This file describes wire-level contracts. For multi-tenancy and PHI
constraints that apply at the data layer, see `docs/SECURITY.md`. For
TypeScript / lint / commit rules, see `docs/ENGINEERING_RULES.md`.

## HTTP status codes

| Code | When to use                                                     |
| ---- | --------------------------------------------------------------- |
| 200  | Successful GET / PUT / PATCH / DELETE returning a body          |
| 201  | Successful POST that created a resource (return the resource)   |
| 204  | Successful action with no response body                         |
| 400  | Zod validation failure on body / params / query                 |
| 401  | Missing or invalid auth (Clerk JWT, webhook signature)          |
| 403  | Auth ok but caller lacks permission (incl. cross-tenant access) |
| 404  | Resource doesn't exist OR caller's org can't see it             |
| 409  | Conflict — e.g. duplicate claim number for the same org         |
| 422  | _Do not use._ Use 400 for all validation errors.                |
| 429  | Rate limit hit                                                  |
| 500  | Unexpected server error — also page on it                       |

Choose 404 over 403 when the existence of the resource itself is sensitive
across tenants. (Returning 403 leaks "this resource exists, you just
can't see it" — for PHI we never confirm that.)

## Error response shape

Every non-2xx response uses the contract from `@dentabill/types`:

```ts
import { ApiError, ApiErrorSchema } from '@dentabill/types';

// In a Fastify handler
throw new ApiError('VALIDATION_ERROR', 'organizationId is required');

// On the wire
{
  "error": true,
  "message": "organizationId is required",
  "code": "VALIDATION_ERROR"
}
```

- **Never** leak stack traces or internal error messages. The handler
  serializer strips them.
- **Never** include PHI in `message`. Use codes + opaque IDs only.
- **Always** add a new code to `API_ERROR_CODES` in `@dentabill/types`
  before using it. The catalog is the single source of truth.

The HTTP status is derived from the code via `httpStatusForCode()` so that
the wire body and HTTP status never disagree.

## Input validation

Every request body, params, and query MUST be Zod-validated **before any
DB call**. Use `@fastify/type-provider-zod` so the types flow into the
handler:

```ts
import { z } from 'zod';

app.withTypeProvider<ZodTypeProvider>().route({
  method: 'POST',
  url: '/claims',
  schema: {
    body: ClaimCreateSchema,
    response: { 201: ClaimSchema },
  },
  handler: async (req, reply) => {
    // req.body is fully typed
  },
});
```

Validation failures emit `ApiError('VALIDATION_ERROR', ...)` automatically.

## Pagination

Cursor-based, opaque cursor. Use the schema from `@dentabill/types`:

```ts
import { PaginationQuerySchema, paginatedResponseSchema } from '@dentabill/types';

const ClaimListResponseSchema = paginatedResponseSchema(ClaimSchema);

// Query: GET /claims?limit=50&cursor=<opaque>
// Response:
// { items: [...], nextCursor: "abc..." | null, hasMore: true }
```

Defaults: `limit=50`, max `200`. Never expose offset-based pagination —
performance and cross-tenant correctness both suffer.

## Idempotency

For state-mutating endpoints that may retry (POST, PATCH, DELETE), accept
a client-supplied idempotency key:

```
POST /claims/:id/queue
Idempotency-Key: <uuid v4>
```

Implementation when API lands in Phase 2:

- Persist `(orgId, idempotencyKey, requestHash, response)` in a table
  with a 24-hour TTL.
- On replay with same key + same hash → return the cached response.
- Same key + different hash → 409 with code `IDEMPOTENCY_KEY_REUSE`.

## Webhook handling

Inbound webhooks (Retell, Stripe) MUST verify signatures **before any
side effect**:

1. Read the raw request body (not the parsed JSON — Fastify's `rawBody`
   plugin or middleware).
2. Compute HMAC-SHA256(rawBody, webhookSecret).
3. Compare against the provider's signature header in constant time.
4. On mismatch → `ApiError('WEBHOOK_SIGNATURE_INVALID', ...)` with 401.

Provider headers:

- Retell: `Retell-Signature`, secret in `RETELL_WEBHOOK_SECRET`.
- Stripe: `Stripe-Signature`, secret in `STRIPE_WEBHOOK_SECRET`.

Always log the verification outcome (success/failure) — that is _not_ PHI.
Never log the raw body or signature value.

## Org scoping (the rule that beats them all)

Every read against a multi-tenant model goes through
`getOrgScopedDb(orgId)` from `@dentabill/db`. Every write requires
`organizationId` in the data (Prisma middleware enforces). A handler that
fetches data for the wrong org should fail loudly with
`ApiError('ORG_SCOPE_VIOLATION', ...)`.

The `orgId` for the request comes from the verified Clerk JWT (`req.auth.orgId`),
**never** from a request body. Trusting body-supplied org IDs is a
cross-tenant data leak by design.

## Rate limiting

Defaults (Phase 2 implementation):

- Unauthenticated: 100 req/min per IP.
- Authenticated: 1000 req/min per org.
- Webhook endpoints: 10000 req/min (verified by signature, not vulnerable).

Exceeding emits `ApiError('RATE_LIMITED', ...)` with `Retry-After` header.

## Logging

Use `@dentabill/logger`'s `createLogger`. Every request gets a logger child
with `{ requestId, orgId, userId }` bound. The PHI redact list catches
common patient identifiers, but **never** intentionally log:

- Request bodies for routes that accept claim data
- Response bodies that contain PHI
- Patient-identifying fields by any name

Log structured events (`logger.info({ event: 'claim.queued', claimId })`),
never sentence-style strings with interpolated values.

## Response envelope

Successful list responses:

```json
{ "items": [...], "nextCursor": "...", "hasMore": true }
```

Successful single-resource responses: the resource directly (no envelope).

```json
{ "id": "clm_123", "claimNumber": "CL-2026-0042", ... }
```

Avoid double-wrapping (`{"data": {...}}`) — it adds no information and
clients have to unwrap every response.
