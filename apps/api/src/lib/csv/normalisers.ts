/**
 * Field-level normalisers shared by every per-source schema. Each
 * function is total — it either returns the canonical form or
 * throws an Error whose message becomes a per-row parse error.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** Accept either ISO `YYYY-MM-DD` or US `M/D/YYYY` and emit ISO. */
export function normaliseDate(input: string, fieldName: string): string {
  const trimmed = input.trim();
  if (ISO_DATE.test(trimmed)) return trimmed;
  const match = US_DATE.exec(trimmed);
  if (!match) throw new Error(`${fieldName}: expected ISO or M/D/YYYY date, got "${input}"`);
  const [, m, d, y] = match;
  if (!m || !d || !y) {
    throw new Error(`${fieldName}: malformed date "${input}"`);
  }
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

export function normaliseDateOptional(
  input: string | null | undefined,
  fieldName: string,
): string | null {
  if (input == null) return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  return normaliseDate(trimmed, fieldName);
}

/** Strip `$`, commas, whitespace; return decimal string with up to 2 fractional digits. */
export function normaliseAmount(input: string, fieldName: string): string {
  const stripped = input.replace(/[$,\s]/g, '');
  if (stripped.length === 0) {
    throw new Error(`${fieldName}: amount is empty`);
  }
  // Linear validation — split on optional '.' and check each side is digits-only.
  const parts = stripped.split('.');
  if (parts.length > 2) {
    throw new Error(`${fieldName}: amount "${input}" is not a positive decimal`);
  }
  const [whole, fractional] = parts;
  if (!whole || whole.length === 0 || !isAllDigits(whole)) {
    throw new Error(`${fieldName}: amount "${input}" is not a positive decimal`);
  }
  if (fractional !== undefined) {
    if (fractional.length === 0 || fractional.length > 2 || !isAllDigits(fractional)) {
      throw new Error(`${fieldName}: amount "${input}" is not a positive decimal`);
    }
  }
  return stripped;
}

function isAllDigits(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

/**
 * Procedure-code list: split by the source's separator, trim, drop
 * blanks, deduplicate while preserving order.
 */
export function normaliseCodes(input: string, separators: readonly string[]): readonly string[] {
  const sourceSep = separators.find((sep) => input.includes(sep));
  const tokens = sourceSep ? input.split(sourceSep) : [input];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of tokens) {
    const code = t.trim().toUpperCase();
    if (code.length === 0) continue;
    if (seen.has(code)) continue;
    seen.add(code);
    out.push(code);
  }
  return out;
}
