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
  '/v1/claims/{id}/observations',
  '/v1/claims/{id}/remittances',
  '/v1/claims/{claimId}/remittances/{id}/preview',
  '/v1/claims/{claimId}/remittances/{id}/review',
  '/v1/observations/{id}/review',
  '/v1/observations/{id}/regeneration-preview',
  '/v1/observations/{id}/regenerate',
  '/v1/observation-regenerations/{id}/resume',
  '/v1/calls/{id}/observations/publish',
  '/v1/calls',
  '/v1/calls/stats',
  '/v1/reports/summary',
  '/v1/calls/{id}',
  '/v1/calls/{id}/cancel',
  '/v1/calls/{id}/summary/status',
  '/v1/calls/{id}/summary/retry',
  '/v1/webhooks/retell',
  '/v1/ingest/claims',
  '/v1/cash-evidence',
  '/v1/cash-evidence/transactions/{id}',
  '/v1/cash-evidence/{id}/preview',
  '/v1/cash-evidence/{id}/review',
];

describe('OpenAPI ↔ generated types contract', () => {
  it('declares an OpenAPI 3.x document', () => {
    expect(spec.openapi).toMatch(/^3\./);
  });

  it('preserves cash source revisions, nullable amounts and manual unverified provenance', () => {
    const properties = [
      'get',
      'responses',
      '200',
      'content',
      'application/json',
      'schema',
      'properties',
    ];
    const preview = spec.paths['/v1/cash-evidence/{id}/preview'];
    const evidence = [...properties, 'evidence', 'properties'];
    const payload = [...evidence, 'payload', 'properties'];
    for (const field of ['amount', 'sourceAmount', 'sourceVersion', 'pendingSourceTransactionId']) {
      expect(preview).toHaveProperty([...payload, field, 'type'], 'string');
      expect(preview).toHaveProperty([...payload, field, 'nullable'], true);
    }
    expect(preview).toHaveProperty([...payload, 'sourceSequence', 'type'], 'integer');
    expect(preview).toHaveProperty(
      [...payload, 'sourceSignConvention', 'enum'],
      ['CREDIT_POSITIVE', 'DEBIT_POSITIVE'],
    );
    expect(preview).toHaveProperty([...evidence, 'provenance', 'enum'], ['MANUAL_UPLOAD']);
    for (const field of ['bankVerification', 'settlement'])
      expect(preview).toHaveProperty([...properties, field, 'enum'], ['UNVERIFIED']);
    expect(spec.paths['/v1/cash-evidence/{id}/review']).toHaveProperty(
      ['post', 'requestBody', 'content', 'application/json', 'schema', 'required'],
      ['decision', 'reviewToken', 'idempotencyKey'],
    );
  });

  it('preserves typed nullable remittance identities and unverified financial states', () => {
    const properties = [
      'get',
      'responses',
      '200',
      'content',
      'application/json',
      'schema',
      'properties',
    ];
    const list = spec.paths['/v1/claims/{id}/remittances'];
    const payload = [...properties, 'items', 'items', 'properties', 'payload', 'properties'];
    for (const field of [
      'sourceVersion',
      'payerIdentifier',
      'sourceCoverageId',
      'reportedDate',
      'paymentTrace',
    ]) {
      expect(list).toHaveProperty([...payload, field, 'type'], 'string');
      expect(list).toHaveProperty([...payload, field, 'nullable'], true);
    }
    for (const field of ['cashReceipt', 'posting', 'settlement'])
      expect(list).toHaveProperty(
        [...properties, 'summary', 'properties', field, 'enum'],
        ['UNVERIFIED'],
      );
    expect(spec.paths['/v1/claims/{claimId}/remittances/{id}/review']).toHaveProperty(
      ['post', 'requestBody', 'content', 'application/json', 'schema', 'required'],
      ['decision', 'reviewToken', 'idempotencyKey'],
    );
  });

  it('describes unavailable verified payments without legacy recovered money fields', () => {
    const responseProperties = [
      'get',
      'responses',
      '200',
      'content',
      'application/json',
      'schema',
      'properties',
    ];
    for (const path of ['/v1/calls/stats', '/v1/reports/summary']) {
      expect(spec.paths[path]).toHaveProperty(
        [...responseProperties, 'verifiedPayments', 'properties', 'amountCents', 'enum'],
        [null],
      );
      expect(spec.paths[path]).toHaveProperty(
        [...responseProperties, 'verifiedPayments', 'properties', 'status', 'enum'],
        ['unavailable'],
      );
    }
    expect(spec.paths['/v1/calls/stats']).not.toHaveProperty([
      ...responseProperties,
      'recoveredThisWeekCents',
    ]);
    expect(spec.paths['/v1/reports/summary']).not.toHaveProperty([
      ...responseProperties,
      'recoveredByWeek',
    ]);
    const payerProperties = [...responseProperties, 'payerOutcomes', 'items', 'properties'];
    for (const field of [
      'callCount',
      'completedCallCount',
      'uniqueClaimCount',
      'claimsMarkedResolvedCount',
    ]) {
      expect(spec.paths['/v1/reports/summary']).toHaveProperty([...payerProperties, field]);
    }
    expect(spec.paths['/v1/reports/summary']).not.toHaveProperty([
      ...payerProperties,
      'recoveredCents',
    ]);
    expect(spec.paths['/v1/reports/summary']).not.toHaveProperty([
      ...payerProperties,
      'resolvedCount',
    ]);
  });

  it('requires the reviewed snapshot and exposes evidence without accepting provider output', () => {
    const body = ['post', 'requestBody', 'content', 'application/json', 'schema'];
    expect(spec.paths['/v1/observations/{id}/review']).toHaveProperty(
      [...body, 'required'],
      ['expectedDigest', 'expectedClaimVersion', 'decision'],
    );
    expect(spec.paths['/v1/observations/{id}/review']).toHaveProperty(
      [...body, 'properties', 'note', 'maxLength'],
      1000,
    );
    for (const path of ['/v1/observations/{id}/review', '/v1/calls/{id}/observations/publish'])
      expect(spec.paths[path]).toHaveProperty([...body, 'additionalProperties'], false);
    expect(spec.paths['/v1/calls/{id}/observations/publish']).toHaveProperty(
      [...body, 'properties'],
      {},
    );
    const observation = [
      'get',
      'responses',
      '200',
      'content',
      'application/json',
      'schema',
      'properties',
      'items',
      'items',
      'properties',
    ];
    expect(spec.paths['/v1/claims/{id}/observations']).toHaveProperty(
      [...observation, 'dataClass', 'enum'],
      ['SYNTHETIC', 'PROTECTED'],
    );
    for (const field of [
      'digest',
      'claimVersion',
      'sources',
      'provenance',
      'canReview',
      'staleReason',
    ])
      expect(spec.paths['/v1/claims/{id}/observations']).toHaveProperty([...observation, field]);
  });

  it('requires an exact reviewed preview for regeneration and exposes only same-authorization resume', () => {
    const body = ['post', 'requestBody', 'content', 'application/json', 'schema'];
    expect(spec.paths['/v1/observations/{id}/regenerate']).toHaveProperty(
      [...body, 'required'],
      ['expectedPreviewDigest', 'idempotencyKey', 'reason'],
    );
    for (const path of [
      '/v1/observations/{id}/regenerate',
      '/v1/observation-regenerations/{id}/resume',
    ])
      expect(spec.paths[path]).toHaveProperty([...body, 'additionalProperties'], false);
    expect(spec.paths['/v1/observation-regenerations/{id}/resume']).toHaveProperty(
      [...body, 'properties'],
      {},
    );
    expect(spec.paths['/v1/observations/{id}/regenerate']).toHaveProperty(
      [...body, 'properties', 'reason', 'maxLength'],
      1000,
    );
    const preview = [
      'get',
      'responses',
      '200',
      'content',
      'application/json',
      'schema',
      'properties',
    ];
    for (const field of [
      'canRegenerate',
      'blockedReason',
      'previewDigest',
      'source',
      'release',
      'activeAuthorization',
    ])
      expect(spec.paths['/v1/observations/{id}/regeneration-preview']).toHaveProperty([
        ...preview,
        field,
      ]);
  });

  it('exposes native processing provenance and role-aware retry status without inference payloads', () => {
    const properties = [
      'get',
      'responses',
      '200',
      'content',
      'application/json',
      'schema',
      'properties',
    ];
    for (const field of ['provider', 'observationId', 'reviewRequired', 'canRetry', 'summaryId'])
      expect(spec.paths['/v1/calls/{id}/summary/status']).toHaveProperty([...properties, field]);
    for (const field of ['requestPayload', 'resultPayload', 'responsePayload', 'releaseSnapshot'])
      expect(spec.paths['/v1/calls/{id}/summary/status']).not.toHaveProperty([
        ...properties,
        field,
      ]);
  });

  it.each(REQUIRED_PATHS)(
    'exposes %s in both the JSON spec and the generated paths union',
    (path) => {
      expect(spec.paths[path]).toBeDefined();
    },
  );
});
