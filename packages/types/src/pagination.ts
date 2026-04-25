import { z } from 'zod';

/**
 * Cursor-based pagination over org-scoped collections. The cursor is an
 * opaque string returned by the server — clients must treat it as unparsed.
 *
 * Default page size is 50 to match the dashboard claims table; the maximum
 * is bounded so a single request can't exhaust the database.
 */

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export const PaginationQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/**
 * Build a paginated response schema for a given item schema:
 *
 *   const ClaimListSchema = paginatedResponseSchema(ClaimSchema)
 */
export function paginatedResponseSchema<T extends z.ZodTypeAny>(
  itemSchema: T,
): z.ZodObject<{
  items: z.ZodArray<T>;
  nextCursor: z.ZodNullable<z.ZodString>;
  hasMore: z.ZodBoolean;
}> {
  return z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
  });
}

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}
