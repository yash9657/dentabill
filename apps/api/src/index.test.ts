import { describe, expect, it } from 'vitest';

import { buildServer } from './index.js';

describe('@dentabill/api exports', () => {
  it('exports buildServer as a function', () => {
    expect(typeof buildServer).toBe('function');
  });
});
