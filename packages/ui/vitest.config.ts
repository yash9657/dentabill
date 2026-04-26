import react from '@vitejs/plugin-react';
import { defineConfig, mergeConfig } from 'vitest/config';

import base from '@dentabill/config/vitest';

export default mergeConfig(
  base,
  defineConfig({
    plugins: [react()],
    test: {
      name: '@dentabill/ui',
      environment: 'jsdom',
      setupFiles: ['./test/setup.ts'],
      globals: false,
    },
  }),
);
