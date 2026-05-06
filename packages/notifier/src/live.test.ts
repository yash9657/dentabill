import { describe, expect, it } from 'vitest';

import { FakeResend } from './fake.js';
import { LiveResend, createNotifierPort } from './live.js';

describe('createNotifierPort', () => {
  it('returns FakeResend when RESEND_API_KEY is empty / unset', () => {
    expect(createNotifierPort({}).notifier).toBeInstanceOf(FakeResend);
    expect(createNotifierPort({ resendApiKey: '' }).mode).toBe('fake');
  });

  it('throws when constructed with a key in Phase 4', () => {
    expect(() => new LiveResend({ resendApiKey: 'sk-resend' })).toThrow(/not implemented/);
    expect(() => createNotifierPort({ resendApiKey: 'sk-resend' })).toThrow(/not implemented/);
  });
});
