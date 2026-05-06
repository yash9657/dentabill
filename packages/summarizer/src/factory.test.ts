import { describe, expect, it } from 'vitest';

import { createSummarizerPort } from './factory.js';
import { FakeClaude } from './fake.js';
import { LiveClaude } from './live.js';

describe('createSummarizerPort', () => {
  it('returns FakeClaude when ANTHROPIC_API_KEY is empty / unset', () => {
    expect(createSummarizerPort({}).summarizer).toBeInstanceOf(FakeClaude);
    expect(createSummarizerPort({ anthropicApiKey: '' }).mode).toBe('fake');
  });

  it('returns LiveClaude when an API key is provided', () => {
    const result = createSummarizerPort({ anthropicApiKey: 'sk-test' });
    expect(result.summarizer).toBeInstanceOf(LiveClaude);
    expect(result.mode).toBe('live');
  });
});
