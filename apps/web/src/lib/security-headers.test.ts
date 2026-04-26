import { describe, expect, it } from 'vitest';

import {
  buildCsp,
  cspHeaderName,
  generateNonce,
  getStaticSecurityHeaders,
} from './security-headers.js';

describe('security-headers — getStaticSecurityHeaders()', () => {
  const headers = getStaticSecurityHeaders();

  it('locks HSTS to a 2-year preload-eligible policy', () => {
    expect(headers['Strict-Transport-Security']).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );
  });

  it('forbids clickjacking via X-Frame-Options DENY', () => {
    expect(headers['X-Frame-Options']).toBe('DENY');
  });

  it('disables MIME sniffing', () => {
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('uses strict-origin-when-cross-origin Referrer-Policy', () => {
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });

  it('isolates the browsing context (COOP same-origin)', () => {
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
  });

  it('blocks credentialed cross-origin embeds (COEP credentialless)', () => {
    expect(headers['Cross-Origin-Embedder-Policy']).toBe('credentialless');
  });

  it('denies powerful APIs we never use (camera/microphone/geolocation/payment)', () => {
    const policy = headers['Permissions-Policy'];
    expect(policy).toContain('camera=()');
    expect(policy).toContain('microphone=()');
    expect(policy).toContain('geolocation=()');
    expect(policy).toContain('payment=()');
  });

  it('blocks Federated Learning of Cohorts / Topics tracking signals', () => {
    const policy = headers['Permissions-Policy'];
    expect(policy).toContain('interest-cohort=()');
    expect(policy).toContain('browsing-topics=()');
  });
});

describe('security-headers — buildCsp()', () => {
  it('embeds the supplied nonce in script-src', () => {
    const csp = buildCsp({ nonce: 'abc123==', isProd: true });
    expect(csp).toContain(`'nonce-abc123=='`);
    expect(csp).toMatch(/script-src[^;]*'nonce-abc123=='/);
  });

  it("uses 'strict-dynamic' so framework scripts can transitively load", () => {
    const csp = buildCsp({ nonce: 'n', isProd: true });
    expect(csp).toMatch(/script-src[^;]*'strict-dynamic'/);
  });

  it("includes 'unsafe-eval' in dev mode (HMR) but never in prod", () => {
    expect(buildCsp({ nonce: 'n', isProd: false })).toContain(`'unsafe-eval'`);
    expect(buildCsp({ nonce: 'n', isProd: true })).not.toContain(`'unsafe-eval'`);
  });

  it("emits 'upgrade-insecure-requests' in prod only", () => {
    expect(buildCsp({ nonce: 'n', isProd: true })).toContain('upgrade-insecure-requests');
    expect(buildCsp({ nonce: 'n', isProd: false })).not.toContain('upgrade-insecure-requests');
  });

  it("forbids being framed (frame-ancestors 'none')", () => {
    expect(buildCsp({ nonce: 'n', isProd: true })).toContain(`frame-ancestors 'none'`);
  });

  it('allows blob:/data: image and worker sources but only self for fonts/connect', () => {
    const csp = buildCsp({ nonce: 'n', isProd: true });
    expect(csp).toContain(`img-src 'self' blob: data:`);
    expect(csp).toContain(`worker-src 'self' blob:`);
    expect(csp).toContain(`font-src 'self' data:`);
    expect(csp).toContain(`connect-src 'self'`);
  });
});

describe('security-headers — cspHeaderName()', () => {
  it('enforces in prod, reports in dev', () => {
    expect(cspHeaderName(true)).toBe('Content-Security-Policy');
    expect(cspHeaderName(false)).toBe('Content-Security-Policy-Report-Only');
  });
});

describe('security-headers — generateNonce()', () => {
  it('returns a base64-encoded 16-byte payload', () => {
    const nonce = generateNonce();
    // 16 bytes -> 24 base64 chars including padding.
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it('returns a different nonce on every call (cryptographic randomness)', () => {
    const samples = new Set<string>();
    for (let i = 0; i < 32; i += 1) {
      samples.add(generateNonce());
    }
    // Collision in 32 trials of 128-bit nonces is astronomically unlikely; this
    // tests that the implementation isn't accidentally constant.
    expect(samples.size).toBe(32);
  });
});
