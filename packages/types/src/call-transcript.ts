import { z } from 'zod';

export interface TranscriptEvent {
  readonly id: string;
  readonly eventType: string;
  readonly timestamp: Date | string;
  readonly data: unknown;
}

export type TranscriptSpeaker = 'agent' | 'remote' | 'representative' | 'system' | 'source';

export interface SelectedTranscriptTurn {
  readonly id: string;
  readonly role: TranscriptSpeaker;
  readonly text: string;
  /** Local receipt time, not an inferred speech timestamp. */
  readonly observedAt: Date;
  readonly startOffsetSeconds: number | null;
}

export interface SelectedCallTranscript {
  readonly kind: 'final' | 'provisional' | 'legacy' | 'unavailable';
  /** Exact provider text when supplied; never reconstructed or trimmed. */
  readonly rawText: string | null;
  readonly turns: readonly SelectedTranscriptTurn[];
}

const SnapshotSchema = z.object({
  text: z.string().nullable(),
  turns: z
    .array(
      z.object({
        role: z.enum(['agent', 'user']),
        text: z.string(),
        startOffsetSeconds: z.number().nonnegative().nullable(),
      }),
    )
    .nullable(),
});

function record(data: unknown): Record<string, unknown> | null {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : null;
}

function fromSnapshot(
  event: TranscriptEvent,
  kind: 'final' | 'provisional',
): SelectedCallTranscript {
  const parsed = SnapshotSchema.safeParse(record(event.data)?.transcript);
  if (!parsed.success) return { kind, rawText: null, turns: [] };
  const { text, turns } = parsed.data;
  const observedAt = new Date(event.timestamp);
  if (turns !== null && turns.length > 0) {
    return {
      kind,
      rawText: text,
      turns: turns.map((turn, index) => ({
        id: `${event.id}:${String(index)}`,
        role: turn.role === 'user' ? 'remote' : 'agent',
        text: turn.text,
        observedAt,
        startOffsetSeconds: turn.startOffsetSeconds,
      })),
    };
  }
  return {
    kind,
    rawText: text,
    turns:
      text !== null && text.length > 0
        ? [{ id: event.id, role: 'source', text, observedAt, startOffsetSeconds: null }]
        : [],
  };
}

/**
 * Final provider transcripts replace cumulative provisional snapshots. Receipt
 * order only chooses between snapshots of the same class; it is not a provider
 * revision number. The input events remain the durable evidence for corrections.
 */
export function selectCallTranscript(events: readonly TranscriptEvent[]): SelectedCallTranscript {
  const ordered = [...events].sort((a, b) => {
    const time = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    return time || a.id.localeCompare(b.id);
  });
  const final = ordered
    .filter(
      (event) =>
        (event.eventType === 'call.ended' || event.eventType === 'webhook.call.ended') &&
        Object.prototype.hasOwnProperty.call(record(event.data) ?? {}, 'transcript'),
    )
    .at(-1);
  if (final) return fromSnapshot(final, 'final');

  const snapshot = ordered
    .filter(
      (event) =>
        event.eventType === 'call.transcript_snapshot' ||
        event.eventType === 'webhook.call.transcript_snapshot',
    )
    .at(-1);
  if (snapshot) return fromSnapshot(snapshot, 'provisional');

  // Real provider events without a final transcript cannot authorize synthetic
  // turn fallback. Legacy incremental turns exist only for the disclosed demo.
  if (ordered.some((event) => event.eventType.startsWith('webhook.call.'))) {
    return { kind: 'unavailable', rawText: null, turns: [] };
  }
  const turns: SelectedTranscriptTurn[] = [];
  for (const event of ordered) {
    if (event.eventType !== 'call.transcript') continue;
    const data = record(event.data);
    if (typeof data?.text !== 'string' || data.text.length === 0) continue;
    const rawRole = data.role;
    let role: TranscriptSpeaker;
    if (rawRole === 'agent' || rawRole === 'system' || rawRole === 'representative') role = rawRole;
    else if (rawRole === 'user') role = 'remote';
    else if (rawRole === 'rep' || rawRole === 'human') role = 'representative';
    else continue;
    turns.push({
      id: event.id,
      role,
      text: data.text,
      observedAt: new Date(event.timestamp),
      startOffsetSeconds: null,
    });
  }
  return { kind: turns.length > 0 ? 'legacy' : 'unavailable', rawText: null, turns };
}
