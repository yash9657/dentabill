import { randomUUID } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DemoApiMessage } from './launch-api.js';
import { runDemoApi } from './launch-api.js';

const mocks = vi.hoisted(() => ({
  preflight: vi.fn(),
  initEnv: vi.fn(),
  buildServer: vi.fn(),
  disconnect: vi.fn(),
}));
vi.mock('./preflight-command.js', () => ({ runDemoPreflight: mocks.preflight }));
vi.mock('../env.js', () => ({ initEnv: mocks.initEnv }));
vi.mock('../../app.js', () => ({ buildServer: mocks.buildServer }));
vi.mock('@dentabill/db', () => ({ prisma: { $disconnect: mocks.disconnect } }));

const actor = {
  organizationId: 'demo-org-launch',
  userId: 'demo-user-launch',
  clerkOrganizationId: 'org_demoLaunch',
  clerkUserId: 'user_demoLaunch',
};
const passed = {
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
const environment = {
  DATABASE_URL: 'postgresql://synthetic:synthetic@127.0.0.1:1/dentabill_demo_launch',
  NEXT_PUBLIC_APP_URL: 'http://127.0.0.1:3000',
  NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4321',
  INTERNAL_API_BASE_URL: 'http://127.0.0.1:4321',
  NODE_ENV: 'development',
  JOB_DISPATCH_MODE: 'inline',
  SUMMARY_ANALYSIS_PROVIDER: 'SYNTHETIC',
  SUMMARIZER_AUTO_TRANSITION_ENABLED: 'false',
  DEMO_AUTOPILOT: 'true',
  DEMO_IGNORE_PAYER_HOURS: 'true',
  DEMO_SUMMARIZER_FALLBACK: 'true',
  INTERNAL_JOB_SECRET: 'synthetic-internal-secret-not-real-32',
  DOB_HASH_SECRET: 'synthetic-dob-secret-not-real',
  CLERK_SECRET_KEY: 'sk_test_synthetic_not_real_1234567890',
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${Buffer.from('synthetic-demo.clerk.accounts.dev$').toString('base64')}`,
};

const server = { auth: { hasClerkKeys: true }, listen: vi.fn(), close: vi.fn() };
let originalEnvironment: NodeJS.ProcessEnv;
let originalExitCode: typeof process.exitCode;
let descriptors: Record<string, PropertyDescriptor | undefined>;
const shutdownEvents = ['SIGINT', 'SIGTERM', 'disconnect'] as const;
type ShutdownEvent = (typeof shutdownEvents)[number];
type ShutdownListener = NodeJS.SignalsListener | NodeJS.DisconnectListener;
let initialListeners: Record<string, ShutdownListener[]>;
let messages: DemoApiMessage[];
const ipc = vi.fn((_message: DemoApiMessage, callback: (error: Error | null) => void) => {
  callback(null);
  return true;
});
const disconnect = vi.fn(() => {
  Object.defineProperty(process, 'connected', { value: false, configurable: true });
});

function lifecycleListeners(event: ShutdownEvent): ShutdownListener[] {
  return event === 'disconnect' ? process.listeners('disconnect') : process.listeners(event);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  originalEnvironment = process.env;
  originalExitCode = process.exitCode;
  process.env = { ...environment };
  descriptors = Object.fromEntries(
    ['send', 'connected', 'disconnect'].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(process, key),
    ]),
  );
  Object.defineProperty(process, 'send', { value: ipc, configurable: true });
  Object.defineProperty(process, 'connected', { value: true, configurable: true });
  Object.defineProperty(process, 'disconnect', { value: disconnect, configurable: true });
  initialListeners = Object.fromEntries(
    shutdownEvents.map((event) => [event, lifecycleListeners(event)]),
  );
  messages = [];
  ipc.mockImplementation((message, callback) => {
    messages.push(message);
    callback(null);
    return true;
  });
  mocks.preflight.mockResolvedValue(passed);
  mocks.buildServer.mockResolvedValue(server);
  mocks.disconnect.mockResolvedValue(undefined);
  mocks.initEnv.mockReturnValue({});
  server.auth.hasClerkKeys = true;
  server.listen.mockResolvedValue('http://127.0.0.1:4321');
  server.close.mockResolvedValue(undefined);
});

afterEach(() => {
  for (const event of shutdownEvents) {
    expect(lifecycleListeners(event)).toEqual(initialListeners[event]);
  }
  for (const key of ['send', 'connected', 'disconnect']) {
    const descriptor = descriptors[key];
    if (descriptor) Object.defineProperty(process, key, descriptor);
    else Reflect.deleteProperty(process, key);
  }
  process.env = originalEnvironment;
  process.exitCode = originalExitCode;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function signal(event: ShutdownEvent): void {
  if (event === 'disconnect')
    Object.defineProperty(process, 'connected', { value: false, configurable: true });
  const handler = lifecycleListeners(event).find(
    (listener) => !initialListeners[event]?.includes(listener),
  );
  if (!handler) throw new Error('DEMO_API_TEST_LISTENER_MISSING');
  Reflect.apply(handler, process, event === 'disconnect' ? [] : [event]);
}

function start(): { launchId: string; running: Promise<void> } {
  const launchId = randomUUID();
  return { launchId, running: runDemoApi({ projectRoot: '/synthetic/project', actor, launchId }) };
}

async function ready(): Promise<void> {
  await vi.waitFor(() => {
    expect(messages).toHaveLength(1);
  });
  expect(messages[0]?.type).toBe('demo-api-ready');
}

describe('isolated demo API lifecycle', () => {
  it.each(['SIGINT', 'SIGTERM', 'disconnect'] as const)(
    'preflights the captured actor/env, requires real Clerk mode and drains on %s',
    async (event) => {
      const { launchId, running } = start();
      await ready();
      expect(mocks.preflight).toHaveBeenCalledWith('/synthetic/project', environment, actor);
      expect(Object.isFrozen(mocks.preflight.mock.calls[0]?.[1])).toBe(true);
      expect(mocks.initEnv).toHaveBeenCalledOnce();
      expect(process.env.PORT).toBe('4321');
      expect(mocks.buildServer).toHaveBeenCalledWith({ logger: false });
      expect(server.listen).toHaveBeenCalledWith({ port: 4321, host: '127.0.0.1' });
      expect(messages).toEqual([
        { type: 'demo-api-ready', launchId, report: passed, apiOrigin: 'http://127.0.0.1:4321' },
      ]);
      signal(event);
      await running;
      expect(server.close).toHaveBeenCalledOnce();
      expect(mocks.disconnect).toHaveBeenCalledOnce();
      expect(server.close.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.disconnect.mock.invocationCallOrder[0]!,
      );
      expect(process.exitCode).toBe(0);
    },
  );

  it.each([
    ['http://[::1]:4401', '::1', 4401],
    ['http://localhost:4402', 'localhost', 4402],
    ['http://127.0.0.1', '127.0.0.1', 80],
  ] as const)('derives the precise loopback listener from %s', async (origin, host, port) => {
    process.env.NEXT_PUBLIC_API_URL = origin;
    process.env.INTERNAL_API_BASE_URL = origin;
    process.env.PORT = '9999';
    const { running } = start();
    await ready();
    expect(server.listen).toHaveBeenCalledWith({ port, host });
    expect(process.env.PORT).toBe(String(port));
    signal('SIGTERM');
    await running;
  });

  it('reapplies the exact approved environment before app imports after preflight mutations', async () => {
    mocks.preflight.mockImplementation(() => {
      process.env.DATABASE_URL = 'postgresql://synthetic:synthetic@example.invalid/changed';
      process.env.RETELL_API_KEY = 'SYNTHETIC_FORBIDDEN_PROVIDER_CANARY';
      process.env.REDIS_URL = 'redis://example.invalid:6379';
      process.env.PORT = '9999';
      delete process.env.CLERK_SECRET_KEY;
      return Promise.resolve(passed);
    });
    let initializedEnvironment: NodeJS.ProcessEnv | undefined;
    mocks.initEnv.mockImplementation(() => {
      initializedEnvironment = { ...process.env };
      return {};
    });
    const { running } = start();
    await ready();
    expect(initializedEnvironment).toEqual({ ...environment, PORT: '4321' });
    expect(process.env).toEqual(initializedEnvironment);
    expect(mocks.preflight).toHaveBeenCalledWith('/synthetic/project', environment, actor);
    expect(JSON.stringify(messages)).not.toContain('SYNTHETIC_FORBIDDEN_PROVIDER_CANARY');
    signal('SIGTERM');
    await running;
  });

  it.each([
    ['RETELL_API_KEY', 'synthetic-forbidden-key', 'DEMO_EXTERNAL_CONFIGURATION'],
    ['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY', '', 'DEMO_CLERK_TEST_CONFIGURATION_REQUIRED'],
    ['NEXT_PUBLIC_API_URL', 'http://0.0.0.0:4321', 'DEMO_LOCAL_ORIGINS_REQUIRED'],
    ['NODE_ENV', 'test', 'DEMO_SYNTHETIC_MODE_REQUIRED'],
  ])(
    'refuses unsafe configuration %s before preflight or app imports',
    async (key, value, code) => {
      process.env[key] = value;
      const { launchId, running } = start();
      await running;
      expect(messages).toEqual([{ type: 'demo-api-failed', launchId, code }]);
      expect(mocks.preflight).not.toHaveBeenCalled();
      expect(mocks.initEnv).not.toHaveBeenCalled();
      expect(mocks.buildServer).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    },
  );

  it('never listens when the current database preflight fails', async () => {
    mocks.preflight.mockResolvedValue({
      status: 'PREFLIGHT_FAILED',
      code: 'DEMO_ACTOR_BINDING_MISMATCH',
    });
    const { launchId, running } = start();
    await running;
    expect(messages).toEqual([
      { type: 'demo-api-failed', launchId, code: 'DEMO_ACTOR_BINDING_MISMATCH' },
    ]);
    expect(mocks.initEnv).not.toHaveBeenCalled();
    expect(server.listen).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('refuses the test header authentication path even after successful preflight', async () => {
    server.auth.hasClerkKeys = false;
    const { launchId, running } = start();
    await running;
    expect(messages).toEqual([
      { type: 'demo-api-failed', launchId, code: 'DEMO_API_AUTH_REQUIRED' },
    ]);
    expect(server.listen).not.toHaveBeenCalled();
    expect(server.close).toHaveBeenCalledOnce();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });

  it('does not listen or report readiness if its parent disconnects during preflight', async () => {
    let complete: ((report: typeof passed) => void) | undefined;
    mocks.preflight.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const { running } = start();
    signal('disconnect');
    complete?.(passed);
    await running;
    expect(messages).toEqual([]);
    expect(server.listen).not.toHaveBeenCalled();
    expect(mocks.buildServer).not.toHaveBeenCalled();
  });

  it('closes a server whose construction finishes after shutdown was requested', async () => {
    let complete: ((built: typeof server) => void) | undefined;
    mocks.buildServer.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const { running } = start();
    await vi.waitFor(() => {
      expect(mocks.buildServer).toHaveBeenCalledOnce();
    });
    signal('SIGTERM');
    complete?.(server);
    await running;
    expect(messages).toEqual([]);
    expect(server.listen).not.toHaveBeenCalled();
    expect(server.close).toHaveBeenCalledOnce();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });

  it('emits only a fixed failure code for private startup errors', async () => {
    server.listen.mockRejectedValue(new Error('SYNTHETIC_PRIVATE_STARTUP_CANARY'));
    const { launchId, running } = start();
    await running;
    expect(messages).toEqual([
      { type: 'demo-api-failed', launchId, code: 'DEMO_API_START_FAILED' },
    ]);
    expect(JSON.stringify(messages)).not.toContain('SYNTHETIC_PRIVATE_STARTUP_CANARY');
    expect(server.close).toHaveBeenCalledOnce();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });

  it('refuses missing IPC before importing or starting the server', async () => {
    Object.defineProperty(process, 'connected', { value: false, configurable: true });
    await start().running;
    expect(messages).toEqual([]);
    expect(mocks.preflight).not.toHaveBeenCalled();
    expect(mocks.buildServer).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it('closes its listener if readiness cannot reach the parent', async () => {
    ipc.mockImplementation((_message, callback) => {
      callback(new Error('PRIVATE_IPC_CANARY'));
      return false;
    });
    await start().running;
    expect(server.close).toHaveBeenCalledOnce();
    expect(mocks.disconnect).toHaveBeenCalledOnce();
    expect(process.exitCode).toBe(1);
  });

  it('forces a bounded exit when graceful server shutdown stalls', async () => {
    let finishClose: (() => void) | undefined;
    server.close.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishClose = resolve;
        }),
    );
    const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const { running } = start();
    await ready();
    signal('SIGTERM');
    await vi.advanceTimersByTimeAsync(5000);
    expect(exit).toHaveBeenCalledWith(1);
    finishClose?.();
    await running;
    expect(mocks.disconnect).toHaveBeenCalledOnce();
  });
});
