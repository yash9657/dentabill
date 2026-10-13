import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  parseRetellWebhookEnvelope,
  RetellWebhookParseError,
  verifyRetellWebhookSignature,
} from '@dentabill/payer-ivr';
import { symmetric } from 'retell-sdk/lib/webhook_auth.js';
import { describe, expect, it } from 'vitest';

const TEST_SIGNING_KEY = 'synthetic-retell-webhook-signing-key';
const SIGNED_AT = Date.UTC(2026, 9, 13, 12);
const FIVE_MINUTES_MS = 5 * 60 * 1000;

const fixtures = [
  { name: 'call_started', internalType: 'call.started' },
  { name: 'call_ended', internalType: 'call.ended' },
].map((fixture) => ({
  ...fixture,
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- names come only from the two literal fixtures above
  rawBody: readFileSync(new URL(`../fixtures/retell/${fixture.name}.json`, import.meta.url)),
}));

describe.each(fixtures)('Retell documented $name envelope — synthetic, SDK 5.16.0', (fixture) => {
  it('verifies the exact fixture bytes signed by the installed SDK', async () => {
    const bodyText = fixture.rawBody.toString('utf8');
    const signature = await symmetric.sign(bodyText, TEST_SIGNING_KEY, SIGNED_AT);

    expect(
      await symmetric.verify(bodyText, TEST_SIGNING_KEY, signature, { timestamp: SIGNED_AT }),
    ).toBe(true);
    expect(
      verifyRetellWebhookSignature(
        { rawBody: fixture.rawBody, signature, secret: TEST_SIGNING_KEY },
        { now: SIGNED_AT },
      ),
    ).toBe(true);
  });

  it('rejects a one-byte payload mutation after signing', async () => {
    const original = fixture.rawBody.toString('utf8');
    const signature = await symmetric.sign(original, TEST_SIGNING_KEY, SIGNED_AT);
    const tampered = original.replace('"agent_version": 1', '"agent_version": 2');
    expect(Buffer.byteLength(tampered)).toBe(fixture.rawBody.length);
    expect(tampered).not.toBe(original);

    expect(
      verifyRetellWebhookSignature(
        { rawBody: Buffer.from(tampered), signature, secret: TEST_SIGNING_KEY },
        { now: SIGNED_AT },
      ),
    ).toBe(false);
  });

  it('rejects reserialized JSON even though its parsed value is unchanged', async () => {
    const original = fixture.rawBody.toString('utf8');
    const parsed: unknown = JSON.parse(original);
    const reserialized = JSON.stringify(parsed);
    const signature = await symmetric.sign(original, TEST_SIGNING_KEY, SIGNED_AT);
    expect(reserialized).not.toBe(original);
    expect(JSON.parse(reserialized)).toEqual(parsed);

    expect(
      verifyRetellWebhookSignature(
        { rawBody: reserialized, signature, secret: TEST_SIGNING_KEY },
        { now: SIGNED_AT },
      ),
    ).toBe(false);
  });

  it('rejects an unrelated signing key and a timestamp outside the SDK replay window', async () => {
    const signature = await symmetric.sign(
      fixture.rawBody.toString('utf8'),
      TEST_SIGNING_KEY,
      SIGNED_AT,
    );
    expect(
      verifyRetellWebhookSignature(
        { rawBody: fixture.rawBody, signature, secret: 'unrelated-test-key' },
        { now: SIGNED_AT },
      ),
    ).toBe(false);
    expect(
      verifyRetellWebhookSignature(
        { rawBody: fixture.rawBody, signature, secret: TEST_SIGNING_KEY },
        { now: SIGNED_AT + FIVE_MINUTES_MS + 1 },
      ),
    ).toBe(false);
  });

  it('reproduces FW06: the route parser requires fields absent from the documented envelope', () => {
    const parsed: unknown = JSON.parse(fixture.rawBody.toString('utf8'));
    expect(parsed).toMatchObject({
      event: fixture.name,
      call: { call_id: 'call_synthetic_contract_01' },
    });
    expect(parsed).not.toHaveProperty('eventId');
    expect(parsed).not.toHaveProperty('deliveredAt');
    expect(() => parseRetellWebhookEnvelope(fixture.rawBody)).toThrow(RetellWebhookParseError);
    expect(() => parseRetellWebhookEnvelope(fixture.rawBody)).toThrow(
      /eventId: Required; deliveredAt: Required; event: Expected object, received string/,
    );
  });

  // FW07 is unimplemented. An unexpected pass forces removal of this marker
  // and replacement of the mismatch diagnosis above after a real normalizer lands.
  it.fails('FW07 BLOCKED: normalizes the documented raw envelope into an internal event', () => {
    const envelope = parseRetellWebhookEnvelope(fixture.rawBody);
    expect(envelope.event.type).toBe(fixture.internalType);
    expect(envelope.event.retellCallId).toBe('call_synthetic_contract_01');
  });
});

describe('Legacy fixture signing — not the documented Retell wire contract', () => {
  it('retains the existing plain-hex verifier path without treating it as provider evidence', () => {
    const rawBody = '{"localFixture":true}';
    const signature = createHmac('sha256', TEST_SIGNING_KEY).update(rawBody).digest('hex');
    expect(verifyRetellWebhookSignature({ rawBody, signature, secret: TEST_SIGNING_KEY })).toBe(
      true,
    );
  });
});
