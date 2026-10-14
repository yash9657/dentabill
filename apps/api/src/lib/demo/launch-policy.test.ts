import { describe, expect, it } from 'vitest';

import {
  demoLaunchConfiguration,
  demoListenAddress,
  isolatedDemoWebEnvironment,
  DemoApiMessageSchema,
} from './launch-policy.js';

const actor = {
  organizationId: 'demo-org',
  userId: 'demo-user',
  clerkOrganizationId: 'org_demoLaunch',
  clerkUserId: 'user_demoLaunch',
};
const environment = {
  PATH: '/usr/bin:/bin',
  DATABASE_URL: 'postgresql://synthetic:synthetic@localhost/dentabill_demo_launch',
  NODE_ENV: 'development',
  NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
  NEXT_PUBLIC_API_URL: 'http://127.0.0.1:3001',
  INTERNAL_API_BASE_URL: 'http://127.0.0.1:3001',
  JOB_DISPATCH_MODE: 'inline',
  SUMMARY_ANALYSIS_PROVIDER: 'SYNTHETIC',
  SUMMARIZER_AUTO_TRANSITION_ENABLED: 'false',
  DEMO_AUTOPILOT: 'true',
  DEMO_IGNORE_PAYER_HOURS: 'true',
  DEMO_SUMMARIZER_FALLBACK: 'true',
  INTERNAL_JOB_SECRET: 'synthetic-internal-secret-never-real',
  DOB_HASH_SECRET: 'synthetic-dob-secret-never-real',
  CLERK_SECRET_KEY: 'sk_test_synthetic_not_real_1234567890',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from('synthetic-demo.clerk.accounts.dev$').toString('base64')}`,
};

describe('demo launch admission', () => {
  it('selects only web configuration, discards ambient overrides and excludes database/job secrets', () => {
    const web = isolatedDemoWebEnvironment(
      {
        ...environment,
        PORT: '9999',
        HTTPS_PROXY: 'private-canary',
        NODE_EXTRA_CA_CERTS: 'private-canary',
        NEXT_PRIVATE_DEV_DIR: 'private-canary',
        IS_TURBOPACK_TEST: '1',
        NEXT_PUBLIC_CLERK_SIGN_IN_URL: '//remote.invalid',
      },
      actor,
    );
    expect(web).toEqual({
      PATH: environment.PATH,
      NODE_ENV: 'development',
      NEXT_PUBLIC_APP_URL: environment.NEXT_PUBLIC_APP_URL,
      NEXT_PUBLIC_API_URL: environment.NEXT_PUBLIC_API_URL,
      CLERK_SECRET_KEY: environment.CLERK_SECRET_KEY,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      NEXT_TELEMETRY_DISABLED: '1',
      NEXT_PUBLIC_CLERK_SIGN_IN_URL: '/sign-in',
      NEXT_PUBLIC_CLERK_SIGN_UP_URL: '/sign-up',
      NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL: '/dashboard',
      NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL: '/dashboard',
    });
    expect(JSON.stringify(web)).not.toContain('private-canary');
    expect(web).not.toHaveProperty('DATABASE_URL');
  });

  it('refuses two aliases using the same port and retains original preflight admission', () => {
    expect(() =>
      demoLaunchConfiguration(
        { ...environment, NEXT_PUBLIC_APP_URL: 'http://localhost:3001' },
        actor,
      ),
    ).toThrow('DEMO_LAUNCH_PORTS_COLLIDE');
    expect(() =>
      demoLaunchConfiguration({ ...environment, NEXT_PUBLIC_APP_URL: 'http://localhost:0' }, actor),
    ).toThrow('DEMO_LOCAL_ORIGINS_REQUIRED');
    expect(() =>
      demoLaunchConfiguration({ ...environment, RETELL_API_KEY: 'private-canary' }, actor),
    ).toThrow('DEMO_EXTERNAL_CONFIGURATION');
    expect(demoLaunchConfiguration(environment, actor).databaseName).toBe('dentabill_demo_launch');
    expect(demoListenAddress('http://[::1]:4301')).toEqual({ host: '::1', port: 4301 });
  });

  it('rejects non-metadata IPC and never accepts authentication as verified', () => {
    expect(
      DemoApiMessageSchema.safeParse({
        type: 'demo-api-failed',
        launchId: 'bad',
        code: 'raw error private-canary',
      }).success,
    ).toBe(false);
    expect(
      DemoApiMessageSchema.safeParse({
        type: 'demo-api-failed',
        launchId: '82e348d5-7322-4d73-9b58-156339ef0632',
        code: 'DEMO_API_START_FAILED',
        secret: 'private-canary',
      }).success,
    ).toBe(false);
  });

  it.each(['http://127.0.0.1:3000', 'http://[::1]:3000'])(
    'refuses a web origin that triggers Next/Clerk self-proxy normalization: %s',
    (origin) => {
      expect(() =>
        demoLaunchConfiguration({ ...environment, NEXT_PUBLIC_APP_URL: origin }, actor),
      ).toThrow('DEMO_WEB_LOCALHOST_REQUIRED');
    },
  );
});
