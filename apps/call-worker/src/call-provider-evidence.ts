import { createHash } from 'node:crypto';

import type { CallIntent } from '@dentabill/db';
import {
  StartCallInputSchema,
  type RetellCallCandidate,
  type StartCallInput,
} from '@dentabill/payer-ivr';

/** Match the provider identity against the exact saved submission, never current settings. */
export function matchesCallCandidate(
  candidate: RetellCallCandidate,
  snapshot: StartCallInput,
): boolean {
  return (
    candidate.providerCallId.length > 0 &&
    candidate.intentId === snapshot.idempotencyKey &&
    candidate.callType === 'phone_call' &&
    candidate.direction === 'outbound' &&
    candidate.agentId === snapshot.agentId &&
    candidate.fromNumberE164 === snapshot.fromNumberE164 &&
    candidate.toNumberE164 === snapshot.toNumberE164 &&
    (candidate.startedAt === null || Number.isFinite(Date.parse(candidate.startedAt)))
  );
}

export function getCallIntentSnapshot(
  intent: Pick<CallIntent, 'id' | 'payerCode' | 'requestPayload' | 'requestHash'>,
): StartCallInput | null {
  const parsed = StartCallInputSchema.safeParse(intent.requestPayload);
  if (!parsed.success) return null;
  // Parse restores the versioned submission field order after Postgres JSONB normalization.
  const snapshot = parsed.data;
  return snapshot.idempotencyKey === intent.id &&
    snapshot.payerCode === intent.payerCode &&
    createHash('sha256').update(JSON.stringify(snapshot)).digest('hex') === intent.requestHash
    ? snapshot
    : null;
}
