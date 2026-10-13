/* eslint-disable security/detect-non-literal-fs-filename -- Isolated private temporary filesystem fixtures, removed after each test. */
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
  type FileHandle,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CaptureStore, CaptureStoreError } from './capture-store.js';

const CASE = 'a'.repeat(64);
const ADMISSION = `case-${CASE}-admission.json`;
const RESPONSE = `case-${CASE}-response.json`;
const PRIVATE_MARKER = 'SYNTHETIC_PRIVATE_CAPTURE_CONTENT';
const manifest = { version: 'synthetic-store.v1', cases: [CASE], cap: 1000 };
let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'dentabill-capture-store-')));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

async function expectCode(
  operation: Promise<unknown>,
  code: CaptureStoreError['code'],
): Promise<void> {
  let caught: unknown;
  try {
    await operation;
  } catch (error: unknown) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(CaptureStoreError);
  if (!(caught instanceof CaptureStoreError)) throw new Error('EXPECTED_CLOSED_STORE_ERROR');
  expect(caught.code).toBe(code);
  expect(caught.message).toBe(code);
  expect(JSON.stringify(caught)).not.toContain(PRIVATE_MARKER);
  expect(caught.stack).not.toContain(PRIVATE_MARKER);
  expect(caught.message).not.toContain(root);
}

async function syncPrototype(): Promise<Pick<FileHandle, 'sync'>> {
  const handle = await open(join(root, 'prototype-probe'), 'wx', 0o600);
  try {
    return Object.getPrototypeOf(handle) as Pick<FileHandle, 'sync'>;
  } finally {
    await handle.close();
  }
}

describe('private immutable capture records', () => {
  it('creates an exclusive private store with a canonical manifest and opens it again', async () => {
    const directory = join(root, 'capture');
    const store = await CaptureStore.create(directory, manifest);
    expect(store.directory).toBe(await realpath(directory));
    expect((await lstat(directory)).mode & 0o777).toBe(0o700);
    expect((await lstat(join(directory, 'manifest.json'))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(directory, 'manifest.json'), 'utf8')).toBe(
      `{"cap":1000,"cases":["${CASE}"],"version":"synthetic-store.v1"}\n`,
    );
    const reopened = await CaptureStore.open(directory);
    expect(await reopened.read('manifest.json')).toEqual(manifest);
    expect(await reopened.read(ADMISSION)).toBeNull();
    await expectCode(CaptureStore.create(directory, { other: true }), 'DIRECTORY_EXISTS');
    expect(await reopened.read('manifest.json')).toEqual(manifest);
  });

  it('accepts every fixed record kind and never replaces existing bytes', async () => {
    const store = await CaptureStore.create(join(root, 'capture'), manifest);
    for (const name of [
      'authorization.json',
      'corpus.json',
      'capture-report.json',
      ADMISSION,
      RESPONSE,
      `case-${CASE}-attempt.json`,
      `case-${CASE}-result.json`,
    ]) {
      const first = { kind: name, data: PRIVATE_MARKER, nested: { body: null } };
      expect(await store.create(name, first)).toBe(true);
      const originalBytes = await readFile(join(store.directory, name));
      expect(await store.create(name, { replacement: true })).toBe(false);
      expect(await readFile(join(store.directory, name))).toEqual(originalBytes);
      expect(await store.read(name)).toEqual(first);
    }
    expect((await readdir(store.directory)).some((name) => name.startsWith('.tmp-'))).toBe(false);
  });

  it('atomically admits exactly one concurrent writer and exposes only the complete winning record', async () => {
    const store = await CaptureStore.create(join(root, 'capture'), manifest);
    const contenders = await Promise.all(
      Array.from({ length: 12 }, () => CaptureStore.open(store.directory)),
    );
    const values = contenders.map((_store, i) => ({
      contender: i,
      text: '🙂漢字'.repeat(16_384),
      reserved: 1000,
    }));
    const published = await Promise.all(
      contenders.map((writer, i) => writer.create(ADMISSION, values[i])),
    );
    expect(published.filter(Boolean)).toHaveLength(1);
    const winner = values[published.indexOf(true)];
    expect(await store.read(ADMISSION)).toEqual(winner);
    expect((await readdir(store.directory)).filter((name) => name === ADMISSION)).toHaveLength(1);
  });

  it('ignores orphan temporary files from an interrupted publication', async () => {
    const store = await CaptureStore.create(join(root, 'capture'), manifest);
    await writeFile(join(store.directory, '.tmp-interrupted'), '{"incomplete":', { mode: 0o600 });
    const reopened = await CaptureStore.open(store.directory);
    expect(await reopened.read(ADMISSION)).toBeNull();
    expect(await reopened.create(ADMISSION, { reserved: 1000 })).toBe(true);
    expect(await reopened.read(ADMISSION)).toEqual({ reserved: 1000 });
    await expectCode(reopened.read('.tmp-interrupted'), 'INVALID_RECORD_NAME');
  });

  it('treats an empty interrupted directory as incomplete, not a usable run', async () => {
    const directory = join(root, 'interrupted');
    await mkdir(directory, { mode: 0o700 });
    await expectCode(CaptureStore.open(directory), 'MISSING_MANIFEST');
    await expectCode(CaptureStore.create(directory, manifest), 'DIRECTORY_EXISTS');
  });
});

