import { describe, expect, it } from 'vitest';

import { createSummarizerPort } from './factory.js';
import { FakeClaude } from './fake.js';

describe('createSummarizerPort', () => {
  it('returns FakeClaude when ANTHROPIC_API_KEY is empty / unset', () => {
    expect(createSummarizerPort({}).summarizer).toBeInstanceOf(FakeClaude);
    expect(createSummarizerPort({ anthropicApiKey: '' }).mode).toBe('fake');
  });

  it('fails closed instead of enabling legacy live inference or falling back to fake', () => {
    expect(() =>
      createSummarizerPort({ anthropicApiKey: 'synthetic-key', deriveWhenUnregistered: true }),
    ).toThrow('SUMMARY_PROVIDER_DISABLED');
    expect(createSummarizerPort({}).summarizer.inference).toEqual({
      provider: 'SYNTHETIC',
      releaseId: 'synthetic-summary.v1',
    });
  });
});
