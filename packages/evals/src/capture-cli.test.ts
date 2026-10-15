/* eslint-disable security/detect-non-literal-fs-filename -- Test-owned temporary inputs; real child CLI with no credentials. */
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CapturePlanSchema } from './capture-plan.js';
import { evidenceHash } from './contracts.js';
import { createSeedCorpus } from './seed.js';

const exec = promisify(execFile);
let directory: string;
beforeAll(async () => {
  directory = await realpath(await mkdtemp(join(tmpdir(), 'dentabill-capture-cli-')));
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});
const cli = (args: string[]) =>
  exec(process.execPath, ['--import', 'tsx', 'src/capture-cli.ts', ...args], {
    cwd: new URL('..', import.meta.url),
    timeout: 15_000,
    env: { ...process.env, FIREWORKS_API_KEY: '', ELEVENLABS_API_KEY: '' },
  });

async function failure(args: string[], code: string): Promise<void> {
  const error = await cli(args).then(
    () => null,
    (error: unknown) => error,
  );
  expect(error).toMatchObject({ stdout: '', stderr: expect.stringContaining(`${code}\n`) });
  expect(String(error)).not.toContain('PRIVATE_CLI_CANARY');
}

describe('separate contract-capture CLI', () => {
  it('prepares and verifies a concrete plan without authorizing or sending it', async () => {
    const corpus = createSeedCorpus();
    corpus.cases = corpus.cases.slice(0, 1);
    const corpusFile = join(directory, 'corpus.json');
    const evidenceFile = join(directory, 'evidence.json');
    await writeFile(corpusFile, JSON.stringify(corpus));
    await writeFile(
      evidenceFile,
      JSON.stringify({
        checkedAt: new Date().toISOString(),
        accountSha256: 'b'.repeat(64),
        accountEvidenceSha256: 'c'.repeat(64),
        priceSource: 'https://docs.fireworks.ai/serverless/pricing',
        contextSource: 'https://docs.fireworks.ai/api-reference/get-model',
        model: 'accounts/fireworks/routers/glm-5p3-flash-us',
        serviceTier: 'STANDARD_DEFAULT',
        contextTokens: 1_048_576,
        inputUsdMicrosPerMillion: 225_000,
        outputUsdMicrosPerMillion: 750_000,
        publisherRevision: 'synthetic-license',
        publisherLicenseSha256: 'd'.repeat(64),
        servingRevisionVerified: false,
        regionalRouteVerified: false,
      }),
    );
    const run = join(directory, 'prepared');
    const args = [
      'prepare',
      '--corpus',
      corpusFile,
      '--candidate',
      'glm-flash-claim-observation.v1',
      '--evidence',
      evidenceFile,
      '--allowance-usd',
      '2',
      '--out',
      run,
    ];
    expect((await cli(args)).stdout).toContain('authorized=false');
    const plan = CapturePlanSchema.parse(
      JSON.parse(await readFile(join(run, 'manifest.json'), 'utf8')),
    );
    expect((await cli(['inspect', '--run', run])).stdout).toContain(
      `planSha256=${evidenceHash(plan)}`,
    );
    await expect(readFile(join(run, 'authorization.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await failure(
      ['run', '--run', run, '--authorize-plan', 'f'.repeat(64)],
      'CAPTURE_AUTHORIZATION_REQUIRED',
    );
    await expect(readFile(join(run, 'authorization.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await failure(args, 'CAPTURE_STORE_DIRECTORY_EXISTS');
    await failure(
      ['run', '--run', run, '--authorize-plan', evidenceHash(plan)],
      'CAPTURE_ACCOUNT_MISMATCH',
    );
    await expect(
      readFile(join(run, `case-${String(plan.cases[0]?.storageId)}-admission.json`)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30_000);

  it('rejects ambiguous flags, malformed inputs and unsupported live commands with closed errors', async () => {
    expect((await cli(['--help'])).stdout).toContain('Unknown outcomes are never resent');
    await failure(['run', '--run', 'x'], 'CAPTURE_INVALID_INPUT');
    await failure(['run', '--run', 'x', '--run', 'y'], 'CAPTURE_INVALID_INPUT');
    await failure(['approve-production'], 'CAPTURE_INVALID_INPUT');
    const invalid = join(directory, 'invalid.json');
    await writeFile(invalid, '{"PRIVATE_CLI_CANARY"');
    await failure(
      [
        'prepare',
        '--corpus',
        invalid,
        '--candidate',
        'glm-flash-claim-observation.v1',
        '--evidence',
        invalid,
        '--allowance-usd',
        '2',
        '--out',
        join(directory, 'invalid'),
      ],
      'CAPTURE_INVALID_INPUT',
    );
  }, 30_000);
});