describe('capture filesystem boundaries', () => {
  it.each([
    '../manifest.json',
    '/manifest.json',
    'x/manifest.json',
    'other.json',
    '.tmp-hidden',
    'case-a-response.json',
    `case-${'A'.repeat(64)}-response.json`,
    `case-${CASE}-unknown.json`,
    `case-${CASE}-response.json/..`,
    'manifest.json\0private',
  ])('rejects undeclared record name %s', async (name) => {
    const store = await CaptureStore.create(join(root, 'capture'), manifest);
    await expectCode(store.read(name), 'INVALID_RECORD_NAME');
    await expectCode(store.create(name, { private: PRIVATE_MARKER }), 'INVALID_RECORD_NAME');
  });

  it('rejects relative and invalid run paths with closed errors', async () => {
    await expectCode(CaptureStore.create('relative-run', manifest), 'INVALID_PATH');
    await expectCode(CaptureStore.open('relative-run'), 'INVALID_PATH');
    await expectCode(
      CaptureStore.create(`${root}/bad\0${PRIVATE_MARKER}`, manifest),
      'INVALID_PATH',
    );
  });

  it('canonicalizes parent aliases but refuses a symlink as the run directory', async () => {
    const parent = join(root, 'actual-parent');
    const alias = join(root, 'parent-alias');
    await mkdir(parent, { mode: 0o700 });
    await symlink(parent, alias);
    const store = await CaptureStore.create(join(alias, 'capture'), manifest);
    expect(store.directory).toBe(join(parent, 'capture'));
    const runAlias = join(root, 'run-alias');
    await symlink(store.directory, runAlias);
    await expectCode(CaptureStore.open(runAlias), 'UNSAFE_DIRECTORY');
    await expectCode(CaptureStore.create(runAlias, manifest), 'DIRECTORY_EXISTS');
  });

  it.each([0o755, 0o770, 0o777])(
    'rejects run directory mode %s on open and existing handles',
    async (mode) => {
      const store = await CaptureStore.create(join(root, 'capture'), manifest);
      await chmod(store.directory, mode);
      await expectCode(CaptureStore.open(store.directory), 'UNSAFE_DIRECTORY');
      await expectCode(store.read('manifest.json'), 'UNSAFE_DIRECTORY');
      await expectCode(store.create(ADMISSION, { reserved: 1000 }), 'UNSAFE_DIRECTORY');
    },
  );

  it.each([0o644, 0o660, 0o700])(
    'rejects record mode %s before reading or treating a collision as success',
    async (mode) => {
      const store = await CaptureStore.create(join(root, 'capture'), manifest);
      await store.create(ADMISSION, { reserved: 1000 });
      await chmod(join(store.directory, ADMISSION), mode);
      await expectCode(store.read(ADMISSION), 'UNSAFE_FILE');
      await expectCode(store.create(ADMISSION, { reserved: 0 }), 'UNSAFE_FILE');
    },
  );

  it('rejects symlink records and nonregular records without changing their targets', async () => {
    const store = await CaptureStore.create(join(root, 'capture'), manifest);
    const outside = join(root, 'outside');
    await writeFile(outside, JSON.stringify({ private: PRIVATE_MARKER }), { mode: 0o600 });
    await symlink(outside, join(store.directory, ADMISSION));
    await mkdir(join(store.directory, RESPONSE), { mode: 0o700 });
    await expectCode(store.read(ADMISSION), 'UNSAFE_FILE');
    await expectCode(store.create(ADMISSION, { reserved: 0 }), 'UNSAFE_FILE');
    await expectCode(store.read(RESPONSE), 'UNSAFE_FILE');
    expect(await readFile(outside, 'utf8')).toContain(PRIVATE_MARKER);
  });

  it('rejects directory replacement after a store was opened', async () => {
    const store = await CaptureStore.create(join(root, 'capture'), manifest);
    await rename(store.directory, join(root, 'original'));
    await mkdir(store.directory, { mode: 0o700 });
    await expectCode(store.read('manifest.json'), 'UNSAFE_DIRECTORY');
    await expectCode(store.create(ADMISSION, { reserved: 0 }), 'UNSAFE_DIRECTORY');
  });

  it('rejects invalid records and reserves null exclusively for missing files', async () => {
    const store = await CaptureStore.create(join(root, 'capture'), manifest);
    await expectCode(
      store.create(RESPONSE, { text: PRIVATE_MARKER, invalid: undefined }),
      'INVALID_RECORD',
    );
    await expectCode(store.create(RESPONSE, null), 'INVALID_RECORD');
    await writeFile(join(store.directory, RESPONSE), `{"private":"${PRIVATE_MARKER}"`, {
      mode: 0o600,
    });
    await expectCode(store.read(RESPONSE), 'INVALID_RECORD');
    await expectCode(store.create(RESPONSE, { replaced: true }), 'INVALID_RECORD');
    await writeFile(join(store.directory, RESPONSE), 'null');
    await expectCode(store.read(RESPONSE), 'INVALID_RECORD');
  });

  it('rejects invalid UTF-8 and deeply nested JSON rather than coercing their contents', async () => {
    const store = await CaptureStore.create(join(root, 'capture'), manifest);
    await writeFile(join(store.directory, RESPONSE), Buffer.from([0x22, 0xc3, 0x28, 0x22]), {
      mode: 0o600,
    });
    await expectCode(store.read(RESPONSE), 'INVALID_RECORD');
    await writeFile(join(store.directory, RESPONSE), `${'['.repeat(41)}0${']'.repeat(41)}`);
    await expectCode(store.read(RESPONSE), 'INVALID_RECORD');
  });

  it('bounds bytes on both read and publication', async () => {
    const store = await CaptureStore.create(join(root, 'capture'), manifest);
    await expectCode(
      store.create(RESPONSE, { text: '漢'.repeat(6 * 1024 * 1024) }),
      'RECORD_TOO_LARGE',
    );
    const oversized = await open(join(store.directory, RESPONSE), 'wx', 0o600);
    await oversized.truncate(16 * 1024 * 1024 + 1);
    await oversized.close();
    await expectCode(store.read(RESPONSE), 'RECORD_TOO_LARGE');
  });
});

