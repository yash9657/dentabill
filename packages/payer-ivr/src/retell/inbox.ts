import { createHash } from 'node:crypto';

import { Prisma, type CallEvent, type prisma } from '@dentabill/db';

import { RetellCallEndReason } from './events.js';
import { RetellWebhookDeliverySchema, type RetellWebhookDelivery } from './webhook.js';

type Db = typeof prisma;
type Transaction = Omit<
  Db,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
interface InboxResult {
  replayed: boolean;
  pending: boolean;
  events: CallEvent[];
}

export class RetellWebhookConflictError extends Error {
  override readonly name = 'RetellWebhookConflictError';
  constructor() {
    super('Retell lifecycle event conflicts with previously accepted evidence.');
  }
}

export async function acceptRetellWebhook(
  db: Db,
  delivery: RetellWebhookDelivery,
): Promise<InboxResult> {
  const normalized = RetellWebhookDeliverySchema.parse(delivery);
  const payloadHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  return db.$transaction(async (tx) => {
    await tx.retellWebhookEvent.createMany({
      data: {
        eventId: normalized.eventId,
        retellCallId: normalized.retellCallId,
        eventType: normalized.eventType,
        payload: normalized as Prisma.InputJsonObject,
        payloadHash,
      },
      skipDuplicates: true,
    });
    const row = await tx.retellWebhookEvent.findUniqueOrThrow({
      where: { eventId: normalized.eventId },
    });
    if (row.payloadHash !== null && row.payloadHash !== payloadHash)
      throw new RetellWebhookConflictError();
    if (row.processedAt !== null) return { replayed: true, pending: false, events: [] };
    return processDelivery(tx, normalized);
  });
}

/** Reconcile only against the call/tenant binding established by the dial runtime. */
export async function reconcileRetellWebhookInbox(
  db: Db,
  binding: {
    organizationId: string;
    callId: string;
    retellCallId: string;
  },
): Promise<void> {
  await db.$transaction(async (tx) => {
    const call = await tx.call.findFirst({
      where: {
        id: binding.callId,
        organizationId: binding.organizationId,
        retellCallId: binding.retellCallId,
      },
      select: { id: true },
    });
    if (!call) return;
    const rows = await tx.retellWebhookEvent.findMany({
      where: { retellCallId: binding.retellCallId, processedAt: null },
      orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    for (const row of rows) {
      const delivery = RetellWebhookDeliverySchema.safeParse(row.payload);
      if (!delivery.success) throw new Error('Invalid persisted Retell inbox payload.');
      await processDelivery(tx, delivery.data);
    }
  });
}

async function processDelivery(
  tx: Transaction,
  delivery: RetellWebhookDelivery,
): Promise<InboxResult> {
  if (delivery.event === null) {
    const claimed = await tx.retellWebhookEvent.updateMany({
      where: { eventId: delivery.eventId, processedAt: null },
      data: { processedAt: new Date(), payload: Prisma.DbNull },
    });
    return { replayed: claimed.count === 0, pending: false, events: [] };
  }
  // The account-level signature proves provider origin, not tenant identity.
  // Ignore all supplied metadata and bind through our unique provider call ID.
  const call = await tx.call.findUnique({
    where: { retellCallId: delivery.retellCallId },
    select: { id: true, organizationId: true },
  });
  if (!call) return { replayed: false, pending: true, events: [] };
  const claimed = await tx.retellWebhookEvent.updateMany({
    where: { eventId: delivery.eventId, processedAt: null },
    data: { processedAt: new Date(), organizationId: call.organizationId, payload: Prisma.DbNull },
  });
  if (!claimed.count) return { replayed: true, pending: false, events: [] };
  const event = delivery.event;
  const saved = await tx.callEvent.create({
    data: {
      callId: call.id,
      eventType: `webhook.${event.type}`,
      data: event as Prisma.InputJsonObject,
    },
  });
  if (event.type === 'call.ended') {
    await tx.call.updateMany({
      where: { id: call.id, organizationId: call.organizationId },
      data: {
        endedAt: event.endedAt === null ? null : new Date(event.endedAt),
        durationSeconds: event.durationSeconds,
        ...(event.startedAt === undefined ? {} : { startedAt: new Date(event.startedAt) }),
      },
    });
    await tx.call.updateMany({
      where: {
        id: call.id,
        organizationId: call.organizationId,
        status: { notIn: ['COMPLETED', 'FAILED', 'VOICEMAIL'] },
      },
      data: {
        status: endReasonToStatus(event.endReason),
      },
    });
  } else if (event.type === 'call.started') {
    await tx.call.updateMany({
      where: { id: call.id, organizationId: call.organizationId },
      data: { startedAt: new Date(event.startedAt) },
    });
    await tx.call.updateMany({
      where: { id: call.id, organizationId: call.organizationId, status: 'INITIATED' },
      data: { status: 'NAVIGATING_IVR' },
    });
  }
  await tx.auditLog.create({
    data: {
      organizationId: call.organizationId,
      action: 'call.webhook.accepted',
      resourceType: 'Call',
      resourceId: call.id,
      metadata: { eventId: delivery.eventId, eventType: delivery.eventType },
    },
  });
  return { replayed: false, pending: false, events: [saved] };
}

function endReasonToStatus(reason: string): 'COMPLETED' | 'FAILED' | 'VOICEMAIL' {
  switch (reason) {
    case RetellCallEndReason.COMPLETED:
    case RetellCallEndReason.AGENT_HANGUP:
    case RetellCallEndReason.USER_HANGUP:
      return 'COMPLETED';
    case RetellCallEndReason.NO_ANSWER:
    case RetellCallEndReason.BUSY:
    case RetellCallEndReason.VOICEMAIL:
      return 'VOICEMAIL';
    default:
      return 'FAILED';
  }
}
