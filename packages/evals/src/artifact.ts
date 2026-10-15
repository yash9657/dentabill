/* eslint-disable security/detect-non-literal-fs-filename -- Fixed workspace source/manifests, never server-selected paths. */
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';

import { evidenceHash } from './contracts.js';

export async function implementationHash(): Promise<string> {
  const files: { path: string; sha256: string }[] = [];
  for (const [prefix, directory] of [
    ['evals', new URL('.', import.meta.url)],
    ['model-gateway', new URL('.', import.meta.resolve('@dentabill/model-gateway'))],
  ] as const) {
    for (const name of (await readdir(directory)).sort()) {
      if (
        !name.endsWith('.ts') ||
        name.endsWith('.test.ts') ||
        name.endsWith('.fixture.ts') ||
        name === 'test-fixtures.ts'
      )
        continue;
      const bytes = await readFile(new URL(name, directory));
      files.push({
        path: `${prefix}/${name}`,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
    for (const name of ['package.json', 'tsconfig.json']) {
      const bytes = await readFile(new URL(`../${name}`, directory));
      files.push({
        path: `${prefix}/${name}`,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  }
  const lock = await readFile(new URL('../../../pnpm-lock.yaml', import.meta.url));
  files.push({ path: 'pnpm-lock.yaml', sha256: createHash('sha256').update(lock).digest('hex') });
  return evidenceHash(files);
}
