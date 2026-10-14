import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

import { DemoLaunchError } from './launch-policy.js';

export interface DemoProcessExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

/** Only the detached group created by this object is ever signalled. */
export class OwnedDemoProcess<T> {
  public readonly ready: Promise<T>;
  public readonly done: Promise<DemoProcessExit>;
  private readonly child: ChildProcess;
  private stopPromise: Promise<{ stopped: boolean; forced: boolean }> | undefined;
  private exited = false;

  public constructor(input: {
    entryPath: string;
    directory: string;
    environment: Readonly<Record<string, string>>;
    acceptMessage: (message: unknown) => T | undefined;
    signal: AbortSignal;
    timeoutMs: number;
  }) {
    if (!['darwin', 'linux'].includes(process.platform)) {
      throw new DemoLaunchError('DEMO_LAUNCH_PLATFORM_UNSUPPORTED');
    }
    if (input.signal.aborted) throw new DemoLaunchError('DEMO_LAUNCH_CANCELLED');
    this.child = spawn(process.execPath, ['--no-warnings', input.entryPath], {
      cwd: input.directory,
      env: { ...input.environment },
      detached: true,
      shell: false,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    this.done = new Promise((resolve) => {
      this.child.once('exit', (code, signal) => {
        this.exited = true;
        resolve({ code, signal });
      });
      this.child.once('error', () => {
        this.exited = true;
        resolve({ code: null, signal: null });
      });
    });
    this.ready = new Promise((resolve, reject) => {
      const finish = (error?: Error, message?: T): void => {
        clearTimeout(timeout);
        input.signal.removeEventListener('abort', onAbort);
        this.child.removeListener('message', onMessage);
        this.child.removeListener('error', onError);
        this.child.removeListener('exit', onExit);
        if (error) reject(error);
        else resolve(message as T);
      };
      const onAbort = (): void => {
        finish(new DemoLaunchError('DEMO_LAUNCH_CANCELLED'));
      };
      const onError = (): void => {
        finish(new DemoLaunchError('DEMO_CHILD_START_FAILED'));
      };
      const onExit = (): void => {
        finish(new DemoLaunchError('DEMO_CHILD_EXITED'));
      };
      const onMessage = (raw: unknown): void => {
        try {
          const message = input.acceptMessage(raw);
          if (message !== undefined) finish(undefined, message);
        } catch (error: unknown) {
          finish(error instanceof Error ? error : new DemoLaunchError('DEMO_CHILD_START_FAILED'));
        }
      };
      const timeout = setTimeout(() => {
        finish(new DemoLaunchError('DEMO_STARTUP_TIMEOUT'));
      }, input.timeoutMs);
      input.signal.addEventListener('abort', onAbort, { once: true });
      this.child.on('message', onMessage);
      this.child.once('error', onError);
      this.child.once('exit', onExit);
    });
    // A caller may be preparing another resource when its owned child exits.
    void this.ready.catch(() => undefined);
  }

  public get running(): boolean {
    return !this.exited;
  }

  private groupExists(): boolean {
    if (!this.child.pid) return false;
    try {
      process.kill(-this.child.pid, 0);
      return true;
    } catch (error: unknown) {
      return !(error instanceof Error && 'code' in error && error.code === 'ESRCH');
    }
  }

  private signalGroup(signal: NodeJS.Signals): void {
    if (!this.child.pid) return;
    try {
      process.kill(-this.child.pid, signal);
    } catch {
      // Disappearance is checked independently; a denied signal is never called a successful stop.
    }
  }

  public stop(): Promise<{ stopped: boolean; forced: boolean }> {
    this.stopPromise ??= this.stopGroup();
    return this.stopPromise;
  }

  private async stopGroup(): Promise<{ stopped: boolean; forced: boolean }> {
    this.signalGroup('SIGTERM');
    const gracefulDeadline = Date.now() + 6000;
    while (this.groupExists() && Date.now() < gracefulDeadline) await delay(50);
    const forced = this.groupExists();
    if (forced) this.signalGroup('SIGKILL');
    const forceDeadline = Date.now() + 3000;
    while (this.groupExists() && Date.now() < forceDeadline) await delay(50);
    const stopped = !this.groupExists();
    if (stopped && this.child.connected) {
      try {
        this.child.disconnect();
      } catch {
        // The confirmed-dead child's channel may already have closed.
      }
    }
    return { stopped, forced };
  }
}
