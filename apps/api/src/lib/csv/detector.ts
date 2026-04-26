import type { CsvSource } from './types.js';

/**
 * Format detection from the header row alone.
 *
 * Each source uses a distinctive triple of column names; if the row
 * contains all three (case-insensitive, trimmed), we know the source.
 * Order isn't significant — different practice setups reorder
 * columns. The triples were chosen so no two sources share all
 * three (matched in dev against real customer exports).
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
  for (const [source, signature] of Object.entries(SIGNATURES) as [
    CsvSource,
    readonly string[],
  ][]) {
    if (signature.every((col) => normalised.has(col))) {
      return source;
    }
  }
  return null;
}
