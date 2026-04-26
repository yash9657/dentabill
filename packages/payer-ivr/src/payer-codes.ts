/**
 * Payer-name → `PayerCode` lookup, used by the CSV ingestion path
 * (P2-T48) to canonicalise the free-text "insurance" column that
 * Dentrix / Eaglesoft / Open Dental exports.
 *
 * Why a hand-curated table instead of fuzzy matching:
 *
 *   - Billers typed these names in by hand for years. The same
 *     payer appears as "Delta Dental PPO", "Delta PPO", "DELTA
 *     DENTAL OF CA - PPO", etc. We need a deterministic mapping
 *     so two CSV uploads produce the same `Claim.payerCode` and
 *     the priority scoring + IVR routing stay stable.
 *   - Fuzzy ML matching has a non-zero error rate, and a wrong
 *     payer code routes a Cigna call into MetLife's IVR. That is
 *     a billing-team trust issue, not a 99% problem.
 *
 * The table is intentionally short (Phase 1 ships the top 8 +
 * UNKNOWN). Fallback heuristics catch obvious near-misses without
 * silently mapping unknown payers to a real code — anything we
 * can't classify becomes `UNKNOWN`, surfaced in the import summary
 * for biller review.
 */
import type { PayerCode } from '@dentabill/db';

interface PayerEntry {
  readonly code: PayerCode;
  /** Canonical display label (used in dashboard, never on disk). */
  readonly label: string;
  /**
   * Token sets — at least one set must be wholly present (in any
   * order, after normalisation) for an entry to match. Lets
   * "DELTA DENTAL OF CA - PPO" still resolve to DELTA_DENTAL_PPO
   * without enumerating every state-name permutation.
   */
  readonly tokenSets: readonly (readonly string[])[];
  /**
   * Tokens that, if present, *block* this entry from matching even
   * when its tokenSets do. Used to disambiguate Delta PPO from
   * Delta Premier when both contain "delta".
   */
  readonly antiTokens?: readonly string[];
}

const ENTRIES: readonly PayerEntry[] = [
  {
    code: 'DELTA_DENTAL_PPO',
    label: 'Delta Dental PPO',
    tokenSets: [['delta', 'ppo'], ['ddppo']],
    antiTokens: ['premier'],
  },
  {
    code: 'DELTA_DENTAL_PREMIER',
    label: 'Delta Dental Premier',
    tokenSets: [['delta', 'premier'], ['ddpremier']],
  },
  {
    code: 'CIGNA_DENTAL',
    label: 'Cigna Dental',
    tokenSets: [['cigna']],
  },
  {
    code: 'METLIFE_DENTAL',
    label: 'MetLife Dental',
    tokenSets: [['metlife'], ['met', 'life']],
  },
  {
    code: 'AETNA_DENTAL',
    label: 'Aetna Dental',
    tokenSets: [['aetna']],
  },
  {
    code: 'GUARDIAN_DENTAL',
    label: 'Guardian Dental',
    tokenSets: [['guardian']],
  },
  {
    code: 'UNITED_CONCORDIA',
    label: 'United Concordia',
    tokenSets: [['concordia'], ['tricare', 'dental']],
  },
  {
    code: 'HUMANA_DENTAL',
    label: 'Humana Dental',
    tokenSets: [['humana']],
  },
];

/**
 * Lowercase, strip punctuation, collapse whitespace. Equivalent
 * across "Delta Dental, PPO", "DELTA DENTAL  PPO", "delta-dental-ppo".
 */
export function normalisePayerName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Resolve a free-text payer name to a `PayerCode`. Returns
 * `UNKNOWN` when no entry matches; never throws. The `displayLabel`
 * for `UNKNOWN` mirrors the input verbatim so the import summary
 * can show "We didn't recognise '<their text>'" without losing
 * the original.
 */
export interface PayerResolution {
  readonly code: PayerCode;
  readonly label: string;
  readonly matched: boolean;
}

export function resolvePayerCode(raw: string | null | undefined): PayerResolution {
  if (!raw || raw.trim().length === 0) {
    return { code: 'UNKNOWN', label: 'Unknown', matched: false };
  }
  const normalised = normalisePayerName(raw);
  if (normalised.length === 0) {
    return { code: 'UNKNOWN', label: 'Unknown', matched: false };
  }
  const tokens = new Set(normalised.split(' '));
  for (const entry of ENTRIES) {
    if (entry.antiTokens?.some((t) => tokens.has(t))) continue;
    for (const set of entry.tokenSets) {
      if (set.every((t) => tokens.has(t))) {
        return { code: entry.code, label: entry.label, matched: true };
      }
    }
  }
  return { code: 'UNKNOWN', label: raw.trim(), matched: false };
}

/**
 * Display label for a known `PayerCode`. `UNKNOWN` returns
 * `"Unknown"` — the per-row free-text label is owned by
 * `resolvePayerCode`'s return value, not this map.
 */
export function payerCodeLabel(code: PayerCode): string {
  for (const entry of ENTRIES) {
    if (entry.code === code) return entry.label;
  }
  return 'Unknown';
}

/**
 * Canonical list of supported payer codes (mirror of the Prisma
 * enum, in display order). Used by the dashboard filter chips and
 * the contact-form dropdowns so the frontend can stay loosely
 * coupled to the schema generator.
 */
export const SUPPORTED_PAYER_CODES = [
  ...ENTRIES.map((entry) => entry.code),
  'UNKNOWN' as const,
] as readonly PayerCode[];
