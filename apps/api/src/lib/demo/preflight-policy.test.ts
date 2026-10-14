import { describe, expect, it } from 'vitest';

import {
  assessDemoDatabase,
  DemoPreflightError,
  DemoPreflightReportSchema,
  isolatedDemoEnvironment,
  validateDemoConfiguration,
  type DemoDatabaseSnapshot,
} from './preflight-policy.js';

const actor = {
  organizationId: 'demo-organization',
  userId: 'demo-user',
  clerkOrganizationId: 'org_syntheticPreflight',
  clerkUserId: 'user_syntheticPreflight',
};
const environment = {
  DATABASE_URL:
    'postgresql://demo:synthetic-password@localhost:5432/dentabill_demo_policy?schema=public',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  NEXT_PUBLIC_API_URL: 'http://localhost:3001',
  INTERNAL_API_BASE_URL: 'http://localhost:3001',
  NODE_ENV: 'development',
  JOB_DISPATCH_MODE: 'inline',
  INTERNAL_JOB_SECRET: 'synthetic-preflight-internal-secret-only',
  DOB_HASH_SECRET: 'synthetic-preflight-dob-secret-only',
  SUMMARY_ANALYSIS_PROVIDER: 'SYNTHETIC',
  SUMMARIZER_AUTO_TRANSITION_ENABLED: 'false',
  DEMO_AUTOPILOT: 'true',
  DEMO_IGNORE_PAYER_HOURS: 'true',
  DEMO_SUMMARIZER_FALLBACK: 'true',
  CLERK_SECRET_KEY: 'sk_test_synthetic_preflight_not_a_credential',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_synthetic_preflight_not_a_credential',
};
const migrations = [
  { name: '20261014210000_posting_claim_relationships', checksum: 'a'.repeat(64) },
];
const snapshot: DemoDatabaseSnapshot = {
  databaseName: 'dentabill_demo_policy',
  readOnly: true,
  migrations: migrations.map((item) => ({ ...item, finished: true, rolledBack: false })),
  organization: { clerkOrgId: actor.clerkOrganizationId },
  actor: { clerkUserId: actor.clerkUserId, role: 'OWNER' },
  otherOrganizations: 0,
  otherActors: 0,
};

