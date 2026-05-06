import { createHmac } from 'crypto';

import { describe, expect, it } from 'vitest';

import { verifyClerkWebhookSignature } from './clerk-webhook-signature.js';

const RAW_SECRET = Buffer.from('clerk-webhook-test-secret-12345').toString('base64');
const SECRET = `whsec_${RAW_SECRET}`;

function sign(payload: { id: string; ts: string; body: Buffer }): string {
  const decoded = Buffer.from(RAW_SECRET, 'base64');
  const signed = Buffer.concat([Buffer.from(`${payload.id}.${payload.ts}.`, 'utf8'), payload.body]);
  return `v1,${createHmac('sha256', decoded).update(signed).digest('base64')}`;
}

describe('verifyClerkWebhookSignature', () => {
  const body = Buffer.from('{"type":"organization.deleted","data":{"id":"org_x"}}', 'utf8');
  const now = 1_750_000_000;
  const ts = String(now);

  it('accepts a correctly signed envelope', () => {
    const signature = sign({ id: 'evt_abc', ts, body });
    expect(
      verifyClerkWebhookSignature({
        svixId: 'evt_abc',
        svixTimestamp: ts,
        svixSignature: signature,
        rawBody: body,
        secret: SECRET,
        nowSeconds: now,
      }),
    ).toBe(true);
  });

  it('rejects a tampered body', () => {
    const signature = sign({ id: 'evt_abc', ts, body });
    expect(
      verifyClerkWebhookSignature({
        svixId: 'evt_abc',
        svixTimestamp: ts,
        svixSignature: signature,
        rawBody: Buffer.from('{"tampered":true}', 'utf8'),
        secret: SECRET,
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it('rejects a wrong svix-id (signed-content prefix mismatch)', () => {
    const signature = sign({ id: 'evt_abc', ts, body });
    expect(
      verifyClerkWebhookSignature({
        svixId: 'evt_other',
        svixTimestamp: ts,
        svixSignature: signature,
        rawBody: body,
        secret: SECRET,
        nowSeconds: now,
      }),
    ).toBe(false);
  });

  it('rejects when timestamp is outside the ±5min window', () => {
    const signature = sign({ id: 'evt_abc', ts, body });
    expect(
      verifyClerkWebhookSignature({
        svixId: 'evt_abc',
        svixTimestamp: ts,
        svixSignature: signature,
        rawBody: body,
        secret: SECRET,
        nowSeconds: now + 6 * 60,
      }),
    ).toBe(false);
  });

  it('accepts when one of multiple v1 signatures matches (rotation)', () => {
    const good = sign({ id: 'evt_abc', ts, body });
    const noise = 'v1,deadbeefcafe';
    expect(
      verifyClerkWebhookSignature({
        svixId: 'evt_abc',
        svixTimestamp: ts,
        svixSignature: `${noise} ${good}`,
        rawBody: body,
        secret: SECRET,
        nowSeconds: now,
      }),
    ).toBe(true);
  });

  it('rejects when the secret is empty', () => {
    expect(
      verifyClerkWebhookSignature({
        svixId: 'evt_abc',
        svixTimestamp: ts,
        svixSignature: 'v1,deadbeef',
        rawBody: body,
        secret: '',
        nowSeconds: now,
      }),
    ).toBe(false);
  });
});
