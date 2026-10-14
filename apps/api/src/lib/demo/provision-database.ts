import { PrismaClient, audit, type Prisma } from '@dentabill/db';

import {
  DemoActorInputSchema,
  type DemoPreflightConfiguration,
  type ExpectedDemoMigration,
} from './preflight-policy.js';
import { demoMigrationDigest, type DemoProvisionDatabaseResult } from './provision-contract.js';

type Failure = Extract<DemoProvisionDatabaseResult, { status: 'PROVISION_FAILED' }>;
type Phase = DemoProvisionDatabaseResult['phase'];
type DatabaseState = Failure['databaseState'];

export interface ProvisionDemoDatabaseInput {
  readonly configuration: DemoPreflightConfiguration;
  readonly provisionId: string;
  readonly manifestSha256: string;
  readonly migrations: readonly ExpectedDemoMigration[];
  /** Trusted callback applies the previously verified private migration snapshot. */
  readonly migrate: () => Promise<void>;
}

const syntheticPractice = 'Synthetic demo practice';
const syntheticOperator = 'Synthetic demo operator';
const syntheticEmail = 'demo-operator@example.test';
const syntheticNpi = '9999999999';
const provisionIdPattern =
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const databaseNamePattern = /^dentabill_demo_[a-z0-9][a-z0-9_]{0,47}$/;
const transactionOptions = {
  isolationLevel: 'RepeatableRead',
  maxWait: 5000,
  timeout: 10000,
} as const;

function checkedDatabaseUrl(input: ProvisionDemoDatabaseInput): URL {
  const { configuration, migrations } = input;
  const url = new URL(configuration.databaseUrl);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !databaseNamePattern.test(configuration.databaseName) ||
    url.pathname !== `/${configuration.databaseName}` ||
    url.hash ||
    [...url.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public') ||
    url.searchParams.getAll('schema').length > 1 ||
    !DemoActorInputSchema.safeParse(configuration.actor).success ||
    !provisionIdPattern.test(input.provisionId) ||
    !/^[a-f0-9]{64}$/.test(input.manifestSha256) ||
    migrations.length === 0 ||
    migrations.length > 1000 ||
    new Set(migrations.map((item) => item.name)).size !== migrations.length ||
    migrations.some(
      (item) => !/^\d{14}_[a-z0-9_]+$/.test(item.name) || !/^[a-f0-9]{64}$/.test(item.checksum),
    )
  )
    throw new Error('DEMO_PROVISION_INPUT_INVALID');
  return url;
}

function sqlState(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('meta' in error)) return undefined;
  const meta = error.meta;
  return typeof meta === 'object' &&
    meta !== null &&
    'code' in meta &&
    typeof meta.code === 'string'
    ? meta.code
    : undefined;
}

