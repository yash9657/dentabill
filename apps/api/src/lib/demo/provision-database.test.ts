import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prepareIsolatedDemoRuntime, type IsolatedDemoRuntime } from './isolated-runtime.js';
import type { DemoPreflightConfiguration, ExpectedDemoMigration } from './preflight-policy.js';
import {
  DemoProvisionDatabaseResultSchema,
  demoMigrationDigest,
  type DemoProvisionDatabaseResult,
} from './provision-contract.js';
import { stageDemoMigrations } from './provision-migrations.js';

const projectRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const ownedDatabases = new Map<string, DemoPreflightConfiguration>();
let runtime: IsolatedDemoRuntime | undefined;
let baseUrl: URL;
let migrations: ExpectedDemoMigration[] = [];

interface ProvisionRequest {
  configuration: DemoPreflightConfiguration;
  provisionId: string;
  manifestSha256: string;
  migrations: readonly ExpectedDemoMigration[];
}

interface ChildResult {
  result: DemoProvisionDatabaseResult;
  migrationCalls: number;
}

interface Snapshot {
  tables: number;
  organizations: { id: string; clerkOrgId: string; npi: string; callsUsed: number; plan: string }[];
  users: { id: string; organizationId: string; clerkUserId: string; role: string; email: string }[];
  payers: { organizationId: string; payerCode: string; enabled: boolean; providerNpi: string }[];
  audits: {
    id: string;
    action: string;
    organizationId: string;
    userId: string;
    metadata: Record<string, unknown>;
  }[];
  workflowCounts: number[];
  migrationCount: number;
}

