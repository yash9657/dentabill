import { prisma } from '@dentabill/db';
import {
  acceptRetellWebhook,
  parseRetellWebhookEnvelope,
  RetellWebhookConflictError,
  RetellWebhookParseError,
  verifyRetellWebhookSignature,
} from '@dentabill/payer-ivr';
import { ApiError } from '@dentabill/types';
import type { FastifyInstance } from 'fastify';

import { getEnv } from '../../lib/env.js';

export function retellWebhookRoutes(fastify: FastifyInstance): void {
  // Keep provider JSON opaque until signature verification. The global JSON
  // parser can otherwise include source text in a SyntaxError before we run.
  fastify.removeContentTypeParser('application/json');
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (request, body: Buffer, done) => {
      request.rawBody = body;
      done(null, body);
    },
  );
  fastify.post('/webhooks/retell', async (request, reply) => {
    const rawBody = request.rawBody;
    if (rawBody === undefined || rawBody.length === 0) {
      throw new ApiError('VALIDATION_ERROR', 'Empty webhook body.');
    }
    const signature = request.headers['x-retell-signature'];
    if (
      typeof signature !== 'string' ||
      !verifyRetellWebhookSignature({
        rawBody,
        signature,
        secret: getEnv().RETELL_WEBHOOK_SECRET ?? '',
      })
    ) {
      throw new ApiError('WEBHOOK_SIGNATURE_INVALID', 'Webhook signature did not match.');
    }
    try {
      const delivery = parseRetellWebhookEnvelope(rawBody);
      const result = await acceptRetellWebhook(prisma, delivery);
      // The database is authoritative; SSE loss is recovered by scoped event replay.
      for (const event of result.events) {
        try {
          await fastify.callEventsPublisher?.publish(
            `call:${delivery.retellCallId}:events`,
            JSON.stringify({
              type: delivery.event?.type,
              callEventId: event.id,
              retellCallId: delivery.retellCallId,
              timestamp: event.timestamp.toISOString(),
              data: event.data,
            }),
          );
        } catch {
          request.log.warn(
            { eventId: delivery.eventId },
            'Retell SSE publish failed; replay required',
          );
        }
      }
      request.log.info(
        { supported: delivery.event !== null, pending: result.pending, replayed: result.replayed },
        'Retell webhook accepted',
      );
      reply.code(result.pending ? 202 : 200);
      return {
        ok: true,
        ...(result.replayed ? { replayed: true } : {}),
        ...(result.pending ? { pending: true } : {}),
        ...(delivery.event === null ? { ignored: 'unsupported_event' } : {}),
      };
    } catch (error) {
      if (error instanceof RetellWebhookParseError)
        throw new ApiError('VALIDATION_ERROR', error.message);
      if (error instanceof RetellWebhookConflictError)
        throw new ApiError('CONFLICT', error.message);
      request.log.error(
        { errorType: error instanceof Error ? error.name : 'unknown' },
        'Retell inbox operation failed',
      );
      throw new ApiError('INTERNAL_ERROR', 'Retell webhook could not be persisted.');
    }
  });
}
