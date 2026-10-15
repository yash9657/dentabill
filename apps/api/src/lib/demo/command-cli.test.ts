import { describe, expect, it } from 'vitest';

import { decodeDemoCommandReport, demoCommandFailure } from './command-cli.js';
import { DemoPreflightError } from './preflight-policy.js';

const refused = {
  status: 'PROVISION_FAILED',
  code: 'DEMO_DATABASE_EXISTS',
  phase: 'CREATE_DATABASE',
  databaseState: 'EXISTING_UNCHANGED',
  databaseName: 'dentabill_demo_existing',
};
const accepted = {
  status: 'PREFLIGHT_PASSED',
  scenarioId: 'financial-review-v1',
  manifestSha256: 'a'.repeat(64),
  readOnly: true,
  migrationCount: 33,
  actorRole: 'OWNER',
  authentication: 'CLERK_TEST_CONFIGURATION_PRESENT_NOT_VERIFIED',
  authenticatedRehearsal: 'NOT_VERIFIED',
  providerMode: 'SYNTHETIC',
  recording: 'NOT_VERIFIED',
};

describe('demo CLI process outcomes', () => {
  it('requires a valid closed report and matching exit status', () => {
    expect(decodeDemoCommandReport('provision', JSON.stringify(refused), '', { code: 1 })).toEqual(
      refused,
    );
    expect(decodeDemoCommandReport('preflight', JSON.stringify(accepted), '', null)).toEqual(
      accepted,
    );
    expect(() =>
      decodeDemoCommandReport('preflight', JSON.stringify(accepted), '', { code: 1 }),
    ).toThrow('DEMO_ISOLATED_RUNTIME_FAILED');
  });

  it.each([
    { stdout: '{"status":', stderr: '', error: null },
    { stdout: JSON.stringify(refused), stderr: 'private-canary', error: { code: 1 } },
    { stdout: JSON.stringify(refused), stderr: '', error: null },
    { stdout: JSON.stringify(refused), stderr: '', error: { code: 'ETIMEDOUT' } },
    { stdout: '', stderr: '', error: { code: 'ENOENT' } },
    {
      stdout: JSON.stringify({ ...refused, detail: 'private-canary' }),
      stderr: '',
      error: { code: 1 },
    },
  ])(
    'preserves uncertainty after an untrustworthy child outcome %#',
    ({ stdout, stderr, error }) => {
      let failure: unknown;
      try {
        decodeDemoCommandReport('provision', stdout, stderr, error);
      } catch (caught) {
        failure = caught;
      }
      expect(failure).toBeInstanceOf(DemoPreflightError);
      const report = demoCommandFailure({
        operation: 'provision',
        error: failure,
        childStarted: true,
      });
      expect(report).toEqual({
        status: 'PROVISION_FAILED',
        code: 'DEMO_PROVISION_OUTCOME_UNKNOWN',
        phase: 'UNKNOWN',
        databaseState: 'OUTCOME_UNKNOWN',
      });
      expect(JSON.stringify(report)).not.toContain('private-canary');
    },
  );

  it('never reports untouched data after cleanup or receipt-write failure', () => {
    for (const error of [new Error('private-cleanup-canary'), new Error('private-pipe-canary')]) {
      expect(
        demoCommandFailure({ operation: 'provision', error, childStarted: true }),
      ).toMatchObject({
        code: 'DEMO_PROVISION_OUTCOME_UNKNOWN',
        databaseState: 'OUTCOME_UNKNOWN',
      });
    }
    expect(
      demoCommandFailure({
        operation: 'provision',
        error: new DemoPreflightError('DEMO_ARGUMENTS_INVALID'),
        childStarted: false,
      }),
    ).toEqual({
      status: 'PROVISION_FAILED',
      code: 'DEMO_ARGUMENTS_INVALID',
      phase: 'VALIDATE',
      databaseState: 'NOT_CREATED',
    });
  });
});
