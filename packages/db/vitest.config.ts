import { defineConfig, mergeConfig } from 'vitest/config';

import base from '@dentabill/config/vitest';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      name: '@dentabill/db',
      env: {
        DATABASE_URL:
          process.env.TEST_DATABASE_URL ??
          'postgresql://dentabill:dentabill@localhost:5432/dentabill_test?schema=public',
        NODE_ENV: 'test',
      },
      setupFiles: ['./test/setup.ts'],
      // Integration tests share a single DB; running tests serially per file
      // avoids cross-test interleaving on the truncate.
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
    },
  }),
);
