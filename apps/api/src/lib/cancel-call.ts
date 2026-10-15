import { audit, type Call, type CallStatus, type prisma as defaultPrisma } from '@dentabill/db';

const ACTIVE_CALL_STATUSES: CallStatus[] = [
  'INITIATED',
  'NAVIGATING_IVR',
  'ON_HOLD',
  'HUMAN_REACHED',
  'COLLECTING',
];

export interface RequestCallCancellationInput {
  readonly organizationId: string;
  readonly callId: string;
  readonly clerkUserId: string;
  readonly now?: Date;
}

export async function requestCallCancellation(
  prisma: typeof defaultPrisma,
  input: RequestCallCancellationInput,
): Promise<Call | null> {
  const { organizationId, callId, clerkUserId } = input;
  return prisma.$transaction(async (tx) => {
    const scope = { id: callId, organizationId };
    const existing = await tx.call.findFirst({ where: scope });
    if (!existing) return null;
    if (existing.cancelRequestedAt || !ACTIVE_CALL_STATUSES.includes(existing.status)) {
      return existing;
    }

    const claim = await tx.claim.findFirst({
      where: { id: existing.claimId, organizationId },
      select: { id: true, updatedAt: true },
    });
    if (!claim) return null;

    const requestedAt = input.now ?? new Date();
    const requested = await tx.call.updateMany({
      where: { ...scope, status: { in: ACTIVE_CALL_STATUSES }, cancelRequestedAt: null },
      data: { cancelRequestedAt: requestedAt, cancelRequestedBy: clerkUserId },
    });
    // A provider terminal event or another cancellation may win after the read.
    if (requested.count === 0) return tx.call.findFirst({ where: scope });

    const claimChanged = await tx.claim.updateMany({
      where: {
        id: claim.id,
        organizationId,
        status: 'CALLING',
        updatedAt: claim.updatedAt,
      },
      data: { status: 'MANUAL_REVIEW' },
    });
    await tx.callEvent.create({
      data: {
        callId,
        eventType: 'call.cancel.requested',
        timestamp: requestedAt,
        data: { requestedBy: clerkUserId, requestedAt: requestedAt.toISOString() },
      },
    });
    await audit(
      {
        organizationId,
        action: 'call.cancel.requested',
        resourceType: 'Call',
        resourceId: callId,
        metadata: {
          clerkUserId,
          previousStatus: existing.status,
          claimChanged: claimChanged.count > 0,
        },
      },
      tx,
    );
    return tx.call.findFirst({ where: scope });
  });
}