// The real implementation and Prisma client are imported only inside this private runtime.
// No test code imports the repository-generated Prisma client or loads repository dotenv files.
const entrySource = `
  import { readFileSync } from 'node:fs';
  import { PrismaClient } from '@prisma/client';
  import { provisionDemoDatabase } from ${JSON.stringify(join(projectRoot, 'apps/api/src/lib/demo/provision-database.ts'))};
  import { migrateStagedDemoDatabase } from ${JSON.stringify(join(projectRoot, 'apps/api/src/lib/demo/provision-migrations.ts'))};

  const request = JSON.parse(readFileSync(0, 'utf8'));
  const targetUrl = new URL(request.input.configuration.databaseUrl);
  const databaseName = request.input.configuration.databaseName;
  const open = () => new PrismaClient({ datasourceUrl: targetUrl.href, log: [] });
  let result;
  try {
    if (request.operation === 'provision') {
      let migrationCalls = 0;
      const provision = await provisionDemoDatabase({
        ...request.input,
        migrate: async () => {
          migrationCalls += 1;
          if (request.fault === 'MIGRATION_FAILURE') throw new Error('SYNTHETIC_PRIVATE_ERROR_CANARY');
          await migrateStagedDemoDatabase({
            projectRoot: ${JSON.stringify(projectRoot)},
            schemaPath: request.schemaPath,
            databaseUrl: targetUrl.href,
            path: process.env.PATH,
          });
          const client = open();
          try {
            if (request.fault === 'CHECKSUM_MISMATCH') {
              await client.$executeRawUnsafe('UPDATE "_prisma_migrations" SET checksum = $1 WHERE migration_name = $2', '0'.repeat(64), request.input.migrations[0].name);
            }
            if (request.fault === 'EXTRA_MIGRATION') {
              await client.$executeRawUnsafe('INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES ($1, $2, now(), $3, now(), 1)', 'synthetic-extra', '0'.repeat(64), '20990101000000_unexpected');
            }
            if (request.fault === 'AUDIT_FAILURE') {
              await client.$executeRawUnsafe(${JSON.stringify("CREATE FUNCTION demo_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'SYNTHETIC_PRIVATE_ERROR_CANARY'; END $$")});
              await client.$executeRawUnsafe('CREATE TRIGGER demo_test_audit_failure BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION demo_test_audit_failure()');
            }
            if (request.fault === 'VERIFY_TAMPER') {
              await client.$executeRawUnsafe(${JSON.stringify("CREATE FUNCTION demo_test_audit_tamper() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.metadata = jsonb_set(NEW.metadata, '{synthetic}', 'false'::jsonb); RETURN NEW; END $$")});
              await client.$executeRawUnsafe('CREATE TRIGGER demo_test_audit_tamper BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION demo_test_audit_tamper()');
            }
          } finally { await client.$disconnect(); }
        },
      });
      result = { result: provision, migrationCalls };
    } else if (request.operation === 'inspect') {
      const client = open();
      try {
        result = await client.$transaction(async tx => {
          await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
          const tables = await tx.$queryRawUnsafe(${JSON.stringify("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'")});
          if (tables[0].count === 0) return { tables: 0 };
          const [organizations, users, payers, audits, workflowCounts, migrationRows] = await Promise.all([
            tx.organization.findMany({ orderBy: { id: 'asc' } }),
            tx.user.findMany({ orderBy: { id: 'asc' } }),
            tx.payerConfig.findMany({ orderBy: { id: 'asc' } }),
            tx.auditLog.findMany({ orderBy: { id: 'asc' } }),
            Promise.all([
              tx.claim.count(), tx.call.count(), tx.callIntent.count(), tx.callSummary.count(),
              tx.inferenceRun.count(), tx.inferenceBudget.count(), tx.jobOutbox.count(),
              tx.billingUsageRecord.count(), tx.claimRemittanceEvidence.count(),
              tx.cashSourceTransaction.count(), tx.remittanceBatchEvidence.count(), tx.cashBatchMatch.count(),
              tx.postingSourceReceipt.count(), tx.postingClaimRelationship.count(), tx.reviewNotificationIntent.count(),
            ]),
            tx.$queryRawUnsafe('SELECT count(*)::int AS count FROM "_prisma_migrations"'),
          ]);
          return { tables: tables[0].count, organizations, users, payers, audits, workflowCounts, migrationCount: migrationRows[0].count };
        });
      } finally { await client.$disconnect(); }
    } else if (request.operation === 'drop') {
      // Only the parent passes names whose CREATE acknowledgment it observed in this test run.
      if (!/^dentabill_demo_pt[a-f0-9]{32}$/.test(databaseName) || targetUrl.pathname !== '/' + databaseName || !['localhost', '127.0.0.1', '[::1]'].includes(targetUrl.hostname)) throw new Error();
      targetUrl.pathname = '/postgres';
      targetUrl.search = '';
      const client = open();
      try { await client.$executeRawUnsafe('DROP DATABASE "' + databaseName + '"'); }
      finally { await client.$disconnect(); }
      result = { dropped: true };
    } else throw new Error();
    process.stdout.write(JSON.stringify(result) + '\\n');
  } catch {
    process.stderr.write('DEMO_PROVISION_TEST_CHILD_FAILED\\n');
    process.exitCode = 1;
  }
`;

beforeAll(async () => {
  baseUrl = new URL(process.env.DATABASE_URL ?? '');
  if (
    !['postgres:', 'postgresql:'].includes(baseUrl.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname) ||
    !['/dentabill_test', '/dentabill_w0_identity'].includes(baseUrl.pathname)
  )
    throw new Error('DEMO_PROVISION_TEST_REQUIRES_LOCAL_TEST_DATABASE');
  baseUrl.search = '';
  runtime = await prepareIsolatedDemoRuntime({
    projectRoot,
    entrySource,
    environment: {
      PATH: process.env.PATH,
      DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:1/dentabill_demo_generation',
    },
  });
  ({ migrations } = await stageDemoMigrations(
    join(projectRoot, 'packages/db/prisma/migrations'),
    runtime.schemaPath,
  ));
}, 30000);

