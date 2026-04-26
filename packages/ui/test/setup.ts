import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// We use `globals: false` (explicit imports of describe/it/expect). With that,
// @testing-library/react's auto-cleanup doesn't fire — we register it here.
afterEach(() => {
  cleanup();
});
