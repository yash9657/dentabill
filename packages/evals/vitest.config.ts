import base from '@dentabill/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(base, defineConfig({ test: { name: '@dentabill/evals' } }));
