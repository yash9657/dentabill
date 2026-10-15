import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const apiDirectory = fileURLToPath(new URL('../../../', import.meta.url));
const actorArguments = [
  '--organization-id',
  'synthetic-local-org',
  '--user-id',
  'synthetic-local-user',
  '--clerk-organization-id',
  'org_syntheticPreflight',
  '--clerk-user-id',
  'user_syntheticPreflight',
];

function invoke(
  args: string[],
  overrides: Record<string, string | undefined> = {},
  timeout = 10000,
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ['--no-warnings', '--import', 'tsx', 'scripts/demo-preflight.mts', ...args],
    {
      cwd: apiDirectory,
      env: { PATH: process.env.PATH, ...overrides },
      encoding: 'utf8',
      timeout,
      maxBuffer: 64 * 1024,
    },
  );
  if (result.error) throw new Error('DEMO_PREFLIGHT_CHILD_FAILED');
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('demo preflight CLI admission', () => {
  it('executes the admitted command through its private runtime with a closed database failure', () => {
    const result = invoke(
      actorArguments,
      {
        DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:1/dentabill_demo_unreachable',
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
        HTTPS_PROXY: 'https://private-canary.invalid',
      },
      90000,
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe(
      JSON.stringify({ status: 'PREFLIGHT_FAILED', code: 'DEMO_DATABASE_UNAVAILABLE' }) + '\n',
    );
    expect(result.stderr).not.toContain('private-canary');
  }, 120000);

  it('shows static help without loading app configuration or connecting to a database', () => {
    const result = invoke(['--help'], { RETELL_API_KEY: 'private-canary' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Read-only synthetic demo preflight');
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('private-canary');
  });

  it.each([
    { args: ['--unknown', 'private-canary'], environment: {}, code: 'DEMO_ARGUMENTS_INVALID' },
    { args: [], environment: {}, code: 'DEMO_ARGUMENTS_INVALID' },
    {
      args: actorArguments,
      environment: { RETELL_API_KEY: 'private-canary' },
      code: 'DEMO_EXTERNAL_CONFIGURATION',
    },
    {
      args: actorArguments,
      environment: { DATABASE_URL: 'postgresql://private-canary@remote.invalid/dentabill' },
      code: 'DEMO_DATABASE_NOT_ISOLATED',
    },
  ])(
    'rejects before database/provider initialization with a closed diagnostic %#',
    ({ args, environment, code }) => {
      const result = invoke(args, environment);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe(JSON.stringify({ status: 'PREFLIGHT_FAILED', code }) + '\n');
      expect(result.stderr).not.toContain('private-canary');
      expect(result.stderr).not.toContain('Prisma');
    },
  );
});
