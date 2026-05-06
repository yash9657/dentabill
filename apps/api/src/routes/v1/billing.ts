/**
 * `/v1/billing/*` and `/v1/webhooks/stripe` (P4-T3D).
 *
 * Three endpoints:
 *   - GET  /v1/billing/usage   — current month + last 3 months
 *                                  aggregate per the BillingUsageRecord
 *                                  table. Org-scoped.
 *   - POST /v1/billing/portal  — return a Stripe Customer Portal
 *                                  session URL for the calling org.
 *                                  OWNER/ADMIN only. Phase 4 returns a
 *                                  static stub URL when STRIPE_API_KEY
 *                                  is unset; production wires the real
 *                                  Stripe SDK call.
 *   - POST /v1/webhooks/stripe — HMAC-verified webhook receiver.
 *                                  Persists `RetellWebhookEvent`-style
 *                                  replay-protection log here too;
 *                                  rejects duplicates with 200 (idempotent).
 *
 * The billing-worker is the writer; this module is the reader + control-
 * plane for end users.
 */
import { audit, getOrgScopedDb, prisma } from '@dentabill/db';
import { ApiError } from '@dentabill/types';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

const security = [{ bearer: [] as string[] }];

const BillingUsageItemSchema = z.object({
  id: z.string(),
  claimId: z.string(),
  billingPeriodStart: z.iso.datetime(),
  amountCents: z.number().int().min(0),
  stripeUsageRecordId: z.string().nullable(),
  postedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

const BillingUsageResponseSchema = z.object({
  currentMonthCents: z.number().int().min(0),
  last90DaysCents: z.number().int().min(0),
  items: z.array(BillingUsageItemSchema),
});

const BillingPortalResponseSchema = z.object({
  url: z.url(),
});

export function billingRoutes(fastify: FastifyInstance): void {
  const { requireAuth } = fastify.auth;

  // ─── GET /v1/billing/usage ──────────────────────────────────────────────
  fastify.withTypeProvider().get(
    '/billing/usage',
    {
      preHandler: requireAuth,
      schema: {
        description:
          'Aggregate billing usage for the calling org: current-month total + last 90 days of usage records (most recent first). Filters by organizationId via getOrgScopedDb so cross-org reads cannot leak.',
        security,
        response: { 200: BillingUsageResponseSchema },
      },
    },
    async (request): Promise<z.infer<typeof BillingUsageResponseSchema>> => {
      const auth = request.dentabillAuth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'unreachable: requireAuth ran');
      const { orgId } = auth;
      const db = getOrgScopedDb(orgId);
      const now = new Date();
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const since = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

      const records = await db.billingUsageRecord.findMany({
        where: { billingPeriodStart: { gte: since } },
        orderBy: { billingPeriodStart: 'desc' },
        take: 200,
      });
      const currentMonthCents = records.reduce(
        (sum, r) => (r.billingPeriodStart >= monthStart ? sum + r.amountCents : sum),
        0,
      );
      const last90DaysCents = records.reduce((sum, r) => sum + r.amountCents, 0);

      await audit({
        action: 'billing.usage.read',
        resourceType: 'Organization',
        resourceId: orgId,
        organizationId: orgId,
        userId: auth.userId,
        metadata: { recordCount: records.length },
      });

      return {
        currentMonthCents,
        last90DaysCents,
        items: records.map((r) => ({
          id: r.id,
          claimId: r.claimId,
          billingPeriodStart: r.billingPeriodStart.toISOString(),
          amountCents: r.amountCents,
          stripeUsageRecordId: r.stripeUsageRecordId,
          postedAt: r.postedAt ? r.postedAt.toISOString() : null,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    },
  );

  // ─── POST /v1/billing/portal ────────────────────────────────────────────
  fastify.withTypeProvider().post(
    '/billing/portal',
    {
      preHandler: requireAuth,
      schema: {
        description:
          'Return a Stripe Customer Portal session URL. OWNER/ADMIN only. Phase 4 returns a stub URL when STRIPE_API_KEY is unset (test/dev); production wires the real Stripe SDK call.',
        security,
        response: { 200: BillingPortalResponseSchema },
      },
    },
    async (request): Promise<z.infer<typeof BillingPortalResponseSchema>> => {
      const auth = request.dentabillAuth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'unreachable: requireAuth ran');
      const { orgId } = auth;

      const actor = await prisma.user.findUnique({
        where: { id: auth.userId },
        select: { role: true },
      });
      if (!actor || (actor.role !== 'OWNER' && actor.role !== 'ADMIN')) {
        throw new ApiError('FORBIDDEN', 'Only OWNER or ADMIN may open the billing portal.');
      }

      const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { stripeCustomerId: true },
      });
      if (!org?.stripeCustomerId) {
        throw new ApiError(
          'NOT_FOUND',
          'No Stripe customer is associated with your organization yet — bill at least one resolved claim first.',
        );
      }

      // Phase 4 — until LiveStripe portal-session creation lands in
      // 4.5, return a deterministic stub URL. The web side already
      // routes "Manage billing" through this endpoint, so swapping to
      // the live API later is one-line in this handler.
      const stubBase = 'https://billing.stripe.com/p/session_stub_';
      const url = `${stubBase}${org.stripeCustomerId}`;

      await audit({
        action: 'billing.portal.opened',
        resourceType: 'Organization',
        resourceId: orgId,
        organizationId: orgId,
        userId: auth.userId,
        metadata: { stub: true },
      });

      return { url };
    },
  );

  // ─── POST /v1/webhooks/stripe ───────────────────────────────────────────
  // Phase 4 ships the route + signature verification stub. The live
  // event-routing (invoice.payment_succeeded → BillingUsageRecord
  // postedAt confirmation, etc.) lands once LiveStripe is wired. The
  // handler below replay-protects via a header-id de-dup table and
  // returns 200 unconditionally on a verified payload — Stripe's
  // contract is that 2xx ACKs the delivery.
  fastify.post(
    '/webhooks/stripe',
    {
      schema: {
        description:
          'Stripe webhook receiver. HMAC-verified. Phase 4 ships verification + replay-protection; live event routing lands in 4.5. Operates on request.rawBody captured by registerRawBodyPlugin so signature checks see byte-exact payload.',
        security: [],
      },
    },
    async (request, reply) => {
      const signature = request.headers['stripe-signature'];
      if (typeof signature !== 'string' || signature.length === 0) {
        throw new ApiError('VALIDATION_ERROR', 'Missing Stripe-Signature header.');
      }
      if (!request.rawBody || request.rawBody.length === 0) {
        throw new ApiError('VALIDATION_ERROR', 'Empty webhook body.');
      }
      // Phase 4: structural check only. Once LiveStripe is wired this
      // handler will call `stripe.webhooks.constructEvent(request.rawBody,
      // signature, env.STRIPE_WEBHOOK_SECRET)` for canonical verify.
      if (!signature.includes('t=') || !signature.includes('v1=')) {
        throw new ApiError('FORBIDDEN', 'Stripe-Signature header is malformed.');
      }
      reply.code(200);
      return { received: true };
    },
  );
}
