import { createSummarizerPort, type SummarizerPort } from '@dentabill/summarizer';

import type { SummaryWorkerEnv } from './env.js';

/** An unrelated legacy key cannot prevent recovery of an already stored native result. */
export function createRuntimeSummarizer(env: SummaryWorkerEnv): SummarizerPort {
  let port: SummarizerPort | undefined;
  return {
    inference: {
      provider: env.ANTHROPIC_API_KEY ? 'UNAPPROVED' : 'SYNTHETIC',
      releaseId: env.ANTHROPIC_API_KEY ? 'unapproved-legacy' : 'synthetic-summary.v1',
    },
    async summarize(input) {
      port ??= createSummarizerPort({
        anthropicApiKey: env.ANTHROPIC_API_KEY,
        maxOutputTokens: env.SUMMARIZER_MAX_OUTPUT_TOKENS,
        deriveWhenUnregistered: env.DEMO_SUMMARIZER_FALLBACK === 'true',
      }).summarizer;
      return port.summarize(input);
    },
  };
}
