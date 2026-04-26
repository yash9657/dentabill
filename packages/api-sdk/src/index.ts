/**
 * `@dentabill/api-sdk` — type-safe client for the DentaBill REST API.
 *
 * The wire types in `./types.gen.ts` are *generated* from the OpenAPI
 * document at `../openapi.json` via `pnpm --filter @dentabill/api-sdk
 * gen:types`. The full pipeline is:
 *
 *   1. `pnpm --filter @dentabill/api gen:openapi`
 *      → writes `packages/api-sdk/openapi.json` from Fastify's
 *        `@fastify/swagger` output.
 *   2. `pnpm --filter @dentabill/api-sdk gen:types`
 *      → writes `packages/api-sdk/src/types.gen.ts` via
 *        `openapi-typescript`.
 *
 * Both outputs are committed so reviewers see API-shape changes in the
 * same PR that introduces them. `pnpm gen:sdk` at the repo root chains
 * both steps.
 *
 * Consumers (today: `apps/web`; tomorrow: `apps/call-worker`,
 * `apps/summary-worker`) call `createApiClient({ baseUrl })` to get an
 * `openapi-fetch` instance whose response types are derived from the
 * spec — no hand-maintained DTOs.
 */
import createClient from 'openapi-fetch';

import type { paths } from './types.gen.js';

export type DentaBillApiClient = ReturnType<typeof createClient<paths>>;

export interface CreateApiClientOptions {
  /** Base URL of the API. Browser: NEXT_PUBLIC_API_URL. Server: http://localhost:3001. */
  readonly baseUrl: string;
  /**
   * Optional fetch override — useful in tests or when wiring through
   * Next.js's instrumented `fetch` for tracing.
   */
  readonly fetch?: typeof fetch;
  /**
   * Per-request id propagated from the originating page-load. See
   * `apps/web/src/lib/observability/request-id.ts`. When provided, every
   * SDK call sends `x-request-id: <id>` so client / server logs correlate.
   */
  readonly requestId?: string | null;
  /**
   * Bearer token (Clerk JWT). Wired in P2-T28; leave undefined for
   * unauthenticated endpoints (`/healthz`, `/v1/contact`).
   */
  readonly bearerToken?: string;
}

const REQUEST_ID_HEADER = 'x-request-id';

export function createApiClient(opts: CreateApiClientOptions): DentaBillApiClient {
  const headers: Record<string, string> = {};
  if (opts.requestId) headers[REQUEST_ID_HEADER] = opts.requestId;
  if (opts.bearerToken) headers.authorization = `Bearer ${opts.bearerToken}`;

  const initOpts: Parameters<typeof createClient<paths>>[0] = {
    baseUrl: opts.baseUrl,
    headers,
  };
  if (opts.fetch) initOpts.fetch = opts.fetch;

  return createClient<paths>(initOpts);
}

export type { paths, components, operations } from './types.gen.js';
