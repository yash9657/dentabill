import { defineConfig, mergeConfig } from 'vitest/config';

import base from '@dentabill/config/vitest';

export default mergeConfig(base, defineConfig({ test: { name: '@dentabill/summary-worker' } }));
