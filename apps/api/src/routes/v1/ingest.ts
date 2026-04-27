import { ApiError } from '@dentabill/types';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { bulkInsertClaims } from '../../lib/csv/insert.js';
import { parseClaimsCSV } from '../../lib/csv/parser.js';
import { UnknownCsvFormatError } from '../../lib/csv/types.js';
import { getEnv } from '../../lib/env.js';

/**
 * `POST /v1/ingest/claims` — synchronous CSV ingestion (P2-T43).
 *
 * Accepts a single `file` field via `multipart/form-data`, max 10MB,
 * detects the source system from the header, validates each row
 * against the per-source schema (T44), and returns a parse summary:
 * `source`, `totalRows`, `validRows`, `errors`.
 *
 * Phase 2 ships the upload + parse path. The bulk-insert into the
 * `Claim` table — and the persisted `IngestJob` row — land in T48.
 * Until then this endpoint is read-only; the response shape is
 * forward-compatible.
 *
 * Failure modes:
 *   - 400 `VALIDATION_ERROR` — no file, multiple files, wrong field
 *     name.
 *   - 400 `VALIDATION_ERROR` — file is not text/csv (sniffed via
 *     mimetype + the first non-empty line of the buffer).
 *   - 413 `VALIDATION_ERROR` — file exceeds 10 MB.
 *   - 422 `VALIDATION_ERROR` — header doesn't match any supported
 *     source system.
 *
 * Per-row validation errors do NOT fail the request — they appear
 * in the response body so the caller can fix and re-upload.
 */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const ParseRowErrorSchema = z.object({
  rowIndex: z.number().int().nonnegative(),
  message: z.string(),
});

const IngestResponseSchema = z.object({
  source: z.enum(['DENTRIX', 'EAGLESOFT', 'OPEN_DENTAL']),
  totalRows: z.number().int().nonnegative(),
  validRows: z.number().int().nonnegative(),
  insertedRows: z.number().int().nonnegative(),
  skippedDuplicates: z.number().int().nonnegative(),
  errors: z.array(ParseRowErrorSchema),
});

type IngestResponse = z.infer<typeof IngestResponseSchema>;

export async function ingestRoutes(fastify: FastifyInstance): Promise<void> {
  const { requireAuth } = fastify.auth;
  const security = [{ bearer: [] as string[] }];

  // Multipart plugin only registers once per Fastify instance. The
  // `attachFieldsToBody: false` default lets us drive the field
  // iterator manually for clearer error surfaces (the auto-attach
  // mode swallows `MultipartError` into a 500 by default).
  await fastify.register(multipart, {
    limits: {
      fileSize: MAX_FILE_BYTES,
      files: 1,
      // Total field size cap — generous to avoid spurious 413s on
      // form metadata that's not the actual CSV file.
      fieldSize: 1024 * 1024,
    },
  });

  fastify.withTypeProvider().post(
    '/ingest/claims',
    {
      preHandler: requireAuth,
      schema: {
        description:
          'Upload a CSV export from Dentrix, Eaglesoft, or Open Dental for the authenticated organization. Returns a parse summary; bulk DB insert lands in T48.',
        security,
        consumes: ['multipart/form-data'],
        response: { 200: IngestResponseSchema },
      },
    },
    async (request): Promise<IngestResponse> => {
      const auth = request.dentabillAuth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'unreachable: requireAuth ran');

      const file = await request.file();
      if (!file) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'Upload must include a "file" field with the CSV body.',
        );
      }
      if (file.fieldname !== 'file') {
        throw new ApiError(
          'VALIDATION_ERROR',
          `Expected field name "file", got "${file.fieldname}".`,
        );
      }

      const buffer = await file.toBuffer().catch((err: unknown) => {
        if (err instanceof Error && /file too large/i.test(err.message)) {
          throw new ApiError('VALIDATION_ERROR', 'CSV exceeds the 10 MB upload limit.');
        }
        throw err;
      });

      // file.file.truncated is set by busboy when the limit was hit.
      if (file.file.truncated) {
        throw new ApiError('VALIDATION_ERROR', 'CSV exceeds the 10 MB upload limit.');
      }

      assertCsvLike(buffer, file.mimetype);

      let parsed;
      try {
        parsed = parseClaimsCSV(buffer);
      } catch (err) {
        if (err instanceof UnknownCsvFormatError) {
          throw new ApiError(
            'VALIDATION_ERROR',
            'Unrecognised CSV format. Supported sources: Dentrix, Eaglesoft, Open Dental.',
          );
        }
        throw err;
      }

      const env = getEnv();
      const { insertedRows, skippedDuplicates } = await bulkInsertClaims({
        organizationId: auth.orgId,
        canonicalRows: parsed.rows,
        dobHashSecret: env.DOB_HASH_SECRET,
      });

      return {
        source: parsed.source,
        totalRows: parsed.rows.length + parsed.errors.length,
        validRows: parsed.rows.length,
        insertedRows,
        skippedDuplicates,
        errors: parsed.errors.map((e) => ({ rowIndex: e.rowIndex, message: e.message })),
      };
    },
  );
}

/**
 * Cheap pre-parse sniff: a CSV must be (1) advertised as text or
 * `application/octet-stream` (some browsers send the latter for .csv)
 * and (2) start with a printable ASCII line containing at least one
 * comma. Catches the obvious "they uploaded an .xlsx" case without
 * us needing libmagic.
 */
function assertCsvLike(buffer: Buffer, mimetype: string): void {
  const lower = mimetype.toLowerCase();
  const okMime =
    lower.startsWith('text/') ||
    lower === 'application/csv' ||
    lower === 'application/vnd.ms-excel' ||
    lower === 'application/octet-stream';
  if (!okMime) {
    throw new ApiError('VALIDATION_ERROR', `Expected a CSV upload; got mimetype "${mimetype}".`);
  }
  const head = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('utf8');
  if (head.length === 0) {
    throw new ApiError('VALIDATION_ERROR', 'CSV is empty.');
  }
  const firstLine = head.split(/\r?\n/)[0] ?? '';
  if (!firstLine.includes(',')) {
    throw new ApiError(
      'VALIDATION_ERROR',
      'File does not look like a CSV (first line has no commas).',
    );
  }
  // Reject obvious binary content (any byte < 0x09 except \t, \n, \r).
  for (let i = 0; i < Math.min(buffer.length, 4096); i++) {
    const b = buffer[i];
    if (b === undefined) break;
    if (b === 0x09 || b === 0x0a || b === 0x0d) continue;
    if (b < 0x20) {
      throw new ApiError('VALIDATION_ERROR', 'File appears to be binary, not CSV.');
    }
  }
}
