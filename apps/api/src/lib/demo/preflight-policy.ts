import { z } from 'zod';

const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
const blockedPrefixes = [
  'RETELL_',
  'FIREWORKS_',
  'ANTHROPIC_',
  'OPENAI_',
  'STRIPE_',
  'RESEND_',
  'SENDGRID_',
  'SMTP_',
  'AWS_',
  'VERCEL_',
  'RAILWAY_',
  'TELNYX_',
  'TWILIO_',
  'ELEVENLABS_',
  'UPSTASH_',
  'SENTRY_',
  'NEXT_PUBLIC_STRIPE_',
  'NEXT_PUBLIC_SENTRY_',
];
const blockedKeys = new Set([
  'REDIS_URL',
  'JOBS_QUEUE_URL',
  'OBSERVATION_RELEASE_ID',
  'OBSERVATION_IMPLEMENTATION_ARTIFACT_SHA256',
  'CLERK_WEBHOOK_SECRET',
  'NODE_OPTIONS',
  'NODE_PATH',
  'ESBUILD_BINARY_PATH',
  'DOTENV_CONFIG_PATH',
  'DEBUG',
]);

const DemoPreflightCodeSchema = z.enum([
  'DEMO_ARGUMENTS_INVALID',
  'DEMO_DATABASE_NOT_ISOLATED',
  'DEMO_EXTERNAL_CONFIGURATION',
  'DEMO_LOCAL_ORIGINS_REQUIRED',
  'DEMO_SYNTHETIC_MODE_REQUIRED',
  'DEMO_CLERK_TEST_CONFIGURATION_REQUIRED',
  'DEMO_MIGRATIONS_INVALID',
  'DEMO_DATABASE_UNAVAILABLE',
  'DEMO_READ_ONLY_REQUIRED',
  'DEMO_ACTOR_BINDING_MISMATCH',
  'DEMO_DATABASE_NOT_EXCLUSIVE',
  'DEMO_FIXTURES_INVALID',
  'DEMO_ISOLATED_RUNTIME_FAILED',
  'DEMO_PREFLIGHT_FAILED',
]);
export type DemoPreflightCode = z.infer<typeof DemoPreflightCodeSchema>;

export const DemoPreflightReportSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('PREFLIGHT_PASSED'),
    scenarioId: z.literal('financial-review-v1'),
    manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
    readOnly: z.literal(true),
    migrationCount: z.number().int().positive(),
    actorRole: z.enum(['OWNER', 'ADMIN']),
    authentication: z.literal('CLERK_TEST_CONFIGURATION_PRESENT_NOT_VERIFIED'),
    authenticatedRehearsal: z.literal('NOT_VERIFIED'),
    providerMode: z.literal('SYNTHETIC'),
    recording: z.literal('NOT_VERIFIED'),
  }),
  z.strictObject({ status: z.literal('PREFLIGHT_FAILED'), code: DemoPreflightCodeSchema }),
]);
export type DemoPreflightReport = z.infer<typeof DemoPreflightReportSchema>;

export class DemoPreflightError extends Error {
  public constructor(public readonly code: DemoPreflightCode) {
    super(code);
    this.name = 'DemoPreflightError';
  }
}

export const DemoActorInputSchema = z.strictObject({
  organizationId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
  userId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
  clerkOrganizationId: z.string().regex(/^org_[A-Za-z0-9]{1,196}$/),
  clerkUserId: z.string().regex(/^user_[A-Za-z0-9]{1,195}$/),
});
export type DemoActorInput = z.infer<typeof DemoActorInputSchema>;

export interface DemoPreflightConfiguration {
  readonly databaseUrl: string;
  readonly databaseName: string;
  readonly appOrigin: string;
  readonly apiOrigin: string;
  readonly actor: DemoActorInput;
}

function parseUrl(value: string | undefined, code: DemoPreflightCode): URL {
  try {
    if (!value) throw new Error();
    return new URL(value);
  } catch {
    throw new DemoPreflightError(code);
  }
}

