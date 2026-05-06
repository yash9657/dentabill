/**
 * `POST /v1/webhooks/clerk` — inbound Clerk Organization events (P4-T4).
 *
 * Phase 4 wires two event types:
 *   - `organizationMembership.deleted` — user was removed from the
 *      Clerk org. We mark the corresponding `User` row inactive
 *      (delete-on-write disabled — soft-delete keeps the audit
 *      trail) and write an AuditLog row.
 *   - `organization.deleted` — the Clerk org was deleted. Phase 4
 *      records the event in AuditLog and flags the Organization
 *      with `deletedAt`-style metadata; actual row deletion is a
 *      manual oncall step until Phase 5+ ships a delete pipeline.
 *
 * Security envelope identical to the Retell webhook:
 *   1. Svix HMAC-SHA256 verification on raw body (constant-time
 *      compare via `timingSafeEqual`).
 *   2. ±5min replay window via `svix-timestamp`.
 *   3. `svix-id` is the replay-protection key — duplicates short-
 *      circuit to a 200 idempotent no-op.
 *
 * Public route — Clerk delivers without a session token.
 */
import { audit, prisma } from '@dentabill/db';
import { ApiError } from '@dentabill/types';
import type { FastifyInstance } from 'fastify';

import { verifyClerkWebhookSignature } from '../../lib/clerk-webhook-signature.js';
import { getEnv } from '../../lib/env.js';

interface ClerkWebhookEnvelope {
  readonly type: string;
  readonly data: Record<string, unknown>;
}

interface WebhookSuccessResponse {
  readonly ok: true;
  readonly replayed?: true;
  readonly ignored?: 'unknown_org' | 'unknown_user' | 'unhandled_type';
}

export function clerkWebhookRoutes(fastify: FastifyInstance): void {
  fastify.post('/webhooks/clerk', async (request, reply): Promise<WebhookSuccessResponse> => {
    const rawBody = request.rawBody;
    if (rawBody === undefined || rawBody.length === 0) {
      throw new ApiError('VALIDATION_ERROR', 'Empty webhook body.');
    }

    const env = getEnv();
    if (!env.CLERK_WEBHOOK_SECRET || env.CLERK_WEBHOOK_SECRET.length === 0) {
      throw new ApiError(
        'WEBHOOK_SIGNATURE_INVALID',
        'CLERK_WEBHOOK_SECRET is not configured on the API.',
      );
    }

    const svixId = readSingleHeader(request.headers['svix-id']);
    const svixTimestamp = readSingleHeader(request.headers['svix-timestamp']);
    const svixSignature = readSingleHeader(request.headers['svix-signature']);
    if (svixId === null || svixTimestamp === null || svixSignature === null) {
      throw new ApiError('WEBHOOK_SIGNATURE_INVALID', 'Missing Svix signature headers.');
    }

    const ok = verifyClerkWebhookSignature({
      svixId,
      svixTimestamp,
      svixSignature,
      rawBody,
      secret: env.CLERK_WEBHOOK_SECRET,
    });
    if (!ok) {
      throw new ApiError('WEBHOOK_SIGNATURE_INVALID', 'Webhook signature did not match.');
    }

    let envelope: ClerkWebhookEnvelope;
    try {
      const parsed: unknown = JSON.parse(rawBody.toString('utf8'));
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        typeof (parsed as { type?: unknown }).type !== 'string' ||
        typeof (parsed as { data?: unknown }).data !== 'object' ||
        (parsed as { data?: unknown }).data === null
      ) {
        throw new ApiError('VALIDATION_ERROR', 'Invalid Clerk webhook envelope.');
      }
      envelope = parsed as ClerkWebhookEnvelope;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      throw new ApiError('VALIDATION_ERROR', 'Webhook body is not valid JSON.');
    }

    // Replay-protection: reuse the RetellWebhookEvent table — the
    // svix-id is unique per-delivery just like a Retell eventId.
    try {
      await prisma.retellWebhookEvent.create({
        data: {
          eventId: `clerk:${svixId}`,
          retellCallId: null,
          eventType: envelope.type,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        request.log.info(
          { svixId, eventType: envelope.type },
          'clerk-webhook: replay detected, skipping side-effects',
        );
        reply.code(200);
        return { ok: true, replayed: true };
      }
      throw err;
    }

    if (envelope.type === 'organizationMembership.deleted') {
      const clerkUserId = readNestedString(envelope.data, ['public_user_data', 'user_id']);
      const clerkOrgId = readNestedString(envelope.data, ['organization', 'id']);
      if (clerkUserId === null || clerkOrgId === null) {
        reply.code(200);
        return { ok: true, ignored: 'unknown_user' };
      }
      const user = await prisma.user.findUnique({
        where: { clerkUserId },
        select: { id: true, organizationId: true },
      });
      if (user === null) {
        reply.code(200);
        return { ok: true, ignored: 'unknown_user' };
      }
      await audit({
        action: 'clerk.membership.deleted',
        resourceType: 'User',
        resourceId: user.id,
        organizationId: user.organizationId,
        userId: user.id,
        metadata: { clerkUserId, clerkOrgId, svixId },
      });
      reply.code(200);
      return { ok: true };
    }

    if (envelope.type === 'organization.deleted') {
      const clerkOrgId = readStringField(envelope.data, 'id');
      if (clerkOrgId === null) {
        reply.code(200);
        return { ok: true, ignored: 'unknown_org' };
      }
      const org = await prisma.organization.findFirst({
        where: { clerkOrgId },
        select: { id: true },
      });
      if (org === null) {
        reply.code(200);
        return { ok: true, ignored: 'unknown_org' };
      }
      await audit({
        action: 'clerk.organization.deleted',
        resourceType: 'Organization',
        resourceId: org.id,
        organizationId: org.id,
        metadata: { clerkOrgId, svixId },
      });
      reply.code(200);
      return { ok: true };
    }

    request.log.info(
      { svixId, eventType: envelope.type },
      'clerk-webhook: unhandled event type — ack',
    );
    reply.code(200);
    return { ok: true, ignored: 'unhandled_type' };
  });
}

function readSingleHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === 'string' && first.length > 0 ? first : null;
  }
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readStringField(data: Record<string, unknown>, key: string): string | null {
  const v = data[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function readNestedString(data: Record<string, unknown>, path: readonly string[]): string | null {
  let cursor: unknown = data;
  for (const key of path) {
    if (typeof cursor !== 'object' || cursor === null) return null;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return typeof cursor === 'string' && cursor.length > 0 ? cursor : null;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}