describe('durable publication boundaries', () => {
  it('syncs complete file bytes before publication and the directory after publication', async () => {
    const store = await CaptureStore.create(join(root, 'capture'), manifest);
    const prototype = await syncPrototype();
    const original = prototype.sync;
    const order: string[] = [];
    vi.spyOn(prototype, 'sync').mockImplementation(async function (this: FileHandle) {
      const info = await this.stat();
      if (info.isFile()) {
        await expect(lstat(join(store.directory, ADMISSION))).rejects.toMatchObject({
          code: 'ENOENT',
        });
        order.push('file-before-publish');
      } else {
        expect((await lstat(join(store.directory, ADMISSION))).isFile()).toBe(true);
        order.push('directory-after-publish');
      }
      await original.call(this);
    });
    expect(await store.create(ADMISSION, { reserved: 1000 })).toBe(true);
    expect(order).toEqual(['file-before-publish', 'directory-after-publish']);
  });

  it('does not publish if file fsync fails and returns no raw filesystem error', async () => {
    const store = await CaptureStore.create(join(root, 'capture'), manifest);
    const prototype = await syncPrototype();
    vi.spyOn(prototype, 'sync').mockRejectedValue(new Error(PRIVATE_MARKER));
    await expectCode(store.create(ADMISSION, { reserved: 1000 }), 'IO_ERROR');
    expect(await store.read(ADMISSION)).toBeNull();
  });

  it('throws after ambiguous directory fsync failure while preserving the authoritative record', async () => {
    const store = await CaptureStore.create(join(root, 'capture'), manifest);
    const prototype = await syncPrototype();
    const original = prototype.sync;
    vi.spyOn(prototype, 'sync').mockImplementation(async function (this: FileHandle) {
      if ((await this.stat()).isDirectory()) throw new Error(PRIVATE_MARKER);
      await original.call(this);
    });
    await expectCode(store.create(ADMISSION, { reserved: 1000 }), 'IO_ERROR');
    expect(await store.read(ADMISSION)).toEqual({ reserved: 1000 });
    vi.restoreAllMocks();
    expect(await store.create(ADMISSION, { reserved: 0 })).toBe(false);
    expect(await store.read(ADMISSION)).toEqual({ reserved: 1000 });
  });
});
