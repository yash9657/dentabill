import type { CsvSource } from './types.js';

/**
 * Format detection from the header row alone.
 *
 * Each source uses a distinctive triple of column names; if the row
 * contains exactly one complete signature, we identify the layout.
 * Order isn't significant — different practice setups reorder
 * columns. Layout recognition does not verify the originating system
 * or establish a source database namespace.
 */
const SIGNATURES: Readonly<Record<CsvSource, readonly string[]>> = {
  DENTRIX: ['patient id', 'insurance carrier', 'service date'],
  EAGLESOFT: ['ptid', 'carrier', 'dos'],
  OPEN_DENTAL: ['patnum', 'inscarrier', 'procdate'],
};

function normaliseHeaderCell(raw: string): string {
  return raw.trim().toLowerCase();
}

export function detectCsvSource(headers: readonly string[]): CsvSource | null {
  const normalised = new Set(headers.map(normaliseHeaderCell));
  let matched: CsvSource | null = null;
  for (const [source, signature] of Object.entries(SIGNATURES) as [
    CsvSource,
    readonly string[],
  ][]) {
    if (signature.every((col) => normalised.has(col))) {
      if (matched) return null;
      matched = source;
    }
  }
  return matched;
}
