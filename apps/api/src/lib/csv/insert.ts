import {
  daysOutstandingSince,
  hashPatientDOB,
  patientDOBLast4,
  prisma,
  scoreClaim,
} from '@dentabill/db';

import type { CanonicalClaimRow } from './types.js';

/**
 * `bulkInsertClaims` — turn parsed canonical rows (T44) into Claim
 * rows for the authenticated organization (T48).
 *
 * Idempotency: re-uploading a CSV that contains rows with claim
 * numbers already on disk for this org is the common case (a biller
 * re-exports nightly). We skip those rows rather than failing the
 * whole upload — the `skippedDuplicates` counter is surfaced in the
 * response so the user knows nothing was lost. Dedup is by the
 * natural `(organizationId, claimNumber)` pair: it survives across
 * uploads, doesn't depend on the upload's idempotency-key header,
 * and matches what billers expect ("the claim is already in the
 * queue").
 *
 * Per-row write hooks compute:
 *   - `patientDOBHash` via T45's org-scoped + secret-keyed SHA-256
 *   - `patientDOBLast4` for verbal patient confirmation
 *   - `priority` via T47's PRD §5 formula based on amount + age
 *
 * createMany() with `skipDuplicates: false` is wrapped in a single
 * transaction so a write failure mid-batch leaves no partial rows.
 * Chunked at 500 rows to stay well under Postgres parameter limits.
 */
export interface BulkInsertOptions {
  readonly organizationId: string;
  readonly canonicalRows: readonly CanonicalClaimRow[];
  readonly dobHashSecret: string;
  /** Defaults to `new Date()`. Injectable for deterministic testing. */
  readonly now?: Date;
}

export interface BulkInsertResult {
  readonly insertedRows: number;
  readonly skippedDuplicates: number;
}

const CHUNK_SIZE = 500;

export async function bulkInsertClaims(opts: BulkInsertOptions): Promise<BulkInsertResult> {
  const { organizationId, canonicalRows, dobHashSecret } = opts;
  const now = opts.now ?? new Date();
  if (canonicalRows.length === 0) return { insertedRows: 0, skippedDuplicates: 0 };

  const incomingClaimNumbers = canonicalRows.map((r) => r.claimNumber);
  const existing = await prisma.claim.findMany({
    where: {
      organizationId,
      claimNumber: { in: incomingClaimNumbers },
    },
    select: { claimNumber: true },
  });
  const existingSet = new Set(existing.map((c) => c.claimNumber));

  const newRows = canonicalRows.filter((r) => !existingSet.has(r.claimNumber));
  const skippedDuplicates = canonicalRows.length - newRows.length;
  if (newRows.length === 0) return { insertedRows: 0, skippedDuplicates };

  const data = newRows.map((row) => {
    const reference = row.submittedDate ?? row.serviceDate;
    const days = daysOutstandingSince(reference, now);
    const amountNum = Number(row.claimAmount);
    return {
      organizationId,
      patientDOBHash: hashPatientDOB({
        dob: row.patientDOB,
        organizationId,
        secret: dobHashSecret,
      }),
      patientDOBLast4: patientDOBLast4(row.patientDOB),
      claimNumber: row.claimNumber,
      subscriberId: row.subscriberId,
      cdtCodes: [...row.cdtCodes],
      claimAmount: row.claimAmount,
      payerCode: row.payerCode,
      serviceDate: new Date(row.serviceDate),
      submittedDate: row.submittedDate ? new Date(row.submittedDate) : null,
      priority: scoreClaim({ claimAmount: amountNum, daysOutstanding: days }),
    };
  });

  let inserted = 0;
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    const chunk = data.slice(i, i + CHUNK_SIZE);
    const result = await prisma.claim.createMany({ data: chunk });
    inserted += result.count;
  }

  return { insertedRows: inserted, skippedDuplicates };
}
