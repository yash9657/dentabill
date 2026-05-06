import { SUMMARIZER_PROMPT_V1, type SummarizerPrompt } from './v1.js';

/**
 * Prompt registry. Every shipped prompt version stays here forever
 * so historical summaries (audit-logged with `metadata.prompt = vX`)
 * remain re-runnable. New prompts append; never replace.
 */
export const PROMPT_REGISTRY: Readonly<Record<string, SummarizerPrompt>> = {
  v1: SUMMARIZER_PROMPT_V1,
};

export const DEFAULT_PROMPT_VERSION = 'v1';

export function getPrompt(version: string): SummarizerPrompt {
  const prompt = PROMPT_REGISTRY[version];
  if (!prompt) {
    throw new Error(
      `Unknown summarizer prompt version: ${version}. Known versions: ${Object.keys(
        PROMPT_REGISTRY,
      ).join(', ')}`,
    );
  }
  return prompt;
}

export type { SummarizerPrompt };
