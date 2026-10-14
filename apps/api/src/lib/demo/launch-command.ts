/* eslint-disable security/detect-non-literal-fs-filename -- Writes only the bootstrap in the owned private web runtime. */
import { createHash, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseDemoActorArguments } from './command-cli.js';
import { prepareIsolatedDemoRuntime, type IsolatedDemoRuntime } from './isolated-runtime.js';
import { prepareIsolatedWebRuntime } from './isolated-web.js';
import {
  DemoApiMessageSchema,
  DemoLaunchCodeSchema,
  demoLaunchConfiguration,
  DemoLaunchError,
  DemoWebMessageSchema,
  isolatedDemoWebEnvironment,
  type DemoLaunchCode,
} from './launch-policy.js';
import { OwnedDemoProcess } from './launch-process.js';
import { demoWebEntrySource } from './launch-web-entry.js';
import { DemoPreflightError, isolatedDemoEnvironment } from './preflight-policy.js';

async function emit(report: Readonly<Record<string, unknown>>, failure = false): Promise<void> {
  const stream = failure ? process.stderr : process.stdout;
  await new Promise<void>((resolve, reject) => {
    const onError = (): void => {
      reject(new DemoLaunchError('DEMO_LAUNCH_FAILED'));
    };
    stream.once('error', onError);
    stream.write(JSON.stringify(report) + '\n', (error) => {
      if (error) reject(new DemoLaunchError('DEMO_LAUNCH_FAILED'));
      else {
        stream.removeListener('error', onError);
        resolve();
      }
    });
  });
}

async function verifyServices(
  apiOrigin: string,
  appOrigin: string,
  manifestSha256: string,
  signal: AbortSignal,
): Promise<void> {
  let failureCode: DemoLaunchCode = 'DEMO_API_READINESS_FAILED';
  try {
    const response = await fetch(apiOrigin + '/v1/readyz', {
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
    });
    const body: unknown = await response.json();
    if (
      !response.ok ||
      typeof body !== 'object' ||
      !body ||
      !('ready' in body) ||
      body.ready !== true
    )
      throw new Error();
    failureCode = 'DEMO_WEB_READINESS_FAILED';
    const manifest = await fetch(appOrigin + '/examples/demo/manifest.json', {
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(120000)]),
    });
    if (!manifest.ok || !manifest.body) throw new Error();
    const reader = manifest.body.getReader();
    const digest = createHash('sha256');
    let size = 0;
    try {
      for (;;) {
        const result = await reader.read();
        if (result.done) break;
        const chunk: unknown = result.value;
        if (!(chunk instanceof Uint8Array)) throw new Error();
        size += chunk.byteLength;
        if (size > 65536) throw new Error();
        digest.update(chunk);
      }
    } finally {
      await reader.cancel();
    }
    if (digest.digest('hex') !== manifestSha256) throw new Error();
  } catch {
    throw new DemoLaunchError(signal.aborted ? 'DEMO_LAUNCH_CANCELLED' : failureCode);
  }
}

