/**
 * Field-level normalisers shared by every per-source schema. Each
 * function is total — it either returns the canonical form or
 * throws an Error whose message becomes a per-row parse error.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/** Accept either ISO `YYYY-MM-DD` or US `M/D/YYYY` and emit ISO. */
export function normaliseDate(input: string, fieldName: string): string {
  const trimmed = input.trim();
  const iso = ISO_DATE.exec(trimmed);
  const us = iso ? null : US_DATE.exec(trimmed);
  const y = iso?.[1] ?? us?.[3];
  const m = iso?.[2] ?? us?.[1];
  const d = iso?.[3] ?? us?.[2];
  if (!m || !d || !y) throw new Error(`${fieldName}: expected a valid ISO or M/D/YYYY date`);
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (year < 1 || !monthDays || day < 1 || day > monthDays)
    throw new Error(`${fieldName}: expected a valid calendar date`);
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

/** Parse optional currency/grouping into an exact nonnegative Decimal(10,2) string. */
export function normaliseAmount(input: string, fieldName: string): string {
  const trimmed = input.trim();
  const stripped = trimmed.startsWith('$') ? trimmed.slice(1).trim() : trimmed;
  const invalid = (): Error =>
    new Error(`${fieldName}: expected a nonnegative amount with up to two decimals`);
  if (stripped.length === 0 || stripped.length > 128) throw invalid();
  const parts = stripped.split('.');
  if (parts.length > 2) throw invalid();
  const [whole, fractional] = parts;
  if (!whole) throw invalid();
  const groups = whole.split(',');
  if (groups.some((group) => !group || !isAllDigits(group))) throw invalid();
  if (
    groups.length > 1 &&
    groups.some((group, index) => (index === 0 ? group.length > 3 : group.length !== 3))
  )
    throw invalid();
  if (fractional !== undefined) {
    if (fractional.length === 0 || fractional.length > 2 || !isAllDigits(fractional))
      throw invalid();
  }
  const integer = groups.join('').replace(/^0+/, '') || '0';
  if (integer.length > 8) throw new Error(`${fieldName}: amount exceeds the supported range`);
  return `${integer}.${(fractional ?? '').padEnd(2, '0')}`;
}

/** Bounded opaque references retain case and leading zeroes. Blank is explicitly absent. */
export function normaliseOpaqueId(input: string, fieldName: string): string | null {
  if (/[\p{Cc}\p{Cf}\p{Cs}]/u.test(input))
    throw new Error(`${fieldName}: control characters are not allowed`);
  const value = input.trim();
  if (!value) return null;
  if (value.length > 200) throw new Error(`${fieldName}: exceeds 200 characters`);
  return value;
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
