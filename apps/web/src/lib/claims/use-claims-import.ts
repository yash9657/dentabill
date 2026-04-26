'use client';

import { useMutation, useQueryClient, type UseMutationResult } from '@tanstack/react-query';

import { useDentaBillApi } from '../api-client.js';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? (typeof window === 'undefined' ? 'http://localhost:3001' : '');

export interface ImportSummary {
  readonly source: 'DENTRIX' | 'EAGLESOFT' | 'OPEN_DENTAL';
  readonly totalRows: number;
  readonly validRows: number;
  readonly insertedRows: number;
  readonly skippedDuplicates: number;
  readonly errors: readonly { readonly rowIndex: number; readonly message: string }[];
}

interface ApiErrorBody {
  readonly error?: boolean;
  readonly message?: string;
  readonly code?: string;
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
export function useClaimsImport(): UseMutationResult<ImportSummary, Error, File> {
  const { withAuthHeaders } = useDentaBillApi();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: File): Promise<ImportSummary> => {
      const headers = await withAuthHeaders();
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${API_BASE_URL}/v1/ingest/claims`, {
        method: 'POST',
        headers, // do NOT set content-type; the browser fills in the boundary
        body: formData,
      });

      const json = (await res.json().catch(() => ({}))) as ImportSummary | ApiErrorBody;
      if (!res.ok) {
        const message = (json as ApiErrorBody).message ?? `Upload failed (${String(res.status)})`;
        throw new Error(message);
      }
      return json as ImportSummary;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['claims', 'list'] });
    },
  });
}
