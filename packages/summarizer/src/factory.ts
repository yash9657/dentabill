import { FakeClaude } from './fake.js';
import type { SummarizerPort } from './port.js';

/**
 * Empty / unset ANTHROPIC_API_KEY preserves the explicit synthetic baseline.
 * Legacy live inference is blocked; a key is not an approved provider release.
 */
export interface CreateSummarizerPortInput {
  readonly anthropicApiKey?: string;
  readonly maxOutputTokens?: number;
  /**
   * Let the fake adapter derive a summary from the transcript instead of
   * throwing when no fixture is registered. Only meaningful in `fake` mode.
   *
   * Without this, an unkeyed call — i.e. any call not driven by test code —
   * fails summarization, retries, and dead-letters, so the claim never
   * transitions and no summary ever reaches the dashboard.
   */
  readonly deriveWhenUnregistered?: boolean;
}

export interface CreateSummarizerPortResult {
  readonly summarizer: SummarizerPort;
  readonly mode: 'fake';
}

export function createSummarizerPort(input: CreateSummarizerPortInput): CreateSummarizerPortResult {
  const key = input.anthropicApiKey ?? '';
  if (key.length === 0) {
    return {
      summarizer: new FakeClaude({
        deriveWhenUnregistered: input.deriveWhenUnregistered ?? false,
      }),
      mode: 'fake',
    };
  }
  throw new Error('SUMMARY_PROVIDER_DISABLED');
}
