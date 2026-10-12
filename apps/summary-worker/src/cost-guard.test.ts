import { describe, expect, it } from 'vitest';

import { createInMemoryCostGuard } from './cost-guard.js';

describe('createInMemoryCostGuard', () => {
  it('grants one holder per (org, day) and frees the key on release', async () => {
    const guard = createInMemoryCostGuard();
    const first = await guard.tryAcquire('org_1', '2026-10-12');
    expect(first).not.toBeNull();
    expect(await guard.tryAcquire('org_1', '2026-10-12')).toBeNull();
    expect(await guard.tryAcquire('org_2', '2026-10-12')).not.toBeNull();
    expect(await guard.tryAcquire('org_1', '2026-10-13')).not.toBeNull();

    await guard.release(first!);
    expect(await guard.tryAcquire('org_1', '2026-10-12')).not.toBeNull();
  });

  it('ignores a release whose token no longer holds the lock', async () => {
    const guard = createInMemoryCostGuard();
    const lock = await guard.tryAcquire('org_1', '2026-10-12');
    await guard.release({ ...lock!, token: 'someone-else' });
    expect(await guard.tryAcquire('org_1', '2026-10-12')).toBeNull();
  });
});
