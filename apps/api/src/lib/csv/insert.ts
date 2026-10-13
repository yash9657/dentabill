import { createHmac, randomUUID } from 'node:crypto';

import {
  audit,
  daysOutstandingSince,
  hashPatientDOB,
  patientDOBLast4,
  prisma,
  scoreClaim,
  type Prisma,
} from '@dentabill/db';
import { ApiError } from '@dentabill/types';
import { z } from 'zod';

import { CsvChildLimitError, MAX_IMPORT_CHILDREN } from './source-details.js';
import {
  MAX_IMPORT_ROWS,
  SUPPORTED_CSV_SOURCES,
  type CanonicalClaimRow,
  type CsvSource,
} from './types.js';

export const ImportSourceNamespaceSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/);
export const IMPORT_DISPOSITIONS = [
  'INSERTED',
  'DUPLICATE',
  'SOURCE_CHANGED',
  'BATCH_CONFLICT',
  'LEGACY_MATCH',
  'MISSING_SOURCE_ID',
] as const;
export interface ImportRowResult {
  readonly rowIndex: number;
  readonly disposition: (typeof IMPORT_DISPOSITIONS)[number];
  readonly claimId: string | null;
}
export interface BulkInsertOptions {
  readonly organizationId: string;
  readonly source: CsvSource;
  readonly sourceNamespace: string;
  readonly canonicalRows: readonly CanonicalClaimRow[];
  readonly dobHashSecret: string;
  readonly actorId?: string;
  readonly now?: Date;
}
export interface BulkInsertResult {
  readonly insertedRows: number;
  readonly skippedDuplicates: number;
  readonly conflictRows: number;
  readonly rows: readonly ImportRowResult[];
}

const CHUNK_SIZE = 500;
interface PreparedRow {
  readonly row: CanonicalClaimRow;
  readonly data: Prisma.ClaimCreateManyInput;
  readonly hash: string;
}

function prepareRow(opts: BulkInsertOptions, row: CanonicalClaimRow, now: Date): PreparedRow {
  const patientDOBHash = hashPatientDOB({
    dob: row.patientDOB,
    organizationId: opts.organizationId,
    secret: opts.dobHashSecret,
  });
  const hash = createHmac('sha256', opts.dobHashSecret)
    .update(
      JSON.stringify([
        row.sourceDetails ? 'csv-source-details-v1' : 'csv-source-v1',
        opts.organizationId,
        opts.source,
        opts.sourceNamespace,
        row.sourceClaimId,
        row.sourceVersion,
        row.sourcePatientId,
        row.sourceFields,
        patientDOBHash,
        row.claimNumber,
        row.subscriberId,
        row.claimAmount,
        row.cdtCodes,
        row.payerCode,
        row.payerLabel,
        row.serviceDate,
        row.submittedDate,
        ...(row.sourceDetails ? [row.sourceDetails] : []),
      ]),
    )
    .digest('hex');
  return {
    row,
    hash,
    data: {
      organizationId: opts.organizationId,
      patientDOBHash,
      patientDOBLast4: patientDOBLast4(row.patientDOB),
      sourceSystem: opts.source,
      sourceNamespace: opts.sourceNamespace,
      sourceClaimId: row.sourceClaimId,
      sourceVersion: row.sourceVersion,
      sourceContentHash: hash,
      claimNumber: row.claimNumber,
      subscriberId: row.subscriberId,
      cdtCodes: [...row.cdtCodes],
      claimAmount: row.claimAmount,
      payerCode: row.payerCode,
      serviceDate: new Date(row.serviceDate),
      submittedDate: row.submittedDate ? new Date(row.submittedDate) : null,
      priority: scoreClaim({
        claimAmount: Number(row.claimAmount),
        daysOutstanding: daysOutstandingSince(row.submittedDate ?? row.serviceDate, now),
      }),
    },
  };
}

