import { describe, expect, it } from 'vitest';

import { auditLogsQueryKey } from './use-audit-logs.js';

describe('auditLogsQueryKey', () => {
  it('returns a query key with null filters when no filters are provided', () => {
    const key = auditLogsQueryKey({}, 'org-a', 'user-a');
    expect(key).toEqual([
      'auditLogs',
      'list',
      'org-a',
      'user-a',
      { resourceType: null, from: null, to: null },
    ]);
  });

  it('includes resourceType in the key when provided', () => {
    const key = auditLogsQueryKey({ resourceType: 'Claim' }, 'org-a', 'user-a');
    expect(key).toEqual([
      'auditLogs',
      'list',
      'org-a',
      'user-a',
      { resourceType: 'Claim', from: null, to: null },
    ]);
  });

  it('includes date range in the key when provided', () => {
    const key = auditLogsQueryKey(
      {
        from: '2026-01-01',
        to: '2026-01-31',
      },
      'org-a',
      'user-a',
    );
    expect(key).toEqual([
      'auditLogs',
      'list',
      'org-a',
      'user-a',
      { resourceType: null, from: '2026-01-01', to: '2026-01-31' },
    ]);
  });

  it('includes all filters in the key when provided', () => {
    const key = auditLogsQueryKey(
      {
        resourceType: 'Call',
        from: '2026-08-01',
        to: '2026-08-31',
      },
      'org-a',
      'user-a',
    );
    expect(key).toEqual([
      'auditLogs',
      'list',
      'org-a',
      'user-a',
      { resourceType: 'Call', from: '2026-08-01', to: '2026-08-31' },
    ]);
  });
});
