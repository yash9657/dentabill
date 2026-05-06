import { describe, expect, it } from 'vitest';

import { DEFAULT_PROMPT_VERSION, getPrompt, PROMPT_REGISTRY } from './index.js';

describe('PROMPT_REGISTRY', () => {
  it('exposes the default version', () => {
    expect(PROMPT_REGISTRY[DEFAULT_PROMPT_VERSION]).toBeDefined();
    expect(getPrompt(DEFAULT_PROMPT_VERSION).version).toBe(DEFAULT_PROMPT_VERSION);
  });

  it('every registered prompt has model + systemPrompt populated', () => {
    for (const [version, prompt] of Object.entries(PROMPT_REGISTRY)) {
      expect(prompt.version).toBe(version);
      expect(prompt.model.length).toBeGreaterThan(0);
      expect(prompt.systemPrompt.length).toBeGreaterThan(0);
    }
  });

  it('throws on unknown version', () => {
    expect(() => getPrompt('v9999')).toThrow(/Unknown summarizer prompt version/);
  });
});