export async function bulkInsertClaims(opts: BulkInsertOptions): Promise<BulkInsertResult> {
  const { organizationId, canonicalRows, source, sourceNamespace } = opts;
  if (
    !organizationId ||
    !ImportSourceNamespaceSchema.safeParse(sourceNamespace).success ||
    !z.enum(SUPPORTED_CSV_SOURCES).safeParse(source).success ||
    canonicalRows.length > MAX_IMPORT_ROWS
  ) {
    throw new ApiError('VALIDATION_ERROR', 'Invalid import source or row limit exceeded.');
  }
  const now = opts.now ?? new Date();
  if (
    canonicalRows.reduce(
      (count, row) =>
        count + (row.sourceDetails?.lines.length ?? 0) + (row.sourceDetails?.coverages.length ?? 0),
      0,
    ) > MAX_IMPORT_CHILDREN
  )
    throw new CsvChildLimitError();
  const prepared = canonicalRows.map((row) => prepareRow(opts, row, now));
  const grouped = new Map<string, PreparedRow[]>();
  for (const item of prepared) {
    if (item.row.sourceClaimId === null) continue;
    const group = grouped.get(item.row.sourceClaimId) ?? [];
    group.push(item);
    grouped.set(item.row.sourceClaimId, group);
  }

  return prisma.$transaction(
    async (tx) => {
      // Serialize import decisions within a tenant. NO KEY UPDATE avoids blocking
      // the FK key-share locks held by other claim workflows. The unique index
      // also rejects duplicate identity from writers outside this importer.
      const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Organization" WHERE id = ${organizationId} FOR NO KEY UPDATE`;
      if (locked.length !== 1) throw new ApiError('NOT_FOUND', 'Organization not found.');
      const existing = await tx.claim.findMany({
        where: {
          organizationId,
          sourceSystem: source,
          sourceNamespace,
          sourceClaimId: { in: [...grouped.keys()] },
        },
        select: { id: true, sourceClaimId: true, sourceContentHash: true },
      });
      const bySourceId = new Map(existing.map((claim) => [claim.sourceClaimId, claim]));
      const legacy = await tx.claim.groupBy({
        by: ['claimNumber'],
        where: {
          organizationId,
          sourceSystem: null,
          claimNumber: { in: [...new Set(canonicalRows.map((row) => row.claimNumber))] },
        },
        _count: { _all: true },
        _min: { id: true },
      });
      const legacyByNumber = new Map(legacy.map((claim) => [claim.claimNumber, claim]));
      const rows: ImportRowResult[] = prepared
        .filter((item) => item.row.sourceClaimId === null)
        .map(({ row }) => ({
          rowIndex: row.rowIndex,
          disposition: 'MISSING_SOURCE_ID',
          claimId: null,
        }));
      const pending: PreparedRow[] = [];
      for (const [sourceClaimId, items] of grouped) {
        const first = items[0];
        if (!first) continue;
        const saved = bySourceId.get(sourceClaimId);
        if (new Set(items.map((item) => item.hash)).size > 1) {
          rows.push(
            ...items.map(
              ({ row }): ImportRowResult => ({
                rowIndex: row.rowIndex,
                disposition: 'BATCH_CONFLICT',
                claimId: saved?.id ?? null,
              }),
            ),
          );
        } else if (saved) {
          rows.push(
            ...items.map(
              ({ row }): ImportRowResult => ({
                rowIndex: row.rowIndex,
                disposition:
                  saved.sourceContentHash === first.hash ? 'DUPLICATE' : 'SOURCE_CHANGED',
                claimId: saved.id,
              }),
            ),
          );
        } else {
          const legacyIds = legacyByNumber.get(first.row.claimNumber);
          if (legacyIds) {
            rows.push(
              ...items.map(
                ({ row }): ImportRowResult => ({
                  rowIndex: row.rowIndex,
                  disposition: 'LEGACY_MATCH',
                  claimId: legacyIds._count._all === 1 ? legacyIds._min.id : null,
                }),
              ),
            );
          } else {
            pending.push(first);
          }
        }
      }
      // Every chunk and the audit commit together. A late failure leaves no
      // partial import; retry observes either the entire commit or none of it.
      for (let i = 0; i < pending.length; i += CHUNK_SIZE) {
        const inserted = await tx.claim.createManyAndReturn({
          data: pending.slice(i, i + CHUNK_SIZE).map((item) => item.data),
          select: { id: true, sourceClaimId: true },
        });
        const detailRows = inserted.flatMap((saved) => {
          const item =
            saved.sourceClaimId === null ? undefined : grouped.get(saved.sourceClaimId)?.[0];
          const details = item?.row.sourceDetails;
          return item && details ? [{ saved, item, details }] : [];
        });
        if (detailRows.length) {
          await tx.claimSourceDetails.createMany({
            data: detailRows.map(({ saved, item, details }) => ({
              claimId: saved.id,
              organizationId,
              schemaVersion: details.schemaVersion,
              importedClaimAmount: item.row.claimAmount,
              lineCount: details.lines.length,
              coverageCount: details.coverages.length,
            })),
          });
          const lines = detailRows.flatMap(({ saved, details }) =>
            details.lines.map((line, position) => ({
              ...line,
              claimId: saved.id,
              organizationId,
              position,
              serviceDate: new Date(`${line.serviceDate}T00:00:00.000Z`),
            })),
          );
          const coverages = detailRows.flatMap(({ saved, details }) =>
            details.coverages.map((coverage) => ({
              ...coverage,
              claimId: saved.id,
              organizationId,
              effectiveDate: coverage.effectiveDate
                ? new Date(`${coverage.effectiveDate}T00:00:00.000Z`)
                : null,
              terminationDate: coverage.terminationDate
                ? new Date(`${coverage.terminationDate}T00:00:00.000Z`)
                : null,
            })),
          );
          for (let childIndex = 0; childIndex < lines.length; childIndex += CHUNK_SIZE)
            await tx.claimSourceLine.createMany({
              data: lines.slice(childIndex, childIndex + CHUNK_SIZE),
            });
          for (let childIndex = 0; childIndex < coverages.length; childIndex += CHUNK_SIZE)
            await tx.claimSourceCoverage.createMany({
              data: coverages.slice(childIndex, childIndex + CHUNK_SIZE),
            });
        }
        for (const saved of inserted) {
          const items = saved.sourceClaimId === null ? undefined : grouped.get(saved.sourceClaimId);
          if (!items) throw new Error('Import identity missing after insert.');
          items.forEach(({ row }, index) =>
            rows.push({
              rowIndex: row.rowIndex,
              disposition: index === 0 ? 'INSERTED' : 'DUPLICATE',
              claimId: saved.id,
            }),
          );
        }
      }
      rows.sort((a, b) => a.rowIndex - b.rowIndex);
      const insertedRows = rows.filter((row) => row.disposition === 'INSERTED').length;
      const skippedDuplicates = rows.filter((row) => row.disposition === 'DUPLICATE').length;
      const conflictRows = rows.length - insertedRows - skippedDuplicates;
      const actor = opts.actorId
        ? await tx.user.findFirst({
            where: { organizationId, id: opts.actorId },
            select: { id: true },
          })
        : null;
      await audit(
        {
          organizationId,
          ...(actor ? { userId: actor.id } : {}),
          action: 'claim.import',
          resourceType: 'ClaimImport',
          resourceId: randomUUID(),
          metadata: {
            source,
            totalRows: rows.length,
            insertedRows,
            skippedDuplicates,
            conflictRows,
          },
        },
        tx,
      );
      return { insertedRows, skippedDuplicates, conflictRows, rows };
    },
    { maxWait: 5000, timeout: 30000 },
  );
}
