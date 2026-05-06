import { FakeClaude } from './fake.js';
import { LiveClaude } from './live.js';
import type { SummarizerPort } from './port.js';

/**
 * Empty / unset `ANTHROPIC_API_KEY` selects the FakeClaude adapter.
 * Mirrors `createRetellPort` (ADR-033) — production deploys validate
 * the key at boot, so silent falls-back to fake here are dev/test
 * convenience only.
 */
export interface CreateSummarizerPortInput {
  readonly anthropicApiKey?: string;
  readonly maxOutputTokens?: number;
}

export interface CreateSummarizerPortResult {
  readonly summarizer: SummarizerPort;
  readonly mode: 'live' | 'fake';
}

export function createSummarizerPort(input: CreateSummarizerPortInput): CreateSummarizerPortResult {
  const key = input.anthropicApiKey ?? '';
  if (key.length === 0) {
    return { summarizer: new FakeClaude(), mode: 'fake' };
  }
  const liveOpts: { apiKey: string; maxOutputTokens?: number } = { apiKey: key };
  if (input.maxOutputTokens !== undefined) liveOpts.maxOutputTokens = input.maxOutputTokens;
  return { summarizer: new LiveClaude(liveOpts), mode: 'live' };
}