export async function runDemoLauncher(scriptUrl: string): Promise<void> {
  const launchId = randomUUID();
  const controller = new AbortController();
  let apiRuntime: IsolatedDemoRuntime | undefined;
  let webRuntime: Awaited<ReturnType<typeof prepareIsolatedWebRuntime>> | undefined;
  const processes: OwnedDemoProcess<unknown>[] = [];
  let stopping = false;
  let unexpectedExit = false;
  const exitedUnexpectedly = (): boolean => unexpectedExit;
  let failure: DemoLaunchCode | undefined;
  const stopRequested = (): void => {
    controller.abort();
  };
  process.on('SIGINT', stopRequested);
  process.on('SIGTERM', stopRequested);
  const cancelled = new Promise<void>((resolve) => {
    controller.signal.addEventListener(
      'abort',
      () => {
        resolve();
      },
      { once: true },
    );
  });
  const assertActive = (): void => {
    if (controller.signal.aborted) throw new DemoLaunchError('DEMO_LAUNCH_CANCELLED');
  };
  const track = <T>(child: OwnedDemoProcess<T>): OwnedDemoProcess<T> => {
    processes.push(child);
    void child.done.then(() => {
      if (!stopping) {
        unexpectedExit = true;
        controller.abort();
      }
    });
    return child;
  };
  try {
    const { actor, help } = parseDemoActorArguments();
    if (help) {
      process.stdout.write(
        'Isolated synthetic demo launcher. See DEMO.md for configuration.\nUsage: demo-launch --organization-id ID --user-id ID --clerk-organization-id org_ID --clerk-user-id user_ID\n',
      );
      return;
    }
    const environment = { ...process.env };
    const configuration = demoLaunchConfiguration(environment, actor);
    const apiEnvironment = isolatedDemoEnvironment(environment, configuration.actor);
    const webEnvironment = isolatedDemoWebEnvironment(environment, configuration.actor);
    if (!['darwin', 'linux'].includes(process.platform))
      throw new DemoLaunchError('DEMO_LAUNCH_PLATFORM_UNSUPPORTED');
    const projectRoot = fileURLToPath(new URL('../../../', scriptUrl));
    await emit({ status: 'STARTING', launchId, phase: 'API_PREFLIGHT' });
    apiRuntime = await prepareIsolatedDemoRuntime({
      projectRoot,
      environment: apiEnvironment,
      entrySource: `import { runDemoApi } from ${JSON.stringify(join(projectRoot, 'apps/api/src/lib/demo/launch-api.ts'))};\nawait runDemoApi(${JSON.stringify({ projectRoot, actor: configuration.actor, launchId })});`,
    });
    assertActive();
    const api = track(
      new OwnedDemoProcess({
        ...apiRuntime,
        environment: apiEnvironment,
        signal: controller.signal,
        timeoutMs: 90000,
        acceptMessage: (raw) => {
          const parsed = DemoApiMessageSchema.safeParse(raw);
          if (!parsed.success || parsed.data.launchId !== launchId) return undefined;
          if (parsed.data.type === 'demo-api-failed') throw new DemoLaunchError(parsed.data.code);
          if (parsed.data.apiOrigin !== configuration.apiOrigin)
            throw new DemoLaunchError('DEMO_READINESS_FAILED');
          return parsed.data;
        },
      }),
    );
    const apiReady = await api.ready;
    assertActive();
    await emit({ status: 'STARTING', launchId, phase: 'WEB_PREPARE' });
    webRuntime = await prepareIsolatedWebRuntime({
      projectRoot,
      expectedManifestSha256: apiReady.report.manifestSha256,
    });
    const webEntry = join(webRuntime.directory, 'web-entry.mjs');
    await writeFile(
      webEntry,
      demoWebEntrySource({
        nextModulePath: webRuntime.nextModulePath,
        appDirectory: webRuntime.appDirectory,
        appOrigin: configuration.appOrigin,
        launchId,
      }),
      { flag: 'wx', mode: 0o600 },
    );
    assertActive();
    const web = track(
      new OwnedDemoProcess({
        entryPath: webEntry,
        directory: webRuntime.appDirectory,
        environment: webEnvironment,
        signal: controller.signal,
        timeoutMs: 180000,
        acceptMessage: (raw) => {
          const parsed = DemoWebMessageSchema.safeParse(raw);
          if (!parsed.success || parsed.data.launchId !== launchId) return undefined;
          if (parsed.data.type === 'demo-web-failed') throw new DemoLaunchError(parsed.data.code);
          if (parsed.data.appOrigin !== configuration.appOrigin)
            throw new DemoLaunchError('DEMO_READINESS_FAILED');
          return parsed.data;
        },
      }),
    );
    await web.ready;
    assertActive();
    await emit({ status: 'STARTING', launchId, phase: 'SERVICE_PROBES' });
    await verifyServices(
      configuration.apiOrigin,
      configuration.appOrigin,
      apiReady.report.manifestSha256,
      controller.signal,
    );
    assertActive();
    if (!api.running || !web.running) throw new DemoLaunchError('DEMO_CHILD_EXITED');
    await emit({
      status: 'SERVICES_RUNNING',
      launchId,
      appOrigin: configuration.appOrigin,
      apiOrigin: configuration.apiOrigin,
      databaseName: configuration.databaseName,
      manifestSha256: apiReady.report.manifestSha256,
      migrationCount: apiReady.report.migrationCount,
      actorRole: apiReady.report.actorRole,
      providerMode: 'SYNTHETIC',
      authentication: 'NOT_VERIFIED',
      authenticatedRehearsal: 'NOT_VERIFIED',
      recording: 'NOT_VERIFIED',
    });
    await cancelled;
    if (exitedUnexpectedly()) throw new DemoLaunchError('DEMO_CHILD_EXITED');
  } catch (error: unknown) {
    const code =
      error instanceof DemoLaunchError || error instanceof DemoPreflightError
        ? error.code
        : typeof error === 'object' && error && 'code' in error
          ? error.code
          : undefined;
    failure = DemoLaunchCodeSchema.safeParse(code).success
      ? (code as DemoLaunchCode)
      : 'DEMO_LAUNCH_FAILED';
    if (failure === 'DEMO_LAUNCH_CANCELLED' && exitedUnexpectedly()) failure = 'DEMO_CHILD_EXITED';
    else if (failure === 'DEMO_LAUNCH_CANCELLED') failure = undefined;
  } finally {
    stopping = true;
    let stopped = true;
    let forced = false;
    for (const child of [...processes].reverse()) {
      const result = await child.stop();
      stopped &&= result.stopped;
      forced ||= result.forced;
    }
    if (stopped) {
      for (const runtime of [webRuntime, apiRuntime]) {
        try {
          await runtime?.dispose();
        } catch {
          failure = 'DEMO_CLEANUP_UNCONFIRMED';
        }
      }
    } else failure = 'DEMO_CLEANUP_UNCONFIRMED';
    process.removeListener('SIGINT', stopRequested);
    process.removeListener('SIGTERM', stopRequested);
    if (apiRuntime || webRuntime || failure) {
      await emit(
        failure
          ? {
              status: 'LAUNCH_FAILED',
              launchId,
              code: failure,
              database: 'PRESERVED',
              processesStopped: stopped,
            }
          : {
              status: 'STOPPED',
              launchId,
              database: 'PRESERVED',
              processesStopped: stopped,
              forcedBySupervisor: forced,
            },
        Boolean(failure),
      ).catch(() => {
        failure = 'DEMO_LAUNCH_FAILED';
      });
    }
    process.exitCode = failure ? 1 : 0;
  }
}
