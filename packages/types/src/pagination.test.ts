import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PaginationQuerySchema,
  paginatedResponseSchema,
} from './pagination.js';

describe('PaginationQuerySchema', () => {
  it('defaults limit to 50 when omitted', () => {
    const parsed = PaginationQuerySchema.parse({});
    expect(parsed.limit).toBe(DEFAULT_PAGE_SIZE);
    expect(parsed.cursor).toBeUndefined();
  });

  it('coerces string limits to numbers (querystring inputs)', () => {
    const parsed = PaginationQuerySchema.parse({ limit: '25' });
    expect(parsed.limit).toBe(25);
  });

  it('rejects non-positive limits', () => {
    expect(() => PaginationQuerySchema.parse({ limit: 0 })).toThrow();
    expect(() => PaginationQuerySchema.parse({ limit: -1 })).toThrow();
  });

  it(`caps limit at MAX_PAGE_SIZE (${String(MAX_PAGE_SIZE)})`, () => {
    expect(() => PaginationQuerySchema.parse({ limit: MAX_PAGE_SIZE + 1 })).toThrow();
    expect(PaginationQuerySchema.parse({ limit: MAX_PAGE_SIZE }).limit).toBe(MAX_PAGE_SIZE);
  });

  it('rejects empty cursor strings', () => {
    expect(() => PaginationQuerySchema.parse({ cursor: '' })).toThrow();
  });
});

describe('paginatedResponseSchema', () => {
  it('builds a schema parameterized by item shape', () => {
    const itemSchema = z.object({ id: z.string(), name: z.string() });
    const responseSchema = paginatedResponseSchema(itemSchema);
    const valid = {
      items: [{ id: 'c1', name: 'Acme' }],
      nextCursor: 'opaque-cursor',
      hasMore: true,
    };
    expect(responseSchema.parse(valid)).toEqual(valid);
  });

  it('accepts null nextCursor for the final page', () => {
    const responseSchema = paginatedResponseSchema(z.string());
    expect(
      responseSchema.parse({ items: ['a', 'b'], nextCursor: null, hasMore: false }),
    ).toBeDefined();
  });

  it('rejects mismatched item shapes', () => {
    const responseSchema = paginatedResponseSchema(z.object({ id: z.string() }));
    expect(() =>
      responseSchema.parse({ items: [{ wrong: 'shape' }], nextCursor: null, hasMore: false }),
    ).toThrow();
  });
});
