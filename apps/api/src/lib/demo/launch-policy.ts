import { z } from 'zod';

import {
  DemoPreflightCodeSchema,
  DemoPreflightReportSchema,
  isolatedDemoEnvironment,
  validateDemoConfiguration,
  type DemoPreflightConfiguration,
} from './preflight-policy.js';

export const DemoLaunchCodeSchema = z.enum([
  ...DemoPreflightCodeSchema.options,
  'DEMO_LAUNCH_PLATFORM_UNSUPPORTED',
  'DEMO_LAUNCH_PORTS_COLLIDE',
  'DEMO_WEB_LOCALHOST_REQUIRED',
  'DEMO_LAUNCH_CANCELLED',
  'DEMO_API_START_FAILED',
  'DEMO_API_AUTH_REQUIRED',
  'DEMO_API_IPC_REQUIRED',
  'DEMO_WEB_START_FAILED',
  'DEMO_ISOLATED_WEB_FAILED',
  'DEMO_CHILD_START_FAILED',
  'DEMO_CHILD_EXITED',
  'DEMO_STARTUP_TIMEOUT',
  'DEMO_READINESS_FAILED',
  'DEMO_API_READINESS_FAILED',
  'DEMO_WEB_READINESS_FAILED',
  'DEMO_CLEANUP_UNCONFIRMED',
  'DEMO_LAUNCH_FAILED',
]);
export type DemoLaunchCode = z.infer<typeof DemoLaunchCodeSchema>;

export class DemoLaunchError extends Error {
  public constructor(public readonly code: DemoLaunchCode) {
    super(code);
    this.name = 'DemoLaunchError';
  }
}

export const DemoApiMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('demo-api-ready'),
    launchId: z.uuid(),
    apiOrigin: z.string(),
    report: DemoPreflightReportSchema.options[0],
  }),
  z.strictObject({
    type: z.literal('demo-api-failed'),
    launchId: z.uuid(),
    code: DemoLaunchCodeSchema,
  }),
]);

export const DemoWebMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('demo-web-ready'),
    launchId: z.uuid(),
    appOrigin: z.string(),
  }),
  z.strictObject({
    type: z.literal('demo-web-failed'),
    launchId: z.uuid(),
    code: z.literal('DEMO_WEB_START_FAILED'),
  }),
]);

export function demoListenAddress(origin: string): { host: string; port: number } {
  const url = new URL(origin);
  return { host: url.hostname.replace(/^\[|\]$/g, ''), port: Number(url.port || '80') };
}

export function demoLaunchConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
  actor: unknown,
): DemoPreflightConfiguration {
  const configuration = validateDemoConfiguration(environment, actor);
  // Pinned Next normalizes loopback IPs to localhost. Clerk's same-request
  // rewrite otherwise becomes an external self-proxy in its custom server.
  if (new URL(configuration.appOrigin).hostname !== 'localhost') {
    throw new DemoLaunchError('DEMO_WEB_LOCALHOST_REQUIRED');
  }
  if (
    demoListenAddress(configuration.appOrigin).port < 1 ||
    demoListenAddress(configuration.apiOrigin).port < 1
  ) {
    throw new DemoLaunchError('DEMO_LOCAL_ORIGINS_REQUIRED');
  }
  if (
    demoListenAddress(configuration.appOrigin).port ===
    demoListenAddress(configuration.apiOrigin).port
  ) {
    throw new DemoLaunchError('DEMO_LAUNCH_PORTS_COLLIDE');
  }
  return configuration;
}

/** Next gets only browser/server authentication and local URL configuration. */
export function isolatedDemoWebEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  actor: unknown,
): Record<string, string> {
  const approved = isolatedDemoEnvironment(environment, actor);
  const selected: Record<string, string> = {};
  for (const key of [
    'PATH',
    'NODE_ENV',
    'NEXT_PUBLIC_APP_URL',
    'NEXT_PUBLIC_API_URL',
    'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
    'CLERK_SECRET_KEY',
  ]) {
    if (approved[key] !== undefined) selected[key] = approved[key];
  }
  selected.NEXT_TELEMETRY_DISABLED = '1';
  selected.NEXT_PUBLIC_CLERK_SIGN_IN_URL = '/sign-in';
  selected.NEXT_PUBLIC_CLERK_SIGN_UP_URL = '/sign-up';
  selected.NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL = '/dashboard';
  selected.NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL = '/dashboard';
  return selected;
}
