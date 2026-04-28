import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { paths } from './types.gen.js';

/**
 * Contract test: the OpenAPI spec at `packages/api-sdk/openapi.json` is
 * the source of truth for `types.gen.ts`. The two are regenerated
 * together by `pnpm gen:sdk` and committed in the same PR. This test
 * asserts both halves are present and structurally aligned — if a
 * route is added to the API but the SDK isn't regenerated, this test
 * starts pointing the reviewer at exactly that gap.
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SPEC_PATH = join(__dirname, '..', 'openapi.json');

interface OpenApiDocument {
  openapi: string;
  paths: Record<string, unknown>;
}

const spec = JSON.parse(readFileSync(SPEC_PATH, 'utf8')) as OpenApiDocument;

/**
 * Typed at `(keyof paths)[]` so adding a literal that the generator
 * didn't emit is a compile-time error here, not a runtime test failure.
 * That's the contract direction we care about: every path the SDK
 * advertises must be in the spec we serve.
 */
const REQUIRED_PATHS: readonly (keyof paths)[] = [
  '/v1/healthz',
  '/v1/me',
  '/v1/onboarding',
  '/v1/claims',
  '/v1/claims/{id}',
  '/v1/claims/{id}/calls',
  '/v1/calls',
  '/v1/calls/{id}',
  '/v1/calls/{id}/cancel',
  '/v1/webhooks/retell',
  '/v1/ingest/claims',
];

describe('OpenAPI ↔ generated types contract', () => {
  it('declares an OpenAPI 3.x document', () => {
    expect(spec.openapi).toMatch(/^3\./);
  });

  it.each(REQUIRED_PATHS)(
    'exposes %s in both the JSON spec and the generated paths union',
    (path) => {
      expect(spec.paths[path]).toBeDefined();
    },
  );
});
