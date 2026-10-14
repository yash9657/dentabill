import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  DemoActorInputSchema,
  DemoPreflightCodeSchema,
  type ExpectedDemoMigration,
} from './preflight-policy.js';

const databaseName = z.string().regex(/^dentabill_demo_[a-z0-9][a-z0-9_]{0,47}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const migrationSchema = z.strictObject({
  name: z
    .string()
    .regex(/^\d{14}_[a-z0-9_]+$/)
    .max(200),
  checksum: digest,
});

export function demoMigrationDigest(migrations: readonly ExpectedDemoMigration[]): string {
  const parsed = z.array(migrationSchema).min(1).max(1000).safeParse(migrations);
  if (
    !parsed.success ||
    new Set(parsed.data.map((migration) => migration.name)).size !== parsed.data.length
  ) {
    throw new Error('DEMO_PROVISION_INPUT_INVALID');
  }
  const ordered = parsed.data.sort((a, b) => a.name.localeCompare(b.name));
  return createHash('sha256')
    .update('dentabill-demo-migrations-v1\n' + JSON.stringify(ordered))
    .digest('hex');
}

export const DemoProvisionDatabaseResultSchema = z.discriminatedUnion('status', [
  z.strictObject({
    status: z.literal('PROVISIONED'),
    phase: z.literal('COMPLETE'),
    databaseState: z.literal('CREATED'),
    provisionId: z.uuid(),
    databaseName,
    actor: DemoActorInputSchema,
    actorRole: z.literal('OWNER'),
    auditId: z.string().min(1).max(200),
    manifestSha256: digest,
    migrationDigest: digest,
    migrationCount: z.number().int().min(1).max(1000),
    authentication: z.literal('NOT_VERIFIED'),
    authenticatedRehearsal: z.literal('NOT_VERIFIED'),
    recording: z.literal('NOT_VERIFIED'),
  }),
  z.strictObject({
    status: z.literal('PROVISION_FAILED'),
    code: z.union([
      DemoPreflightCodeSchema,
      z.enum([
        'DEMO_PROVISION_INPUT_INVALID',
        'DEMO_MAINTENANCE_UNAVAILABLE',
        'DEMO_DATABASE_EXISTS',
        'DEMO_DATABASE_CREATE_FAILED',
        'DEMO_DATABASE_CREATE_UNCONFIRMED',
        'DEMO_MIGRATIONS_FAILED',
        'DEMO_SEED_UNCONFIRMED',
        'DEMO_PROVISION_VERIFY_FAILED',
        'DEMO_PROVISION_OUTCOME_UNKNOWN',
      ]),
    ]),
    phase: z.enum([
      'VALIDATE',
      'CREATE_DATABASE',
      'MIGRATE',
      'SEED',
      'VERIFY',
      'COMPLETE',
      'UNKNOWN',
    ]),
    databaseState: z.enum([
      'NOT_CREATED',
      'EXISTING_UNCHANGED',
      'CREATED_PRESERVED',
      'CREATE_OUTCOME_UNKNOWN',
      'OUTCOME_UNKNOWN',
    ]),
    provisionId: z.uuid().optional(),
    databaseName: databaseName.optional(),
  }),
]);
export type DemoProvisionDatabaseResult = z.infer<typeof DemoProvisionDatabaseResultSchema>;
