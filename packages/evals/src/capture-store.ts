/* eslint-disable security/detect-non-literal-fs-filename -- Private local capture directories and a fixed record-name allowlist; never server-controlled paths. */
import { randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { link, lstat, mkdir, open, realpath, unlink, type FileHandle } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { canonicalJson } from './contracts.js';

const MAX_BYTES = 16 * 1024 * 1024;
const FIXED_NAMES = new Set([
  'manifest.json',
  'authorization.json',
  'corpus.json',
  'capture-report.json',
]);
const CASE_NAME = /^case-[a-f0-9]{64}-(admission|response|attempt|result)\.json$/;

export const CAPTURE_STORE_ERROR_CODES = [
  'INVALID_PATH',
  'INVALID_RECORD_NAME',
  'DIRECTORY_EXISTS',
  'UNSAFE_DIRECTORY',
  'UNSAFE_FILE',
  'MISSING_MANIFEST',
  'INVALID_RECORD',
  'RECORD_TOO_LARGE',
  'IO_ERROR',
] as const;

export class CaptureStoreError extends Error {
  constructor(readonly code: (typeof CAPTURE_STORE_ERROR_CODES)[number]) {
    super(code);
    this.name = 'CaptureStoreError';
  }
}

function fail(code: CaptureStoreError['code']): never {
  throw new CaptureStoreError(code);
}

function fsCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function closed(error: unknown): CaptureStoreError {
  return error instanceof CaptureStoreError ? error : new CaptureStoreError('IO_ERROR');
}

function recordName(name: string): void {
  if (typeof name !== 'string' || (!FIXED_NAMES.has(name) && !CASE_NAME.test(name)))
    fail('INVALID_RECORD_NAME');
}

function privateMode(info: Stats, expected: number): boolean {
  return (
    (info.mode & 0o777) === expected &&
    (typeof process.getuid !== 'function' || info.uid === process.getuid())
  );
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function fileInfo(info: Stats): void {
  if (!info.isFile() || !privateMode(info, 0o600)) fail('UNSAFE_FILE');
  if (info.size > MAX_BYTES) fail('RECORD_TOO_LARGE');
}

function serialize(value: unknown): string {
  if (value === null) fail('INVALID_RECORD');
  let text: string;
  try {
    text = `${canonicalJson(value)}\n`;
  } catch {
    return fail('INVALID_RECORD');
  }
  if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) fail('RECORD_TOO_LARGE');
  return text;
}

function absolutePath(directory: string): string {
  if (typeof directory !== 'string' || !isAbsolute(directory) || directory.includes('\0'))
    fail('INVALID_PATH');
  return resolve(directory);
}

async function syncDirectory(directory: string, expected?: Stats): Promise<void> {
  const handle = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const current = await handle.stat();
    if (!current.isDirectory() || (expected && !sameFile(current, expected)))
      fail('UNSAFE_DIRECTORY');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readBounded(handle: FileHandle): Promise<string> {
  const chunks: Buffer[] = [];
  let length = 0;
  for (;;) {
    const chunk = Buffer.alloc(Math.min(64 * 1024, MAX_BYTES - length + 1));
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
    if (bytesRead === 0) break;
    length += bytesRead;
    if (length > MAX_BYTES) fail('RECORD_TOO_LARGE');
    chunks.push(chunk.subarray(0, bytesRead));
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, length));
  } catch {
    return fail('INVALID_RECORD');
  }
}

/** Immutable local records; a failed write may have published and must be reread. */
export class CaptureStore {
  private constructor(
    readonly directory: string,
    private readonly identity: Stats,
  ) {}

  private static async inspect(directory: string): Promise<CaptureStore> {
    const requested = absolutePath(directory);
    const info = await lstat(requested);
    if (!info.isDirectory() || !privateMode(info, 0o700)) fail('UNSAFE_DIRECTORY');
    const canonical = await realpath(requested);
    const resolvedInfo = await lstat(canonical);
    if (!sameFile(info, resolvedInfo)) fail('UNSAFE_DIRECTORY');
    return new CaptureStore(canonical, resolvedInfo);
  }

