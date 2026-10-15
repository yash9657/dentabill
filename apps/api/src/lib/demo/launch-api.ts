import type { FastifyInstance } from 'fastify';

import { runDemoPreflight } from './preflight-command.js';
import {
  DemoPreflightError,
  DemoPreflightReportSchema,
  isolatedDemoEnvironment,
  validateDemoConfiguration,
  type DemoActorInput,
  type DemoPreflightCode,
  type DemoPreflightReport,
} from './preflight-policy.js';

export type DemoApiFailureCode =
  | DemoPreflightCode
  | 'DEMO_API_START_FAILED'
  | 'DEMO_API_AUTH_REQUIRED'
  | 'DEMO_API_IPC_REQUIRED';

export type DemoApiMessage =
  | {
      readonly type: 'demo-api-ready';
      readonly launchId: string;
      readonly report: Extract<DemoPreflightReport, { status: 'PREFLIGHT_PASSED' }>;
      readonly apiOrigin: string;
    }
  | {
      readonly type: 'demo-api-failed';
      readonly launchId: string;
      readonly code: DemoApiFailureCode;
    };

export interface RunDemoApiInput {
  readonly projectRoot: string;
  readonly actor: DemoActorInput;
  readonly launchId: string;
}

function hasIpc(): boolean {
  return process.connected && typeof process.send === 'function';
}

async function send(message: DemoApiMessage): Promise<void> {
  if (!hasIpc()) throw new Error('DEMO_API_IPC_REQUIRED');
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('DEMO_API_IPC_REQUIRED'));
    }, 2000);
    try {
      process.send?.(message, (error: Error | null) => {
        clearTimeout(timer);
        if (error) reject(new Error('DEMO_API_IPC_REQUIRED'));
        else resolve();
      });
    } catch {
      clearTimeout(timer);
      reject(new Error('DEMO_API_IPC_REQUIRED'));
    }
  });
}

/** Trusted private child entry. Resolves after shutdown, never authenticates a demo user. */
export async function runDemoApi(input: RunDemoApiInput): Promise<void> {
  const environment = Object.freeze({ ...process.env });
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
      input.launchId,
    ) ||
    !hasIpc()
  ) {
    process.exitCode = 1;
    return;
  }

  let server: FastifyInstance | undefined;
  let disconnectDatabase: (() => Promise<void>) | undefined;
  let stopping = false;
  // Signal listeners can change lifecycle state across every awaited startup step.
  const isStopping = (): boolean => stopping;
  let shutdownCode = 0;
  let resolveStop: (() => void) | undefined;
  const stopped = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });
  let shutdownTimer: NodeJS.Timeout | undefined;
  const stop = (code: number): void => {
    shutdownCode = Math.max(shutdownCode, code);
    if (isStopping()) return;
    stopping = true;
    // A stalled startup, SSE client, or background job cannot keep an orphan child alive.
    // The unreferenced watchdog also remains after cleanup until the process naturally exits.
    shutdownTimer = setTimeout(() => {
      process.exit(1);
    }, 5000);
    shutdownTimer.unref();
    resolveStop?.();
  };
  const onSignal = (): void => {
    stop(0);
  };
  const onDisconnect = (): void => {
    stop(0);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  process.on('disconnect', onDisconnect);

  let failureCode: DemoApiFailureCode = 'DEMO_API_START_FAILED';
  try {
    const configuration = validateDemoConfiguration(environment, input.actor);
    const approvedEnvironment = isolatedDemoEnvironment(environment, configuration.actor);
    const origin = new URL(configuration.apiOrigin);
    const port = Number(origin.port || '80');
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new DemoPreflightError('DEMO_LOCAL_ORIGINS_REQUIRED');
    }
    const report = DemoPreflightReportSchema.parse(
      await runDemoPreflight(input.projectRoot, environment, configuration.actor),
    );
    if (isStopping()) return;
    if (report.status !== 'PREFLIGHT_PASSED') {
      throw new DemoPreflightError(report.code);
    }

    // This is a dedicated private child: application imports must receive precisely
    // the approved snapshot, even if a preflight dependency altered process.env.
    process.env = { ...approvedEnvironment, PORT: String(port) };
    const { initEnv } = await import('../env.js');
    initEnv();
    if (isStopping()) return;
    const { prisma } = await import('@dentabill/db');
    disconnectDatabase = () => prisma.$disconnect();
    const { buildServer } = await import('../../app.js');
    if (isStopping()) return;
    server = await buildServer({ logger: false });
    if (isStopping()) return;
    if (!server.auth.hasClerkKeys) {
      failureCode = 'DEMO_API_AUTH_REQUIRED';
      throw new Error();
    }
    await server.listen({ port, host: origin.hostname.replace(/^\[|\]$/g, '') });
    if (isStopping()) return;
    failureCode = 'DEMO_API_IPC_REQUIRED';
    await send({
      type: 'demo-api-ready',
      launchId: input.launchId,
      report,
      apiOrigin: configuration.apiOrigin,
    });
    await stopped;
  } catch (error: unknown) {
    if (!isStopping()) {
      const code = error instanceof DemoPreflightError ? error.code : failureCode;
      try {
        await send({ type: 'demo-api-failed', launchId: input.launchId, code });
      } catch {
        /* A missing parent cannot receive a diagnostic. */
      }
      stop(1);
    }
  } finally {
    stop(shutdownCode);
    try {
      await server?.close();
    } catch {
      shutdownCode = 1;
    }
    try {
      await disconnectDatabase?.();
    } catch {
      shutdownCode = 1;
    }
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    process.removeListener('disconnect', onDisconnect);
    process.exitCode = shutdownCode;
    if (hasIpc()) {
      try {
        process.disconnect();
      } catch {
        process.exitCode = 1;
      }
    }
    // Keep the watchdog only as an unreferenced fallback for leaked/background handles.
    shutdownTimer?.unref();
  }
}