function localOrigin(value: string | undefined): string {
  const url = parseUrl(value, 'DEMO_LOCAL_ORIGINS_REQUIRED');
  if (
    url.protocol !== 'http:' ||
    !localHosts.has(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new DemoPreflightError('DEMO_LOCAL_ORIGINS_REQUIRED');
  }
  return url.origin;
}

export function validateDemoConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
  actorInput: unknown,
): DemoPreflightConfiguration {
  const parsedActor = DemoActorInputSchema.safeParse(actorInput);
  if (!parsedActor.success) throw new DemoPreflightError('DEMO_ARGUMENTS_INVALID');

  if (
    Object.entries(environment).some(
      ([key, value]) =>
        value !== undefined &&
        value !== '' &&
        (blockedKeys.has(key) || blockedPrefixes.some((prefix) => key.startsWith(prefix))),
    )
  ) {
    throw new DemoPreflightError('DEMO_EXTERNAL_CONFIGURATION');
  }

  const database = parseUrl(environment.DATABASE_URL, 'DEMO_DATABASE_NOT_ISOLATED');
  if (
    !['postgres:', 'postgresql:'].includes(database.protocol) ||
    !localHosts.has(database.hostname) ||
    !/^\/dentabill_demo_[a-z0-9][a-z0-9_]{0,47}$/.test(database.pathname) ||
    database.hash ||
    [...database.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public') ||
    database.searchParams.getAll('schema').length > 1
  ) {
    throw new DemoPreflightError('DEMO_DATABASE_NOT_ISOLATED');
  }
  const appOrigin = localOrigin(environment.NEXT_PUBLIC_APP_URL);
  const apiOrigin = localOrigin(environment.NEXT_PUBLIC_API_URL);
  const corsOrigins =
    environment.API_CORS_ORIGINS === '' ? undefined : environment.API_CORS_ORIGINS;
  if (
    appOrigin === apiOrigin ||
    localOrigin(environment.INTERNAL_API_BASE_URL) !== apiOrigin ||
    corsOrigins?.split(',').some((value) => localOrigin(value.trim()) !== appOrigin)
  ) {
    throw new DemoPreflightError('DEMO_LOCAL_ORIGINS_REQUIRED');
  }

  if (
    environment.NODE_ENV !== 'development' ||
    environment.JOB_DISPATCH_MODE !== 'inline' ||
    environment.SUMMARY_ANALYSIS_PROVIDER !== 'SYNTHETIC' ||
    environment.SUMMARIZER_AUTO_TRANSITION_ENABLED !== 'false' ||
    environment.DEMO_AUTOPILOT !== 'true' ||
    environment.DEMO_IGNORE_PAYER_HOURS !== 'true' ||
    environment.DEMO_SUMMARIZER_FALLBACK !== 'true' ||
    (environment.INTERNAL_JOB_SECRET?.length ?? 0) < 32 ||
    (environment.DOB_HASH_SECRET?.length ?? 0) < 16
  ) {
    throw new DemoPreflightError('DEMO_SYNTHETIC_MODE_REQUIRED');
  }

  const publicKey = environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (
    !publicKey?.startsWith('pk_test_') ||
    publicKey.length < 16 ||
    !environment.CLERK_SECRET_KEY?.startsWith('sk_test_') ||
    environment.CLERK_SECRET_KEY.length < 16 ||
    (environment.CLERK_PUBLISHABLE_KEY && environment.CLERK_PUBLISHABLE_KEY !== publicKey)
  ) {
    throw new DemoPreflightError('DEMO_CLERK_TEST_CONFIGURATION_REQUIRED');
  }

  return {
    databaseUrl: database.href,
    databaseName: database.pathname.slice(1),
    appOrigin,
    apiOrigin,
    actor: parsedActor.data,
  };
}

const demoEnvironmentKeys = [
  'PATH',
  'DATABASE_URL',
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_API_URL',
  'INTERNAL_API_BASE_URL',
  'API_CORS_ORIGINS',
  'NODE_ENV',
  'JOB_DISPATCH_MODE',
  'SUMMARY_ANALYSIS_PROVIDER',
  'SUMMARIZER_AUTO_TRANSITION_ENABLED',
  'DEMO_AUTOPILOT',
  'DEMO_IGNORE_PAYER_HOURS',
  'DEMO_SUMMARIZER_FALLBACK',
  'INTERNAL_JOB_SECRET',
  'DOB_HASH_SECRET',
  'CLERK_SECRET_KEY',
  'CLERK_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
] as const;

export function isolatedDemoEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  actorInput: unknown,
): Record<string, string> {
  validateDemoConfiguration(environment, actorInput);
  const isolated: Record<string, string> = {};
  for (const key of demoEnvironmentKeys) {
    const value = environment[key];
    if (value !== undefined) isolated[key] = value;
  }
  return isolated;
}

export interface ExpectedDemoMigration {
  readonly name: string;
  readonly checksum: string;
}

export interface DemoDatabaseSnapshot {
  readonly databaseName: string;
  readonly readOnly: boolean;
  readonly migrations: readonly {
    readonly name: string;
    readonly checksum: string;
    readonly finished: boolean;
    readonly rolledBack: boolean;
  }[];
  readonly organization: { readonly clerkOrgId: string } | null;
  readonly actor: { readonly clerkUserId: string; readonly role: string } | null;
  readonly otherOrganizations: number;
  readonly otherActors: number;
}

export function assessDemoDatabase(
  configuration: DemoPreflightConfiguration,
  expectedMigrations: readonly ExpectedDemoMigration[],
  snapshot: DemoDatabaseSnapshot,
): { readonly migrationCount: number; readonly actorRole: 'OWNER' | 'ADMIN' } {
  if (snapshot.databaseName !== configuration.databaseName) {
    throw new DemoPreflightError('DEMO_DATABASE_NOT_ISOLATED');
  }
  if (!snapshot.readOnly) throw new DemoPreflightError('DEMO_READ_ONLY_REQUIRED');
  const actual = new Map(snapshot.migrations.map((item) => [item.name, item]));
  if (
    expectedMigrations.length === 0 ||
    new Set(expectedMigrations.map((item) => item.name)).size !== expectedMigrations.length ||
    actual.size !== snapshot.migrations.length ||
    actual.size !== expectedMigrations.length ||
    expectedMigrations.some((expected) => {
      const migration = actual.get(expected.name);
      return (
        !migration ||
        !/^[a-f0-9]{64}$/.test(expected.checksum) ||
        migration.checksum !== expected.checksum ||
        !migration.finished ||
        migration.rolledBack
      );
    })
  ) {
    throw new DemoPreflightError('DEMO_MIGRATIONS_INVALID');
  }
  if (
    snapshot.organization?.clerkOrgId !== configuration.actor.clerkOrganizationId ||
    snapshot.actor?.clerkUserId !== configuration.actor.clerkUserId ||
    (snapshot.actor.role !== 'OWNER' && snapshot.actor.role !== 'ADMIN')
  ) {
    throw new DemoPreflightError('DEMO_ACTOR_BINDING_MISMATCH');
  }
  if (snapshot.otherOrganizations !== 0 || snapshot.otherActors !== 0) {
    throw new DemoPreflightError('DEMO_DATABASE_NOT_EXCLUSIVE');
  }
  return { migrationCount: actual.size, actorRole: snapshot.actor.role };
}
