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
  'org_demoLaunch',
  '--clerk-user-id',
  'user_demoLaunch',
];

function invoke(
  args: string[],
  environment: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ['--no-warnings', '--import', 'tsx', 'scripts/demo-launch.mts', ...args],
    {
      cwd: apiDirectory,
      env: { PATH: process.env.PATH, ...environment },
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 65536,
    },
  );
  if (result.error) throw new Error('DEMO_TEST_LAUNCH_FAILED');
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('demo launch CLI early admission', () => {
  it('prints help without touching application configuration', () => {
    const result = invoke(['--help'], { RETELL_API_KEY: 'private-canary' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Isolated synthetic demo launcher');
    expect(result.stderr).toBe('');
  });

  it.each([
    { args: ['--reset'], environment: {}, code: 'DEMO_ARGUMENTS_INVALID' },
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
  ])('refuses unsafe admission with a closed error %#', ({ args, environment, code }) => {
    const result = invoke(args, environment);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(JSON.parse(result.stderr)).toMatchObject({
      status: 'LAUNCH_FAILED',
      code,
      database: 'PRESERVED',
      processesStopped: true,
    });
    expect(result.stderr).not.toContain('private-canary');
  });
});
