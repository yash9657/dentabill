import { createHash } from 'node:crypto';

/**
 * Patient DOB hashing — the only acceptable on-disk representation of
 * date-of-birth in DentaBill (per ADR-007 and `docs/SECURITY.md`).
 *
 * Why hash + last 4 of birth year:
 *
 *   - DOB is PHI under HIPAA. We never store the cleartext.
 *   - Billers still need to confirm patient identity to the payer rep
 *     during a call — "DOB ends in 1990" is enough for a phonetic
 *     readback without writing the full date back to disk.
 *   - The hash is keyed by an organisation-scoped secret so a
 *     stolen `Claim.patientDOBHash` cannot be brute-forced offline
 *     without that org's secret. Two different orgs hashing the same
 *     DOB yield different digests (no global rainbow table).
 *
 * Inputs:
 *
 *   - `dob` accepts an ISO `YYYY-MM-DD` string OR a `Date`. Anything
 *     else (e.g. `1990-1-5`, `01/05/1990`, leading whitespace) is
 *     rejected so callers cannot accidentally hash two distinct
 *     normalisations of the same date.
 *   - `organizationId` partitions the keyspace per tenant — without
 *     it, two orgs would collide on shared patients.
 *   - `secret` is loaded from env once at process start. The same
 *     secret value MUST be used across the lifetime of an org's
 *     data; rotating it requires a re-hash migration (none yet).
 *
 * Output: a 64-char lowercase hex SHA-256 digest.
 *
 * Determinism is essential — re-uploading the same CSV row must
 * produce the same hash so the idempotency-key path on bulk insert
 * (P2-T48) can dedupe.
 */
export interface HashPatientDOBInput {
  readonly dob: string | Date;
  readonly organizationId: string;
  readonly secret: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function toIsoDate(value: string | Date): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new Error('hashPatientDOB: dob is an Invalid Date.');
    }
    const yyyy = String(value.getUTCFullYear()).padStart(4, '0');
    const mm = String(value.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(value.getUTCDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  if (!ISO_DATE_RE.test(value)) {
    throw new Error(`hashPatientDOB: dob must be ISO YYYY-MM-DD, got "${value}".`);
  }
  return value;
}

export function hashPatientDOB(input: HashPatientDOBInput): string {
  if (input.organizationId.length === 0) {
    throw new Error('hashPatientDOB: organizationId must not be empty.');
  }
  if (input.secret.length === 0) {
    throw new Error('hashPatientDOB: secret must not be empty.');
  }
  const normalised = toIsoDate(input.dob);
  const material = `${input.organizationId}|${normalised}|${input.secret}`;
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

/**
 * Returns the last four characters of a `YYYY-MM-DD` birth string —
 * by convention, the birth year. Cleartext but considered low-PHI:
 * a year alone does not identify a patient. Stored alongside the
 * hash so billers can confirm identity verbally without retrieving
 * the full DOB.
 */
export function patientDOBLast4(dob: string | Date): string {
  const iso = toIsoDate(dob);
  return iso.slice(0, 4);
}
