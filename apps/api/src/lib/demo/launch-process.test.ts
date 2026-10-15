/* eslint-disable security/detect-non-literal-fs-filename -- All fixtures are owned temporary files. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { DemoLaunchError, DemoWebMessageSchema } from './launch-policy.js';
import { OwnedDemoProcess } from './launch-process.js';
import { demoWebEntrySource } from './launch-web-entry.js';

const directories: string[] = [];
const children: OwnedDemoProcess<unknown>[] = [];
const launchId = '82e348d5-7322-4d73-9b58-156339ef0632';

async function fixture(source: string): Promise<{ directory: string; entryPath: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'dentabill-launch-process-test-'));
  directories.push(directory);
  const entryPath = join(directory, 'entry.mjs');
  await writeFile(entryPath, source);
  return { directory, entryPath };
}

function child(input: {
  directory: string;
  entryPath: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  acceptMessage?: (raw: unknown) => unknown;
}): OwnedDemoProcess<unknown> {
  const process = new OwnedDemoProcess({
    ...input,
    environment: {},
    signal: input.signal ?? new AbortController().signal,
    timeoutMs: input.timeoutMs ?? 2000,
    acceptMessage: input.acceptMessage ?? ((raw) => (raw === 'ready' ? raw : undefined)),
  });
  children.push(process);
  return process;
}

afterEach(async () => {
  for (const process of children.splice(0)) expect((await process.stop()).stopped).toBe(true);
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe('owned demo process lifecycle', () => {
  it('waits for an admitted IPC message and stops only its owned child', async () => {
    const process = child(
      await fixture(
        "process.send({ secret: 'private-canary' }); process.send('ready'); setInterval(() => {}, 1000);",
      ),
    );
    expect(await process.ready).toBe('ready');
    expect(process.running).toBe(true);
    expect(await process.stop()).toEqual({ stopped: true, forced: false });
    expect(await process.stop()).toEqual({ stopped: true, forced: false });
    expect(process.running).toBe(false);
  });

  it('rejects startup exit and spawn failures without forwarding diagnostics', async () => {
    const exited = child(await fixture("console.error('private-canary'); process.exit(7);"));
    await expect(exited.ready).rejects.toThrow('DEMO_CHILD_EXITED');
    const missing = child({
      directory: '/definitely-missing-demo-directory',
      entryPath: '/definitely-missing-demo-entry.mjs',
    });
    await expect(missing.ready).rejects.toThrow('DEMO_CHILD_START_FAILED');
  });

  it('bounds startup and cancels pending startup', async () => {
    const stalled = child({ ...(await fixture('setInterval(() => {}, 1000);')), timeoutMs: 100 });
    await expect(stalled.ready).rejects.toThrow('DEMO_STARTUP_TIMEOUT');
    const controller = new AbortController();
    const aborted = child({
      ...(await fixture('setInterval(() => {}, 1000);')),
      signal: controller.signal,
    });
    controller.abort();
    await expect(aborted.ready).rejects.toThrow('DEMO_LAUNCH_CANCELLED');
  });

  it('terminates an owned descendant even after its leader exits', async () => {
    const process = child(
      await fixture(`
      import { spawn } from 'node:child_process';
      const descendant = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); process.send('ready'); setInterval(() => {}, 1000);"], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: {} });
      descendant.once('message', () => process.send('ready'));
      process.on('SIGTERM', () => process.exit(0));
    `),
    );
    await process.ready;
    expect(await process.stop()).toEqual({ stopped: true, forced: true });
  }, 15000);

  it('reports web readiness only after its own successful listen, preserving occupied servers', async () => {
    const occupied = createServer((_request, response) => response.end('unrelated-server'));
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));
    const address = occupied.address();
    if (!address || typeof address === 'string') throw new Error('TEST_ADDRESS');
    const appOrigin = `http://127.0.0.1:${String(address.port)}`;
    try {
      const files = await fixture('');
      const nextModulePath = join(files.directory, 'fake-next.cjs');
      await writeFile(
        nextModulePath,
        "module.exports = () => ({ prepare: async () => {}, close: async () => {}, getRequestHandler: () => (_req, res) => res.end('fake') });",
      );
      await writeFile(
        files.entryPath,
        demoWebEntrySource({ nextModulePath, appDirectory: files.directory, appOrigin, launchId }),
      );
      const process = child({
        ...files,
        acceptMessage: (raw) => {
          const message = DemoWebMessageSchema.parse(raw);
          if (message.type === 'demo-web-failed') throw new DemoLaunchError(message.code);
          return message;
        },
      });
      await expect(process.ready).rejects.toThrow('DEMO_WEB_START_FAILED');
      expect((await process.stop()).stopped).toBe(true);
      expect(await (await fetch(appOrigin)).text()).toBe('unrelated-server');
    } finally {
      occupied.closeAllConnections();
      await new Promise<void>((resolve) =>
        occupied.close(() => {
          resolve();
        }),
      );
    }
  });
});
