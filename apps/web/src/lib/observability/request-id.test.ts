import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getClientRequestId,
  mintRequestId,
  REQUEST_ID_HEADER,
  REQUEST_ID_META_NAME,
} from './request-id.js';

describe('mintRequestId()', () => {
  it('returns a base64url-encoded 16-byte payload', () => {
    const id = mintRequestId();
    // 16 bytes -> 22 base64url chars (no padding).
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });

  it('returns a different id on every call (cryptographic randomness)', () => {
    const samples = new Set<string>();
    for (let i = 0; i < 32; i += 1) {
      samples.add(mintRequestId());
    }
    expect(samples.size).toBe(32);
  });
});

describe('getClientRequestId()', () => {
  afterEach(() => {
    document.head.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('returns null when no meta tag is present', () => {
    expect(getClientRequestId()).toBeNull();
  });

  it('reads the id from the document meta tag set by the layout', () => {
    const meta = document.createElement('meta');
    meta.name = REQUEST_ID_META_NAME;
    meta.content = 'test-id-123';
    document.head.appendChild(meta);

    expect(getClientRequestId()).toBe('test-id-123');
  });
});

describe('exported constants', () => {
  it('uses kebab-case lowercase header name (matches Fastify req.id default)', () => {
    expect(REQUEST_ID_HEADER).toBe('x-request-id');
  });

  it('meta name matches the header so server and client read the same key', () => {
    expect(REQUEST_ID_META_NAME).toBe(REQUEST_ID_HEADER);
  });
});
