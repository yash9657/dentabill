'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { z } from 'zod';

import { useDentaBillApi } from '../api-client.js';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? (typeof window === 'undefined' ? 'http://localhost:3001' : '');

const RowDisposition = z.enum([
  'INSERTED',
  'DUPLICATE',
  'SOURCE_CHANGED',
  'BATCH_CONFLICT',
  'LEGACY_MATCH',
  'MISSING_SOURCE_ID',
]);
const count = z.number().int().nonnegative().safe();
const ImportSummarySchema = z.object({
  source: z.enum(['DENTRIX', 'EAGLESOFT', 'OPEN_DENTAL']),
  sourceNamespace: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,79}$/),
  totalRows: count,
  validRows: count,
  insertedRows: count,
  skippedDuplicates: count,
  conflictRows: count,
  rows: z.array(
    z.object({
      rowIndex: count,
      disposition: RowDisposition,
      claimId: z.string().min(1).nullable(),
    }),
  ),
  errors: z.array(z.object({ rowIndex: count, message: z.string() })),
});
export type ImportSummary = z.infer<typeof ImportSummarySchema>;
export interface ImportClaimsInput {
  readonly file: File;
  readonly sourceNamespace: string;
}

export function sourceDatabaseError(value: string): string | null {
  if (value.length === 0) return 'Enter a source database name before uploading.';
  return /^[a-z0-9][a-z0-9_-]{0,79}$/.test(value)
    ? null
    : 'Use 1–80 lowercase letters, numbers, hyphens or underscores. Start with a letter or number.';
}

/**
 * `useClaimsImport` — POST a CSV file to /v1/ingest/claims as
 * multipart/form-data and return a typed parse summary.
 *
 * The SDK can't send multipart bodies through openapi-fetch, so we
 * use raw fetch with the same auth-headers helper the SDK consumers
 * use. On success the claims list cache is invalidated so the table
 * at /dashboard/claims reflects the new rows immediately when the
 * user navigates back.
 */
export function useClaimsImport(): UseMutationResult<ImportSummary, Error, ImportClaimsInput> {
  const { withAuthHeaders } = useDentaBillApi();
  const queryClient = useQueryClient();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  return useMutation({
    mutationFn: async ({ file, sourceNamespace }: ImportClaimsInput): Promise<ImportSummary> => {
      const validationError = sourceDatabaseError(sourceNamespace);
      if (validationError) throw new Error(validationError);
      const headers = await withAuthHeaders();
      if (!active.current) throw new Error('The import form changed before the upload started.');
      const formData = new FormData();
      formData.append('file', file);

      let res: Response;
      try {
        res = await fetch(`${API_BASE_URL}/v1/ingest/claims`, {
          method: 'POST',
          headers: { ...headers, 'x-import-source': sourceNamespace },
          body: formData,
        });
      } catch {
        throw new Error(
          'The upload could not be confirmed. Retry with the same CSV and source database name.',
        );
      }

      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const error = z.object({ message: z.string().optional() }).safeParse(json);
        const message = error.success ? error.data.message : null;
        throw new Error(
          message ??
            `Upload failed (${String(res.status)}). Keep the same source database name when you retry.`,
        );
      }
      const result = ImportSummarySchema.safeParse(json);
      if (!result.success || result.data.sourceNamespace !== sourceNamespace) {
        throw new Error(
          'The import report could not be confirmed. Check the claims queue, then retry with the same CSV and source database name.',
        );
      }
      return result.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['claims', 'list'] });
    },
  });
}