async function child(operation: string, input: ProvisionRequest, fault?: string): Promise<unknown> {
  if (!runtime) throw new Error('DEMO_PROVISION_TEST_RUNTIME_NOT_READY');
  const currentRuntime = runtime;
  return new Promise((resolve, reject) => {
    const processHandle = spawn(process.execPath, [currentRuntime.entryPath], {
      cwd: currentRuntime.directory,
      env: { PATH: process.env.PATH, NODE_ENV: 'development' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      processHandle.kill('SIGKILL');
    }, 45000);
    processHandle.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    processHandle.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    processHandle.on('error', () => {
      clearTimeout(timer);
      reject(new Error('DEMO_PROVISION_TEST_CHILD_FAILED'));
    });
    processHandle.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0 || stderr || stdout.length > 1024 * 1024) {
        reject(new Error('DEMO_PROVISION_TEST_CHILD_FAILED'));
        return;
      }
      try {
        resolve(JSON.parse(stdout) as unknown);
      } catch {
        reject(new Error('DEMO_PROVISION_TEST_CHILD_RESULT_INVALID'));
      }
    });
    processHandle.stdin.end(
      JSON.stringify({ operation, input, fault, schemaPath: currentRuntime.schemaPath }),
    );
  });
}

function request(): ProvisionRequest {
  const id = randomUUID();
  const compact = id.replaceAll('-', '');
  const databaseName = `dentabill_demo_pt${compact}`;
  const url = new URL(baseUrl);
  url.pathname = `/${databaseName}`;
  return {
    configuration: {
      databaseUrl: url.href,
      databaseName,
      appOrigin: 'http://localhost:3000',
      apiOrigin: 'http://localhost:3001',
      actor: {
        organizationId: `demo-org-${id}`,
        userId: `demo-user-${id}`,
        clerkOrganizationId: `org_demo${compact}`,
        clerkUserId: `user_demo${compact}`,
      },
    },
    provisionId: id,
    manifestSha256: 'a'.repeat(64),
    migrations,
  };
}

async function provision(input: ProvisionRequest, fault?: string): Promise<ChildResult> {
  const output = (await child('provision', input, fault)) as ChildResult;
  const parsed = DemoProvisionDatabaseResultSchema.parse(output.result);
  if (parsed.databaseState === 'CREATED' || parsed.databaseState === 'CREATED_PRESERVED') {
    ownedDatabases.set(input.configuration.databaseName, input.configuration);
  }
  expect(JSON.stringify(output)).not.toContain('SYNTHETIC_PRIVATE_ERROR_CANARY');
  return { ...output, result: parsed };
}

async function inspect(input: ProvisionRequest): Promise<Snapshot> {
  return (await child('inspect', input)) as Snapshot;
}

afterAll(async () => {
  try {
    for (const configuration of ownedDatabases.values()) {
      await child('drop', {
        configuration,
        provisionId: randomUUID(),
        manifestSha256: 'a'.repeat(64),
        migrations,
      });
      ownedDatabases.delete(configuration.databaseName);
    }
  } finally {
    await runtime?.dispose();
  }
}, 30000);

