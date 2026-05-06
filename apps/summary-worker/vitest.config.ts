import { defineConfig, mergeConfig } from 'vitest/config';

import base from '@dentabill/config/vitest';

export default mergeConfig(
  base,
  defineConfig({
    test: {
      name: '@dentabill/summary-worker',
      env: {
        DATABASE_URL:
          process.env.TEST_DATABASE_URL ??
          'postgresql://dentabill:dentabill@localhost:5432/dentabill_test?schema=public',
        REDIS_URL: process.env.REDIS_URL ?? 'redis://localhost:6379/15',
        NODE_ENV: 'test',
      },
      // Integration tests share a single DB schema; run sequentially per
      // file so the cleanup TRUNCATE doesn't race across forks.
      pool: 'forks',
      poolOptions: { forks: { singleFork: true } },
    },
  }),
);