  static async create(directory: string, manifest: unknown): Promise<CaptureStore> {
    try {
      serialize(manifest);
      const requested = absolutePath(directory);
      const parent = await realpath(dirname(requested));
      const canonical = join(parent, basename(requested));
      try {
        await mkdir(canonical, { mode: 0o700 });
      } catch (error: unknown) {
        if (fsCode(error) === 'EEXIST') fail('DIRECTORY_EXISTS');
        throw error;
      }
      await syncDirectory(parent);
      const store = await CaptureStore.inspect(canonical);
      if (!(await store.create('manifest.json', manifest))) fail('DIRECTORY_EXISTS');
      return store;
    } catch (error: unknown) {
      throw closed(error);
    }
  }

  static async open(directory: string): Promise<CaptureStore> {
    try {
      const store = await CaptureStore.inspect(directory);
      if ((await store.read('manifest.json')) === null) fail('MISSING_MANIFEST');
      return store;
    } catch (error: unknown) {
      throw closed(error);
    }
  }

  private async assertDirectory(): Promise<void> {
    const current = await lstat(this.directory);
    if (
      !current.isDirectory() ||
      !privateMode(current, 0o700) ||
      !sameFile(current, this.identity) ||
      (await realpath(this.directory)) !== this.directory
    )
      fail('UNSAFE_DIRECTORY');
  }

  /** Returns null only when the immutable record is absent. */
  async read(name: string): Promise<unknown> {
    let handle: FileHandle | undefined;
    try {
      recordName(name);
      await this.assertDirectory();
      const path = join(this.directory, name);
      let before: Stats;
      try {
        before = await lstat(path);
      } catch (error: unknown) {
        if (fsCode(error) === 'ENOENT') return null;
        throw error;
      }
      fileInfo(before);
      try {
        handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      } catch (error: unknown) {
        if (fsCode(error) === 'ELOOP') fail('UNSAFE_FILE');
        throw error;
      }
      const opened = await handle.stat();
      fileInfo(opened);
      if (!sameFile(before, opened)) fail('UNSAFE_FILE');
      const text = await readBounded(handle);
      const after = await handle.stat();
      fileInfo(after);
      if (opened.size !== after.size || opened.mtimeMs !== after.mtimeMs) fail('UNSAFE_FILE');
      await this.assertDirectory();
      try {
        const value: unknown = JSON.parse(text);
        if (value === null) fail('INVALID_RECORD');
        canonicalJson(value);
        return value;
      } catch {
        return fail('INVALID_RECORD');
      }
    } catch (error: unknown) {
      throw closed(error);
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch {
          /* Reads have no durable side effects. */
        }
      }
    }
  }

  async create(name: string, value: unknown): Promise<boolean> {
    let temporary: string | undefined;
    let handle: FileHandle | undefined;
    try {
      recordName(name);
      const text = serialize(value);
      await this.assertDirectory();
      temporary = join(this.directory, `.tmp-${randomUUID()}`);
      handle = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      await handle.writeFile(text, 'utf8');
      fileInfo(await handle.stat());
      await handle.sync();
      await handle.close();
      handle = undefined;
      await this.assertDirectory();
      let published = true;
      try {
        await link(temporary, join(this.directory, name));
      } catch (error: unknown) {
        if (fsCode(error) !== 'EEXIST') throw error;
        if ((await this.read(name)) === null) fail('IO_ERROR');
        published = false;
      }
      await this.assertDirectory();
      await syncDirectory(this.directory, this.identity);
      return published;
    } catch (error: unknown) {
      throw closed(error);
    } finally {
      if (handle) {
        try {
          await handle.close();
        } catch {
          /* Keep the original safe error. */
        }
      }
      if (temporary) {
        try {
          await unlink(temporary);
        } catch {
          /* Orphan temps are never records. */
        }
      }
    }
  }
}
