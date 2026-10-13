/* eslint-disable security/detect-non-literal-fs-filename -- Test paths are confined to this test's own mkdtemp directory. */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const exec = promisify(execFile);
let root: string;
const cli = async (args: string[]) =>
  exec(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
    cwd: new URL('..', import.meta.url),
    timeout: 15_000,
    env: { ...process.env, FIREWORKS_API_KEY: '', ELEVENLABS_API_KEY: '' },
  });
async function expectCliFailure(args: string[], code: string): Promise<void> {
  const failure = await cli(args).then(
    () => null,
    (error: unknown) => error,
  );
  // Node/tsx may additionally emit a runtime deprecation warning; the application error stays closed.
  expect(failure).toMatchObject({ stderr: expect.stringContaining(`${code}\n`), stdout: '' });
  expect(String(failure)).not.toContain('canary-secret');
}
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'dentabill-eval-cli-'));
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('offline evaluation CLI', () => {
  it('writes a protected seed packet, replays it deterministically, and verifies originals', async () => {
    const directory = join(root, 'seed');
    expect((await cli(['seed', '--out', directory])).stdout).toContain(
      'cases=25; productionApproval=false',
    );
    if (process.platform !== 'win32') {
      expect((await stat(directory)).mode & 0o777).toBe(0o700);
      expect((await stat(join(directory, 'corpus.json'))).mode & 0o777).toBe(0o600);
    }
    const replay = join(root, 'replay');
    await cli([
      'score',
      '--corpus',
      join(directory, 'corpus.json'),
      '--results',
      join(directory, 'results.json'),
      '--out',
      replay,
    ]);
    expect(await readFile(join(replay, 'report.json'), 'utf8')).toBe(
      await readFile(join(directory, 'report.json'), 'utf8'),
    );
    expect(await readFile(join(replay, 'review.json'), 'utf8')).toBe(
      await readFile(join(directory, 'review.json'), 'utf8'),
    );
    const args = [
      'verify',
      '--corpus',
      join(directory, 'corpus.json'),
      '--results',
      join(directory, 'results.json'),
      '--report',
      join(directory, 'report.json'),
      '--review',
      join(directory, 'review.json'),
    ];
    expect((await cli(args)).stdout).toContain('EVALUATION_BINDINGS_VERIFIED');
    const raw = await readFile(join(directory, 'report.json'), 'utf8');
    await writeFile(
      join(directory, 'report.json'),
      raw.replace('"productionApproval":false', '"productionApproval":true'),
    );
    await expectCliFailure(args, 'INVALID_REPORT');
    await expectCliFailure(['seed', '--out', directory], 'OUTPUT_EXISTS');
    expect(await readFile(join(directory, 'report.json'), 'utf8')).not.toBe(raw);
  }, 30_000);

  it('rejects missing, duplicate and unknown flags and redacts malformed JSON', async () => {
    expect((await cli(['--help'])).stdout).toContain('No network calls or release promotion');
    await expectCliFailure(
      ['seed', '--out', join(root, 'unused'), '--live', 'true'],
      'INVALID_INPUT',
    );
    await expectCliFailure(
      ['score', '--out', 'one', '--out', 'two', '--corpus', 'three'],
      'INVALID_INPUT',
    );
    const invalid = join(root, 'invalid.json');
    await writeFile(invalid, '{"private-transcript":"canary-secret"');
    await expectCliFailure(
      ['score', '--corpus', invalid, '--results', invalid, '--out', join(root, 'invalid-output')],
      'INVALID_INPUT',
    );
  }, 30_000);
});
