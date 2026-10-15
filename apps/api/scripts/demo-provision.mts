#!/usr/bin/env tsx
import { runDemoCli } from '../src/lib/demo/command-cli.js';

await runDemoCli('provision', import.meta.url);