describe('synthetic demo preflight policy', () => {
  it('passes only explicit approved values into the private child environment', () => {
    const input = Object.freeze({
      ...environment,
      PATH: '/usr/bin:/bin',
      HTTPS_PROXY: 'https://private-canary.invalid',
      CLERK_API_URL: 'https://private-canary.invalid',
      NEXT_PRIVATE_DEV_DIR: '/private-canary',
      __NEXT_PRIVATE_STANDALONE_CONFIG: 'private-canary',
      HOME: '/private-canary',
    });
    const isolated = isolatedDemoEnvironment(input, actor);
    expect(isolated).toEqual({ ...environment, PATH: '/usr/bin:/bin' });
    expect(JSON.stringify(isolated)).not.toContain('private-canary');
    expect(input.HOME).toBe('/private-canary');
    expect(() =>
      isolatedDemoEnvironment({ ...input, RETELL_API_KEY: 'private-canary' }, actor),
    ).toThrowError('DEMO_EXTERNAL_CONFIGURATION');
  });

  it('accepts only bounded metadata reports and fixed failure diagnostics', () => {
    expect(
      DemoPreflightReportSchema.parse({
        status: 'PREFLIGHT_FAILED',
        code: 'DEMO_DATABASE_UNAVAILABLE',
      }),
    ).toEqual({ status: 'PREFLIGHT_FAILED', code: 'DEMO_DATABASE_UNAVAILABLE' });
    for (const report of [
      { status: 'PREFLIGHT_FAILED', code: 'private-canary' },
      { status: 'PREFLIGHT_FAILED', code: 'DEMO_DATABASE_UNAVAILABLE', secret: 'private-canary' },
      { status: 'PREFLIGHT_PASSED', secret: 'private-canary' },
    ]) {
      expect(DemoPreflightReportSchema.safeParse(report).success).toBe(false);
    }
  });

  it('admits only explicitly configured local synthetic mode without mutating environment', () => {
    const raw = Object.freeze({ ...environment, API_CORS_ORIGINS: '' });
    const configuration = validateDemoConfiguration(raw, actor);
    expect(configuration.databaseName).toBe('dentabill_demo_policy');
    expect(configuration.appOrigin).toBe('http://localhost:3000');
    expect(raw).toEqual({ ...environment, API_CORS_ORIGINS: '' });
    expect(assessDemoDatabase(configuration, migrations, snapshot)).toEqual({
      migrationCount: 1,
      actorRole: 'OWNER',
    });
  });

  it.each([
    'RETELL_API_KEY',
    'RETELL_WEBHOOK_SECRET',
    'FIREWORKS_API_KEY',
    'ANTHROPIC_API_KEY',
    'STRIPE_SECRET_KEY',
    'RESEND_API_KEY',
    'SMTP_PASSWORD',
    'AWS_PROFILE',
    'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
    'VERCEL_URL',
    'RAILWAY_ENVIRONMENT',
    'TWILIO_ACCOUNT_SID',
    'TELNYX_API_KEY',
    'JOBS_QUEUE_URL',
    'REDIS_URL',
    'OBSERVATION_RELEASE_ID',
    'CLERK_WEBHOOK_SECRET',
    'NODE_OPTIONS',
    'NODE_PATH',
    'ESBUILD_BINARY_PATH',
    'DOTENV_CONFIG_PATH',
    'DEBUG',
    'ELEVENLABS_API_KEY',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY',
    'SENTRY_DSN',
    'NEXT_PUBLIC_SENTRY_DSN',
  ])('rejects inherited external configuration %s with a closed error', (key) => {
    expect(() =>
      validateDemoConfiguration({ ...environment, [key]: 'private-canary' }, actor),
    ).toThrowError(new DemoPreflightError('DEMO_EXTERNAL_CONFIGURATION'));
  });

  it('permits empty unused provider keys but never whitespace-only credentials', () => {
    expect(() =>
      validateDemoConfiguration({ ...environment, RETELL_API_KEY: '' }, actor),
    ).not.toThrow();
    expect(() =>
      validateDemoConfiguration({ ...environment, RETELL_API_KEY: ' ' }, actor),
    ).toThrowError('DEMO_EXTERNAL_CONFIGURATION');
  });

  it.each([
    'postgresql://user:password@db.example/dentabill_demo_policy',
    'postgresql://user:password@localhost/dentabill_test',
    'postgresql://user:password@localhost/dentabill',
    'postgresql://user:password@localhost/dentabill_demo_',
    'postgresql://user:password@localhost/dentabill_demo_policy?host=db.example',
    'postgresql://user:password@localhost/dentabill_demo_policy?schema=private',
    'postgresql://user:password@localhost/dentabill_demo_policy?schema=public&schema=public',
    'postgresql://user:password@localhost/dentabill_demo_policy#fragment',
    'https://localhost/dentabill_demo_policy',
    'not-a-database-private-canary',
  ])('rejects nonexclusive or redirected database target %s', (DATABASE_URL) => {
    expect(() => validateDemoConfiguration({ ...environment, DATABASE_URL }, actor)).toThrowError(
      new DemoPreflightError('DEMO_DATABASE_NOT_ISOLATED'),
    );
  });

  it.each(['127.0.0.1', '[::1]'])('allows explicit loopback host %s', (host) => {
    expect(
      validateDemoConfiguration(
        {
          ...environment,
          DATABASE_URL: `postgresql://demo:synthetic@${host}:5432/dentabill_demo_policy`,
        },
        actor,
      ).databaseName,
    ).toBe('dentabill_demo_policy');
  });

  it.each([
    { NEXT_PUBLIC_APP_URL: 'https://dentabill.example' },
    { NEXT_PUBLIC_APP_URL: 'http://localhost:3000/dashboard' },
    { NEXT_PUBLIC_API_URL: 'http://localhost:3000' },
    { NEXT_PUBLIC_API_URL: 'http://credentials:private-canary@localhost:3001' },
    { INTERNAL_API_BASE_URL: 'http://localhost:3002' },
    { API_CORS_ORIGINS: 'http://localhost:3000,https://other.example' },
    { NEXT_PUBLIC_API_URL: 'http://localhost:3001?redirect=private-canary' },
  ])('rejects remote, ambiguous or inconsistent origins %#', (override) => {
    expect(() => validateDemoConfiguration({ ...environment, ...override }, actor)).toThrowError(
      'DEMO_LOCAL_ORIGINS_REQUIRED',
    );
  });

  it.each([
    { NODE_ENV: 'production' },
    { NODE_ENV: 'test' },
    { JOB_DISPATCH_MODE: 'bullmq' },
    { SUMMARY_ANALYSIS_PROVIDER: 'FIREWORKS' },
    { SUMMARIZER_AUTO_TRANSITION_ENABLED: 'true' },
    { DEMO_AUTOPILOT: 'false' },
    { DEMO_IGNORE_PAYER_HOURS: 'false' },
    { DEMO_SUMMARIZER_FALLBACK: 'false' },
    { INTERNAL_JOB_SECRET: 'short' },
    { DOB_HASH_SECRET: '' },
  ])('requires every explicit synthetic mode interlock %#', (override) => {
    expect(() => validateDemoConfiguration({ ...environment, ...override }, actor)).toThrowError(
      'DEMO_SYNTHETIC_MODE_REQUIRED',
    );
  });

  it.each([
    { CLERK_SECRET_KEY: '' },
    { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: '' },
    { CLERK_SECRET_KEY: 'sk_live_private_canary' },
    { NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_live_private_canary' },
    { CLERK_PUBLISHABLE_KEY: 'pk_test_different_instance_canary' },
  ])('requires intentionally supplied consistent Clerk test configuration %#', (override) => {
    expect(() => validateDemoConfiguration({ ...environment, ...override }, actor)).toThrowError(
      'DEMO_CLERK_TEST_CONFIGURATION_REQUIRED',
    );
  });

  it('rejects synthetic local organization bypass and unsupported arguments', () => {
    expect(() =>
      validateDemoConfiguration(environment, { ...actor, clerkOrganizationId: 'local_demo' }),
    ).toThrowError('DEMO_ARGUMENTS_INVALID');
    expect(() => validateDemoConfiguration(environment, { ...actor, reset: true })).toThrowError(
      'DEMO_ARGUMENTS_INVALID',
    );
  });

  it.each([
    { databaseName: 'other' },
    { readOnly: false },
    { organization: null },
    { organization: { clerkOrgId: 'org_other' } },
    { actor: null },
    { actor: { clerkUserId: 'user_other', role: 'OWNER' } },
    { actor: { clerkUserId: actor.clerkUserId, role: 'BILLING_STAFF' } },
    { otherOrganizations: 1 },
    { otherActors: 1 },
  ])('rejects a mismatched database or local actor snapshot %#', (override) => {
    expect(() =>
      assessDemoDatabase(validateDemoConfiguration(environment, actor), migrations, {
        ...snapshot,
        ...override,
      }),
    ).toThrowError(DemoPreflightError);
  });

  it.each(
    [
      [],
      [{ ...snapshot.migrations[0]!, checksum: 'b'.repeat(64) }],
      [{ ...snapshot.migrations[0]!, finished: false }],
      [{ ...snapshot.migrations[0]!, rolledBack: true }],
      [snapshot.migrations[0]!, snapshot.migrations[0]!],
      [...snapshot.migrations, { ...snapshot.migrations[0]!, name: 'unexpected_migration' }],
    ].map((actual) => ({ actual })),
  )('rejects absent, changed, incomplete, rolled-back or extra migrations %#', ({ actual }) => {
    expect(() =>
      assessDemoDatabase(validateDemoConfiguration(environment, actor), migrations, {
        ...snapshot,
        migrations: actual,
      }),
    ).toThrowError('DEMO_MIGRATIONS_INVALID');
  });
});
