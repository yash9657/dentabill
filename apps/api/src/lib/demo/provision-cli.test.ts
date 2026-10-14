import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const apiDirectory = fileURLToPath(new URL('../../../', import.meta.url));
const actorArguments = [
  '--organization-id',
  'synthetic-provision-org',
  '--user-id',
  'synthetic-provision-user',
  '--clerk-organization-id',
  'org_syntheticProvision',
  '--clerk-user-id',
  'user_syntheticProvision',
];

function invoke(
  args: string[],
  environment: Record<string, string | undefined> = {},
  timeout = 10000,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ['--no-warnings', '--import', 'tsx', 'scripts/demo-provision.mts', ...args],
    {
      cwd: apiDirectory,
      env: { PATH: process.env.PATH, ...environment },
      encoding: 'utf8',
      timeout,
      maxBuffer: 64 * 1024,
    },
  );
  if (result.error) throw new Error('DEMO_PROVISION_CHILD_FAILED');
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('create-only demo CLI', () => {
  it('documents the refusal of existing databases without initializing runtime configuration', () => {
    const result = invoke(['--help'], { RETELL_API_KEY: 'private-canary' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Existing databases are always refused');
    expect(result.stdout).not.toContain('private-canary');
    expect(result.stderr).toBe('');
  });

  it.each([
    { args: ['--reset'], environment: {}, code: 'DEMO_ARGUMENTS_INVALID' },
    { args: [], environment: {}, code: 'DEMO_ARGUMENTS_INVALID' },
    {
      args: actorArguments,
      environment: { RETELL_API_KEY: 'private-canary' },
      code: 'DEMO_EXTERNAL_CONFIGURATION',
    },
    {
      args: actorArguments,
      environment: { DATABASE_URL: 'postgresql://private-canary@localhost/dentabill_test' },
      code: 'DEMO_DATABASE_NOT_ISOLATED',
    },
  ])('rejects inadmissible creation before database work %#', ({ args, environment, code }) => {
    const result = invoke(args, environment);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toEqual({
      status: 'PROVISION_FAILED',
      code,
      phase: 'VALIDATE',
      databaseState: 'NOT_CREATED',
    });
    expect(result.stderr).not.toContain('private-canary');
  });

  it('reaches only the admitted local maintenance connection through the actual private command', () => {
    const result = invoke(
      actorArguments,
      {
        DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:1/dentabill_demo_unreachable',
        NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
        NEXT_PUBLIC_API_URL: 'http://localhost:3001',
        INTERNAL_API_BASE_URL: 'http://localhost:3001',
        NODE_ENV: 'development',
        JOB_DISPATCH_MODE: 'inline',
        INTERNAL_JOB_SECRET: 'synthetic-provision-internal-secret-only',
        DOB_HASH_SECRET: 'synthetic-provision-dob-secret-only',
        SUMMARY_ANALYSIS_PROVIDER: 'SYNTHETIC',
        SUMMARIZER_AUTO_TRANSITION_ENABLED: 'false',
        DEMO_AUTOPILOT: 'true',
        DEMO_IGNORE_PAYER_HOURS: 'true',
        DEMO_SUMMARIZER_FALLBACK: 'true',
        CLERK_SECRET_KEY: 'sk_test_synthetic_provision_not_a_credential',
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: 'pk_test_synthetic_provision_not_a_credential',
      },
      90000,
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toEqual({
      status: 'PROVISION_FAILED',
      code: 'DEMO_MAINTENANCE_UNAVAILABLE',
      phase: 'CREATE_DATABASE',
      databaseState: 'NOT_CREATED',
      provisionId: expect.any(String),
      databaseName: 'dentabill_demo_unreachable',
    });
  }, 120000);
});