async function databaseExists(client: PrismaClient, databaseName: string): Promise<boolean> {
  const rows = await client.$queryRaw<{ exists: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${databaseName}) AS "exists"
  `;
  if (rows.length !== 1 || typeof rows[0]?.exists !== 'boolean') throw new Error();
  return rows[0].exists;
}

async function assertReadOnlyTarget(
  tx: Prisma.TransactionClient,
  databaseName: string,
): Promise<void> {
  await tx.$executeRaw`SET TRANSACTION READ ONLY`;
  const rows = await tx.$queryRaw<{ name: string; readOnly: string }[]>`
    SELECT current_database() AS name, current_setting('transaction_read_only') AS "readOnly"
  `;
  if (rows.length !== 1 || rows[0]?.name !== databaseName || rows[0].readOnly !== 'on')
    throw new Error();
}

async function assertMigrations(
  tx: Prisma.TransactionClient,
  expected: readonly ExpectedDemoMigration[],
): Promise<void> {
  const rows = await tx.$queryRaw<
    { name: string; checksum: string; finished: boolean; rolledBack: boolean }[]
  >`
    SELECT migration_name AS name, checksum, finished_at IS NOT NULL AS finished,
      rolled_back_at IS NOT NULL AS "rolledBack" FROM "_prisma_migrations"
  `;
  const actual = new Map(rows.map((row) => [row.name, row]));
  if (
    actual.size !== rows.length ||
    actual.size !== expected.length ||
    expected.some((item) => {
      const row = actual.get(item.name);
      return row?.checksum !== item.checksum || !row.finished || row.rolledBack;
    })
  )
    throw new Error();
}

async function assertNoWorkflowData(tx: Prisma.TransactionClient): Promise<void> {
  const counts = await Promise.all([
    tx.claim.count(),
    tx.call.count(),
    tx.callIntent.count(),
    tx.callSummary.count(),
    tx.inferenceRun.count(),
    tx.inferenceBudget.count(),
    tx.jobOutbox.count(),
    tx.billingUsageRecord.count(),
    tx.claimRemittanceEvidence.count(),
    tx.cashSourceTransaction.count(),
    tx.remittanceBatchEvidence.count(),
    tx.cashBatchMatch.count(),
    tx.postingSourceReceipt.count(),
    tx.postingClaimRelationship.count(),
    tx.reviewNotificationIntent.count(),
  ]);
  if (counts.some((count) => count !== 0)) throw new Error();
}

/** Must execute inside the private demo runtime; never retries or deletes a database. */
export async function provisionDemoDatabase(
  input: ProvisionDemoDatabaseInput,
): Promise<DemoProvisionDatabaseResult> {
  const { configuration, provisionId } = input;
  let phase: Phase = 'VALIDATE';
  let databaseState: DatabaseState = 'NOT_CREATED';
  let failureCode: Failure['code'] = 'DEMO_PROVISION_INPUT_INVALID';
  let maintenance: PrismaClient | undefined;
  let target: PrismaClient | undefined;
  const failure = (code: Failure['code']): Failure => ({
    status: 'PROVISION_FAILED',
    code,
    phase,
    databaseState,
    ...(provisionIdPattern.test(provisionId) ? { provisionId } : {}),
    ...(databaseNamePattern.test(configuration.databaseName)
      ? { databaseName: configuration.databaseName }
      : {}),
  });
  try {
    const targetUrl = checkedDatabaseUrl(input);
    const migrationDigest = demoMigrationDigest(input.migrations);
    const maintenanceUrl = new URL(targetUrl);
    maintenanceUrl.pathname = '/postgres';
    maintenanceUrl.search = '';
    phase = 'CREATE_DATABASE';
    failureCode = 'DEMO_MAINTENANCE_UNAVAILABLE';
    maintenance = new PrismaClient({ datasourceUrl: maintenanceUrl.href, log: [] });
    const rows = await maintenance.$queryRaw<{ name: string; readOnly: string }[]>`
      SELECT current_database() AS name, current_setting('transaction_read_only') AS "readOnly"
    `;
    if (rows.length !== 1 || rows[0]?.name !== 'postgres' || rows[0].readOnly !== 'off')
      return failure(failureCode);
    if (await databaseExists(maintenance, configuration.databaseName)) {
      databaseState = 'EXISTING_UNCHANGED';
      return failure('DEMO_DATABASE_EXISTS');
    }
    try {
      failureCode = 'DEMO_DATABASE_CREATE_UNCONFIRMED';
      databaseState = 'CREATE_OUTCOME_UNKNOWN';
      // The identifier is strictly admitted above; CREATE DATABASE must run outside $transaction.
      await maintenance.$executeRawUnsafe(
        `CREATE DATABASE "${configuration.databaseName}" TEMPLATE template0`,
      );
      databaseState = 'CREATED_PRESERVED';
    } catch (error: unknown) {
      const state = sqlState(error);
      if (
        state === '42P04' ||
        (state === '23505' && (await databaseExists(maintenance, configuration.databaseName)))
      ) {
        databaseState = 'EXISTING_UNCHANGED';
        return failure('DEMO_DATABASE_EXISTS');
      }
      if (state === '42501' || state === '25001') {
        databaseState = 'NOT_CREATED';
        return failure('DEMO_DATABASE_CREATE_FAILED');
      }
      databaseState = 'CREATE_OUTCOME_UNKNOWN';
      return failure('DEMO_DATABASE_CREATE_UNCONFIRMED');
    }
    await maintenance.$disconnect();
    maintenance = undefined;

    phase = 'MIGRATE';
    failureCode = 'DEMO_MIGRATIONS_FAILED';
    await input.migrate();
    target = new PrismaClient({ datasourceUrl: targetUrl.href, log: [] });
    await target.$transaction(async (tx) => {
      await assertReadOnlyTarget(tx, configuration.databaseName);
      await assertMigrations(tx, input.migrations);
      await assertNoWorkflowData(tx);
      const counts = await Promise.all([
        tx.organization.count(),
        tx.user.count(),
        tx.payerConfig.count(),
        tx.auditLog.count(),
      ]);
      if (counts.some((count) => count !== 0)) throw new Error();
    }, transactionOptions);

    phase = 'SEED';
    failureCode = 'DEMO_SEED_UNCONFIRMED';
    const actor = configuration.actor;
    const metadata = {
      schemaVersion: 1,
      scenarioId: 'financial-review-v1',
      synthetic: true,
      provisionId,
      manifestSha256: input.manifestSha256,
      migrationDigest,
      migrationCount: input.migrations.length,
    };
    const receipt = await target.$transaction(
      async (tx) => {
        await tx.organization.create({
          data: {
            id: actor.organizationId,
            clerkOrgId: actor.clerkOrganizationId,
            name: syntheticPractice,
            npi: syntheticNpi,
            plan: 'TRIAL',
            callsUsed: 0,
            settings: {},
            featureFlags: {},
            summaryTokensUsed: 0,
            summaryTokensResetAt: null,
            stripeCustomerId: null,
          },
        });
        await tx.user.create({
          data: {
            id: actor.userId,
            clerkUserId: actor.clerkUserId,
            organizationId: actor.organizationId,
            role: 'OWNER',
            email: syntheticEmail,
            name: syntheticOperator,
          },
        });
        await tx.payerConfig.create({
          data: {
            organizationId: actor.organizationId,
            payerCode: 'DELTA_DENTAL_PPO',
            enabled: true,
            providerNpi: syntheticNpi,
            groupNumber: null,
          },
        });
        return audit(
          {
            organizationId: actor.organizationId,
            userId: actor.userId,
            action: 'demo.provisioned',
            resourceType: 'Organization',
            resourceId: actor.organizationId,
            metadata,
          },
          tx,
        );
      },
      { maxWait: 5000, timeout: 10000 },
    );

    phase = 'VERIFY';
    failureCode = 'DEMO_PROVISION_VERIFY_FAILED';
    await target.$transaction(async (tx) => {
      await assertReadOnlyTarget(tx, configuration.databaseName);
      await assertMigrations(tx, input.migrations);
      await assertNoWorkflowData(tx);
      const [organization, user, payers, audits, organizationCount, userCount] = await Promise.all([
        tx.organization.findUnique({ where: { id: actor.organizationId } }),
        tx.user.findFirst({ where: { id: actor.userId, organizationId: actor.organizationId } }),
        tx.payerConfig.findMany({ where: { organizationId: actor.organizationId } }),
        tx.auditLog.findMany({ where: { organizationId: actor.organizationId } }),
        tx.organization.count(),
        tx.user.count(),
      ]);
      const payer = payers[0];
      const savedAudit = audits[0];
      if (
        organizationCount !== 1 ||
        userCount !== 1 ||
        organization?.clerkOrgId !== actor.clerkOrganizationId ||
        organization.name !== syntheticPractice ||
        organization.npi !== syntheticNpi ||
        organization.plan !== 'TRIAL' ||
        organization.callsUsed !== 0 ||
        organization.summaryTokensUsed !== 0 ||
        organization.summaryTokensResetAt !== null ||
        organization.stripeCustomerId !== null ||
        JSON.stringify(organization.settings) !== '{}' ||
        JSON.stringify(organization.featureFlags) !== '{}' ||
        user?.clerkUserId !== actor.clerkUserId ||
        user.role !== 'OWNER' ||
        user.email !== syntheticEmail ||
        user.name !== syntheticOperator ||
        payers.length !== 1 ||
        payer?.payerCode !== 'DELTA_DENTAL_PPO' ||
        !payer.enabled ||
        payer.providerNpi !== syntheticNpi ||
        payer.groupNumber !== null ||
        audits.length !== 1 ||
        savedAudit?.id !== receipt.id ||
        savedAudit.action !== 'demo.provisioned' ||
        savedAudit.userId !== actor.userId ||
        savedAudit.resourceType !== 'Organization' ||
        savedAudit.resourceId !== actor.organizationId ||
        savedAudit.ipAddress !== null ||
        savedAudit.userAgent !== null ||
        typeof savedAudit.metadata !== 'object' ||
        savedAudit.metadata === null ||
        Array.isArray(savedAudit.metadata) ||
        Object.keys(savedAudit.metadata).length !== Object.keys(metadata).length ||
        !Object.entries(metadata).every(
          ([key, value]) => (savedAudit.metadata as Prisma.JsonObject)[key] === value,
        )
      )
        throw new Error();
    }, transactionOptions);
    return {
      status: 'PROVISIONED',
      phase: 'COMPLETE',
      databaseState: 'CREATED',
      provisionId,
      databaseName: configuration.databaseName,
      actor,
      actorRole: 'OWNER',
      auditId: receipt.id,
      manifestSha256: input.manifestSha256,
      migrationDigest,
      migrationCount: input.migrations.length,
      authentication: 'NOT_VERIFIED',
      authenticatedRehearsal: 'NOT_VERIFIED',
      recording: 'NOT_VERIFIED',
    };
  } catch {
    return failure(failureCode);
  } finally {
    await maintenance?.$disconnect().catch(() => undefined);
    await target?.$disconnect().catch(() => undefined);
  }
}
