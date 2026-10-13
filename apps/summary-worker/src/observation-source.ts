import { createHash } from 'node:crypto';

import type { prisma } from '@dentabill/db';
import type { GatewayRequest } from '@dentabill/model-gateway';
import { selectCallTranscript } from '@dentabill/types';

type Source = GatewayRequest['sources'][number];

/** Bind a source to one durable final event and its exact text, not caller-supplied labels. */
export async function isStoredObservationSource(
  db: typeof prisma,
  callId: string,
  request: GatewayRequest,
  requireLatest: boolean,
): Promise<boolean> {
  if (request.sources.length !== 1) return false;
  const source = request.sources[0];
  if (!source?.id.startsWith('transcript.')) return false;
  const events = await db.callEvent.findMany({
    where: {
      callId,
      call: { organizationId: request.organizationId, claimId: request.claim.id },
      eventType: { in: ['call.ended', 'webhook.call.ended'] },
      ...(!requireLatest ? { id: source.id.slice('transcript.'.length) } : {}),
    },
    orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
  });
  const event = events.find((candidate) =>
    Object.prototype.hasOwnProperty.call(candidate.data ?? {}, 'transcript'),
  );
  if (!event || source.id !== `transcript.${event.id}`) return false;
  const transcript = selectCallTranscript([event]);
  return (
    transcript.kind === 'final' &&
    transcript.rawText !== null &&
    transcript.rawText.trim().length > 0 &&
    source.text === transcript.rawText &&
    source.version === observationSourceVersion(transcript.rawText)
  );
}

export function observationSourceVersion(text: Source['text']): string {
  return createHash('sha256').update(text).digest('hex');
}
