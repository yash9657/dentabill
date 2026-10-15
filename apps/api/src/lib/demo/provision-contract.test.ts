import { describe, expect, it } from 'vitest';

import { demoMigrationDigest, DemoProvisionDatabaseResultSchema } from './provision-contract.js';

const migrations = [
  { name: '20261014210000_synthetic_second', checksum: 'b'.repeat(64) },
  { name: '20261014200000_synthetic_first', checksum: 'a'.repeat(64) },
];

describe('demo provisioning receipts', () => {
  it('binds exact migration names and bytes independent of discovery order', () => {
    const before = JSON.stringify(migrations);
    expect(demoMigrationDigest(migrations)).toBe(demoMigrationDigest([...migrations].reverse()));
    expect(JSON.stringify(migrations)).toBe(before);
    expect(demoMigrationDigest(migrations)).not.toBe(
      demoMigrationDigest([{ ...migrations[0]!, checksum: 'c'.repeat(64) }, migrations[1]!]),
    );
    expect(() => demoMigrationDigest([])).toThrowError('DEMO_PROVISION_INPUT_INVALID');
    expect(() => demoMigrationDigest([migrations[0]!, migrations[0]!])).toThrowError(
      'DEMO_PROVISION_INPUT_INVALID',
    );
    expect(() =>
      demoMigrationDigest([{ name: '../private-canary', checksum: 'private-canary' }]),
    ).toThrowError('DEMO_PROVISION_INPUT_INVALID');
  });

  it('distinguishes existing unchanged and uncertain outcomes without leaking error details', () => {
    const report = {
      status: 'PROVISION_FAILED',
      code: 'DEMO_PROVISION_OUTCOME_UNKNOWN',
      phase: 'VERIFY',
      databaseState: 'OUTCOME_UNKNOWN',
      databaseName: 'dentabill_demo_receipt',
    };
    expect(DemoProvisionDatabaseResultSchema.parse(report)).toEqual(report);
    expect(
      DemoProvisionDatabaseResultSchema.safeParse({ ...report, detail: 'private-canary' }).success,
    ).toBe(false);
    expect(
      DemoProvisionDatabaseResultSchema.safeParse({ ...report, databaseName: 'dentabill' }).success,
    ).toBe(false);
    expect(
      DemoProvisionDatabaseResultSchema.safeParse({ ...report, code: 'private-canary' }).success,
    ).toBe(false);
  });
});