describe('create-only isolated demo database provisioning', () => {
  it('creates outside a transaction, applies exact migrations and atomically seeds only the reviewed synthetic actor facts', async () => {
    const input = request();
    const output = await provision(input);
    expect(output.result).toMatchObject({
      status: 'PROVISIONED',
      phase: 'COMPLETE',
      databaseState: 'CREATED',
      provisionId: input.provisionId,
      databaseName: input.configuration.databaseName,
      actor: input.configuration.actor,
      actorRole: 'OWNER',
      manifestSha256: input.manifestSha256,
      migrationDigest: demoMigrationDigest(migrations),
      migrationCount: migrations.length,
      authentication: 'NOT_VERIFIED',
      authenticatedRehearsal: 'NOT_VERIFIED',
      recording: 'NOT_VERIFIED',
    });
    expect(output.migrationCalls).toBe(1);
    const snapshot = await inspect(input);
    expect(snapshot.organizations).toHaveLength(1);
    expect(snapshot.organizations[0]).toMatchObject({
      id: input.configuration.actor.organizationId,
      clerkOrgId: input.configuration.actor.clerkOrganizationId,
      npi: '9999999999',
      callsUsed: 0,
      plan: 'TRIAL',
    });
    expect(snapshot.users).toHaveLength(1);
    expect(snapshot.users[0]).toMatchObject({
      id: input.configuration.actor.userId,
      clerkUserId: input.configuration.actor.clerkUserId,
      organizationId: input.configuration.actor.organizationId,
      role: 'OWNER',
      email: 'demo-operator@example.test',
    });
    expect(snapshot.payers).toHaveLength(1);
    expect(snapshot.payers[0]).toMatchObject({
      organizationId: input.configuration.actor.organizationId,
      payerCode: 'DELTA_DENTAL_PPO',
      enabled: true,
      providerNpi: '9999999999',
    });
    expect(snapshot.audits).toHaveLength(1);
    expect(snapshot.audits[0]).toMatchObject({
      action: 'demo.provisioned',
      organizationId: input.configuration.actor.organizationId,
      userId: input.configuration.actor.userId,
      metadata: {
        schemaVersion: 1,
        scenarioId: 'financial-review-v1',
        synthetic: true,
        provisionId: input.provisionId,
        migrationDigest: demoMigrationDigest(migrations),
        manifestSha256: input.manifestSha256,
      },
    });
    expect(snapshot.workflowCounts).toEqual(Array.from({ length: 15 }, () => 0));
    expect(snapshot.migrationCount).toBe(migrations.length);

    for (const retry of [
      input,
      {
        ...input,
        provisionId: randomUUID(),
        configuration: { ...input.configuration, actor: request().configuration.actor },
      },
    ]) {
      expect(await provision(retry, 'MIGRATION_FAILURE')).toMatchObject({
        result: {
          status: 'PROVISION_FAILED',
          code: 'DEMO_DATABASE_EXISTS',
          phase: 'CREATE_DATABASE',
          databaseState: 'EXISTING_UNCHANGED',
        },
        migrationCalls: 0,
      });
      expect(await inspect(input)).toEqual(snapshot);
    }
  }, 60000);

  it('allows only one independent process to create the same database', async () => {
    const input = request();
    const outputs = await Promise.all([provision(input), provision(input)]);
    expect(outputs.filter(({ result }) => result.status === 'PROVISIONED')).toHaveLength(1);
    expect(outputs.filter(({ result }) => result.status === 'PROVISION_FAILED')).toMatchObject([
      {
        result: { code: 'DEMO_DATABASE_EXISTS', databaseState: 'EXISTING_UNCHANGED' },
        migrationCalls: 0,
      },
    ]);
    expect(outputs.reduce((sum, output) => sum + output.migrationCalls, 0)).toBe(1);
    expect((await inspect(input)).audits).toHaveLength(1);
  }, 60000);

  it('preserves a created database on migration failure and refuses a retry', async () => {
    const input = request();
    expect(await provision(input, 'MIGRATION_FAILURE')).toMatchObject({
      result: {
        status: 'PROVISION_FAILED',
        code: 'DEMO_MIGRATIONS_FAILED',
        phase: 'MIGRATE',
        databaseState: 'CREATED_PRESERVED',
      },
      migrationCalls: 1,
    });
    expect(await inspect(input)).toEqual({ tables: 0 });
    expect(await provision(input)).toMatchObject({
      result: { code: 'DEMO_DATABASE_EXISTS', databaseState: 'EXISTING_UNCHANGED' },
      migrationCalls: 0,
    });
    expect(await inspect(input)).toEqual({ tables: 0 });
  }, 30000);

  it.each(['CHECKSUM_MISMATCH', 'EXTRA_MIGRATION'])(
    'withholds seed when migrated history differs: %s',
    async (fault) => {
      const input = request();
      expect(await provision(input, fault)).toMatchObject({
        result: {
          status: 'PROVISION_FAILED',
          code: 'DEMO_MIGRATIONS_FAILED',
          phase: 'MIGRATE',
          databaseState: 'CREATED_PRESERVED',
        },
      });
      const snapshot = await inspect(input);
      expect([snapshot.organizations, snapshot.users, snapshot.payers, snapshot.audits]).toEqual([
        [],
        [],
        [],
        [],
      ]);
      expect(snapshot.workflowCounts).toEqual(Array.from({ length: 15 }, () => 0));
    },
    60000,
  );

  it('rolls back every seed fact if the mandatory audit fails', async () => {
    const input = request();
    expect(await provision(input, 'AUDIT_FAILURE')).toMatchObject({
      result: {
        status: 'PROVISION_FAILED',
        code: 'DEMO_SEED_UNCONFIRMED',
        phase: 'SEED',
        databaseState: 'CREATED_PRESERVED',
      },
    });
    const snapshot = await inspect(input);
    expect([snapshot.organizations, snapshot.users, snapshot.payers, snapshot.audits]).toEqual([
      [],
      [],
      [],
      [],
    ]);
    expect(snapshot.migrationCount).toBe(migrations.length);
  }, 60000);

  it('does not report success if post-seed verification finds changed audit content', async () => {
    const input = request();
    expect(await provision(input, 'VERIFY_TAMPER')).toMatchObject({
      result: {
        status: 'PROVISION_FAILED',
        code: 'DEMO_PROVISION_VERIFY_FAILED',
        phase: 'VERIFY',
        databaseState: 'CREATED_PRESERVED',
      },
    });
    const snapshot = await inspect(input);
    expect(snapshot.organizations).toHaveLength(1);
    expect(snapshot.audits).toHaveLength(1);
    expect(snapshot.audits[0]?.metadata.synthetic).toBe(false);
    expect(await provision(input)).toMatchObject({
      result: { code: 'DEMO_DATABASE_EXISTS', databaseState: 'EXISTING_UNCHANGED' },
      migrationCalls: 0,
    });
    expect(await inspect(input)).toEqual(snapshot);
  }, 60000);

  it.each([
    'remote',
    'ordinary-database',
    'sql-identifier',
    'provision-id',
    'actor',
    'digest',
    'duplicate-migration',
    'query-override',
  ])(
    'fails before connecting or migrating for invalid %s',
    async (variation) => {
      const input = request();
      if (variation === 'remote')
        input.configuration = {
          ...input.configuration,
          databaseUrl: input.configuration.databaseUrl
            .replace('localhost', 'example.invalid')
            .replace('127.0.0.1', 'example.invalid')
            .replace('[::1]', 'example.invalid'),
        };
      if (variation === 'ordinary-database')
        input.configuration = { ...input.configuration, databaseName: 'dentabill_test' };
      if (variation === 'sql-identifier')
        input.configuration = {
          ...input.configuration,
          databaseName: 'dentabill_demo_bad";SELECT 1',
        };
      if (variation === 'provision-id') input.provisionId = 'SYNTHETIC_PRIVATE_ERROR_CANARY';
      if (variation === 'actor')
        input.configuration = {
          ...input.configuration,
          actor: { ...input.configuration.actor, clerkUserId: 'invalid' },
        };
      if (variation === 'digest') input.manifestSha256 = 'not-a-hash';
      if (variation === 'duplicate-migration') input.migrations = [...migrations, migrations[0]!];
      if (variation === 'query-override')
        input.configuration = {
          ...input.configuration,
          databaseUrl: input.configuration.databaseUrl + '?host=example.invalid',
        };
      expect(await provision(input)).toMatchObject({
        result: {
          status: 'PROVISION_FAILED',
          code: 'DEMO_PROVISION_INPUT_INVALID',
          phase: 'VALIDATE',
          databaseState: 'NOT_CREATED',
        },
        migrationCalls: 0,
      });
    },
    30000,
  );
});
