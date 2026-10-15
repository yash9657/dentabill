import { join } from 'node:path';

import { inspectDemoDatabase, readDemoMigrations } from './preflight-database.js';
import {
  assessDemoDatabase,
  DemoPreflightError,
  validateDemoConfiguration,
  type DemoPreflightReport,
} from './preflight-policy.js';

/** Execute only inside the private runtime prepared by demo-preflight.mts. */
export async function runDemoPreflight(
  projectRoot: string,
  environment: Readonly<Record<string, string | undefined>>,
  actorInput: unknown,
): Promise<DemoPreflightReport> {
  try {
    const configuration = validateDemoConfiguration(environment, actorInput);
    let manifestSha256: string;
    try {
      const { verifyDemoBundle } = await import('./bundle.js');
      const bundle = await verifyDemoBundle(join(projectRoot, 'apps/web/public/examples/demo'));
      manifestSha256 = bundle.manifestSha256;
    } catch {
      throw new DemoPreflightError('DEMO_FIXTURES_INVALID');
    }
    const migrations = await readDemoMigrations(join(projectRoot, 'packages/db/prisma/migrations'));
    const { PrismaClient } = await import('@dentabill/db');
    const client = new PrismaClient({ datasourceUrl: configuration.databaseUrl, log: [] });
    try {
      const snapshot = await inspectDemoDatabase(client, configuration);
      const result = assessDemoDatabase(configuration, migrations, snapshot);
      return {
        status: 'PREFLIGHT_PASSED',
        scenarioId: 'financial-review-v1',
        manifestSha256,
        readOnly: true,
        migrationCount: result.migrationCount,
        actorRole: result.actorRole,
        authentication: 'CLERK_TEST_CONFIGURATION_PRESENT_NOT_VERIFIED',
        authenticatedRehearsal: 'NOT_VERIFIED',
        providerMode: 'SYNTHETIC',
        recording: 'NOT_VERIFIED',
      };
    } finally {
      await client.$disconnect();
    }
  } catch (error: unknown) {
    return {
      status: 'PREFLIGHT_FAILED',
      code: error instanceof DemoPreflightError ? error.code : 'DEMO_PREFLIGHT_FAILED',
    };
  }
}
