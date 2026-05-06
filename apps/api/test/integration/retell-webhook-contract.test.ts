/**
 * P4-T7-prep-6 / W7-prep-6 — Retell webhook signature contract test.
 *
 * Asserts that DentaBill's hand-rolled `verifyRetellWebhookSignature`
 * accepts a payload signed by Retell's own SDK helper. Catches drift
 * between our signature format and Retell's published format — which
 * would otherwise manifest as "every Retell webhook fails 401" in
 * production with no test coverage.
 *
 * The Retell SDK exposes `sign(body, apiKey)` (`webhook_auth.js`).
 * Their format embeds a timestamp + symmetric HMAC-SHA256 with the
 * webhook secret. Our `verifyRetellWebhookSignature` accepts the
 * raw hex digest without timestamp parsing.
 *
 * If this test fails, the fix is in `verifyRetellWebhookSignature` —
 * align with the SDK's wire format. Until then, the test is a green
 * proof-of-parity for whatever overlap exists; on mismatch it converts
 * to a TODO with an explicit reason.
 */
import { verifyRetellWebhookSignature } from '@dentabill/payer-ivr';
import { describe, expect, it } from 'vitest';

const SECRET = 'whsec_test_secret_long_enough';
const BODY = JSON.stringify({
  event: 'call_started',
  data: { id: 'test-call-id', startedAt: '2026-05-06T00:00:00.000Z' },
});

describe('Retell webhook signature — SDK ↔ verify parity', () => {
  it('our verifyRetellWebhookSignature accepts plain hex HMAC-SHA256 (current contract)', async () => {
    // Hand-roll a signature in the format our verifier expects so the
    // contract test pins the current happy-path. If we later switch to
    // a timestamped scheme, this test fails and forces a rev.
    const { createHmac } = await import('node:crypto');
    const sig = createHmac('sha256', SECRET).update(BODY).digest('hex');
    expect(verifyRetellWebhookSignature({ rawBody: BODY, signature: sig, secret: SECRET })).toBe(
      true,
    );
  });

  it('cross-checks against the Retell SDK sign() helper', async () => {
    // The SDK helper is async + may use a timestamp envelope. We probe
    // the format and either:
    //   (a) the SDK's signature parses with our verifier — perfect parity, or
    //   (b) it does not — record the gap so the next iteration tightens
    //       verifyRetellWebhookSignature to match.
    const { sign } = await import('retell-sdk/lib/webhook_auth.js');
    const sdkSig = await sign(BODY, SECRET);
    const accepted = verifyRetellWebhookSignature({
      rawBody: BODY,
      signature: sdkSig,
      secret: SECRET,
    });
    // The contract is one of the two outcomes. We assert TRUE — if the
    // upstream format diverges, the assertion fires and someone writes
    // a one-PR fix. This is exactly the contract this test is here for.
    if (!accepted) {
      process.stderr.write(
        `Retell SDK signature format differs from verifyRetellWebhookSignature. shape=${sdkSig.slice(0, 32)}\n`,
      );
    }
    // Soft-fail behaviour — the test fails so the gap is visible, but
    // the message is actionable rather than cryptic.
    expect(accepted, 'verify(SDK.sign(body)) should accept; if false, align webhook.ts').toBe(true);
  });
});
