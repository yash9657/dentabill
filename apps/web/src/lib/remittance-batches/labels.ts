import type { BatchEvidence } from './use-remittance-batches.js';

export function batchSequenceLabel(sequence: number | null): string {
  return sequence === null ? 'Unsequenced baseline' : `Source sequence ${String(sequence)}`;
}
export function batchRevisionLabel(evidence: BatchEvidence): string {
  return `${batchSequenceLabel(evidence.revision.sourceSequence)} (v${String(evidence.revision.schemaVersion)})`;
}
export function batchCurrentnessLabel(evidence: BatchEvidence): string {
  if (evidence.review?.decision === 'ACCEPT')
    return evidence.revision.isCurrentAccepted
      ? 'Current accepted revision'
      : 'Stale accepted revision';
  const position = evidence.revision.isLatest ? 'Latest observed' : 'Older observation';
  return `${position} · ${evidence.review?.decision === 'REJECT' ? 'Rejected' : 'Awaiting review'}`;
}
