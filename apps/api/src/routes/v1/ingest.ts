import { ApiError } from '@dentabill/types';
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  bulkInsertClaims,
  ImportSourceNamespaceSchema,
  IMPORT_DISPOSITIONS,
} from '../../lib/csv/insert.js';
import { parseClaimsCSV } from '../../lib/csv/parser.js';
import { CsvChildLimitError } from '../../lib/csv/source-details.js';
import { CsvRowLimitError, UnknownCsvFormatError } from '../../lib/csv/types.js';
import { getEnv } from '../../lib/env.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;

const ParseRowErrorSchema = z.object({
  rowIndex: z.number().int().nonnegative(),
  message: z.string(),
});

const IngestResponseSchema = z.object({
  source: z.enum(['DENTRIX', 'EAGLESOFT', 'OPEN_DENTAL']),
  sourceNamespace: ImportSourceNamespaceSchema,
  totalRows: z.number().int().nonnegative(),
  validRows: z.number().int().nonnegative(),
  insertedRows: z.number().int().nonnegative(),
  skippedDuplicates: z.number().int().nonnegative(),
  conflictRows: z.number().int().nonnegative(),
  rows: z.array(
    z.object({
      rowIndex: z.number().int().positive(),
      disposition: z.enum(IMPORT_DISPOSITIONS),
      claimId: z.string().nullable(),
    }),
  ),
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
          'Import claims using an explicit source database and stable source record IDs. Unchanged rows are skipped; conflicts are reported without overwriting existing work.',
        security,
        consumes: ['multipart/form-data'],
        headers: z.looseObject({ 'x-import-source': ImportSourceNamespaceSchema }),
        response: { 200: IngestResponseSchema },
      },
    },
    async (request): Promise<IngestResponse> => {
      const auth = request.dentabillAuth;
      if (!auth) throw new ApiError('AUTHENTICATION_REQUIRED', 'unreachable: requireAuth ran');

      const sourceNamespace = ImportSourceNamespaceSchema.parse(request.headers['x-import-source']);
      let buffer: Buffer | undefined;
      for await (const part of request.parts()) {
        if (part.type !== 'file' || part.fieldname !== 'file' || buffer) {
          throw new ApiError('VALIDATION_ERROR', 'Upload one CSV using the "file" field.');
        }
        buffer = await part.toBuffer();
        if (part.file.truncated) {
          throw new ApiError('VALIDATION_ERROR', 'CSV exceeds the 10 MB upload limit.');
        }
        assertCsvLike(buffer, part.mimetype);
      }
      if (!buffer) {
        throw new ApiError(
          'VALIDATION_ERROR',
          'Upload must include a "file" field with the CSV body.',
        );
      }

      let parsed;
      try {
        parsed = parseClaimsCSV(buffer);
      } catch (err) {
        if (err instanceof CsvRowLimitError || err instanceof CsvChildLimitError) {
          throw new ApiError('VALIDATION_ERROR', err.message);
        }
        if (err instanceof UnknownCsvFormatError) {
          throw new ApiError(
            'VALIDATION_ERROR',
            'Unrecognised CSV format. Supported sources: Dentrix, Eaglesoft, Open Dental.',
          );
        }
        throw err;
      }

      const env = getEnv();
      const result = await bulkInsertClaims({
        organizationId: auth.orgId,
        actorId: auth.userId,
        source: parsed.source,
        sourceNamespace,
        canonicalRows: parsed.rows,
        dobHashSecret: env.DOB_HASH_SECRET,
      });

      return {
        source: parsed.source,
        sourceNamespace,
        totalRows: parsed.rows.length + parsed.errors.length,
        validRows: parsed.rows.length,
        ...result,
        rows: [...result.rows],
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
