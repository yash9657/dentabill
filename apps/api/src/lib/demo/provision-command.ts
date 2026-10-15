/* eslint-disable security/detect-non-literal-fs-filename -- The child argument must resolve to its generated schema inside the private runtime cwd. */
import { lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { z } from 'zod';

import { DemoPreflightError, validateDemoConfiguration } from './preflight-policy.js';
import type { DemoProvisionDatabaseResult } from './provision-contract.js';
import { migrateStagedDemoDatabase, stageDemoMigrations } from './provision-migrations.js';

/** Only the isolated CLI runtime may supply this private schema path. */
export async function runDemoProvision(
  projectRoot: string,
  environment: Readonly<Record<string, string | undefined>>,
  actorInput: unknown,
  schemaPath: unknown,
  provisionId: unknown,
): Promise<DemoProvisionDatabaseResult> {
  let databaseName: string | undefined;
  let id: string | undefined;
  let databaseWorkStarted = false;
  try {
    const configuration = validateDemoConfiguration(environment, actorInput);
    databaseName = configuration.databaseName;
    id = z.uuid().parse(provisionId);
    const expectedSchema = resolve(process.cwd(), 'generator/schema.prisma');
    if (
      typeof schemaPath !== 'string' ||
      !(await lstat(schemaPath)).isFile() ||
      (await realpath(schemaPath)) !== expectedSchema
    ) {
      throw new DemoPreflightError('DEMO_ISOLATED_RUNTIME_FAILED');
    }
    let manifestSha256: string;
    try {
      const { verifyDemoBundle } = await import('./bundle.js');
      const bundle = await verifyDemoBundle(join(projectRoot, 'apps/web/public/examples/demo'));
      manifestSha256 = bundle.manifestSha256;
    } catch {
      throw new DemoPreflightError('DEMO_FIXTURES_INVALID');
    }
    const { migrations } = await stageDemoMigrations(
      join(projectRoot, 'packages/db/prisma/migrations'),
      schemaPath,
    );
    const { provisionDemoDatabase } = await import('./provision-database.js');
    databaseWorkStarted = true;
    return await provisionDemoDatabase({
      configuration,
      provisionId: id,
      manifestSha256,
      migrations,
      migrate: () =>
        migrateStagedDemoDatabase({
          projectRoot,
          schemaPath,
          databaseUrl: configuration.databaseUrl,
          path: environment.PATH,
        }),
    });
  } catch (error: unknown) {
    return {
      status: 'PROVISION_FAILED',
      code: databaseWorkStarted
        ? 'DEMO_PROVISION_OUTCOME_UNKNOWN'
        : error instanceof DemoPreflightError
          ? error.code
          : 'DEMO_PROVISION_INPUT_INVALID',
      phase: databaseWorkStarted ? 'UNKNOWN' : 'VALIDATE',
      databaseState: databaseWorkStarted ? 'OUTCOME_UNKNOWN' : 'NOT_CREATED',
      ...(id ? { provisionId: id } : {}),
      ...(databaseName ? { databaseName } : {}),
    };
  }
}
