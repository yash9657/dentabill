import type { PayerCode } from '@dentabill/db';

import { getIvrMap } from './ivr/maps/index.js';
import type { PayerIvrMap } from './ivr/types.js';

/**
 * ADR-037 — Business-hours guard.
 *
 * Evaluated at the API enqueue route only. The call worker does NOT
 * re-check at job pickup; the source of truth is one place by design.
 *
 * Returns a discriminated tagged result so callers can branch:
 *   - `unsupported_payer` — Phase 3 doesn't have an IVR map for this payer
 *     (e.g. AETNA_DENTAL, UNKNOWN). Callers should reject the enqueue.
 *   - `closed`            — the payer line is closed right now. `nextOpeningAt`
 *     is the next valid call moment in UTC; `reason` distinguishes after-
 *     hours / before-hours / non-business-day for observability.
 *   - `open`              — call freely.
 *
 * Implemented with `Intl.DateTimeFormat` so DST handling is delegated to the
 * platform's IANA tz database; we never hard-code an offset.
 */
export type PayerHoursResult =
  | { readonly state: 'open'; readonly payerCode: PayerCode; readonly checkedAt: Date }
  | {
      readonly state: 'closed';
      readonly payerCode: PayerCode;
      readonly checkedAt: Date;
      readonly nextOpeningAt: Date;
      readonly reason: 'before_hours' | 'after_hours' | 'non_business_day';
    }
  | {
      readonly state: 'unsupported_payer';
      readonly payerCode: PayerCode;
      readonly checkedAt: Date;
    };

interface PayerLocalParts {
  readonly year: number;
  readonly month: number; // 1–12
  readonly day: number; // 1–31
  readonly hour: number; // 0–23
  readonly minute: number; // 0–59
  readonly weekday: number; // 0=Sun … 6=Sat
}

/**
 * Format `instant` in `tz` and return the wall-clock parts.
 *
 * `Intl.DateTimeFormat`'s `weekday: 'short'` part returns localised
 * abbreviations; we look up the index ourselves so the function is locale-
 * independent.
 */
const WEEKDAY_INDEX: Readonly<Record<string, number>> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function partsInZone(instant: Date, tz: string): PayerLocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = fmt.formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const part = parts.find((p) => p.type === type);
    if (part === undefined) throw new Error(`Missing part ${type} from Intl.DateTimeFormat`);
    return part.value;
  };
  // `hour: '2-digit'` with `hour12: false` returns "00"–"23"; some Node
  // versions return "24" at midnight, normalise that to 0.
  const rawHour = parseInt(get('hour'), 10);
  const weekday = WEEKDAY_INDEX[get('weekday')];
  if (weekday === undefined) {
    throw new Error(`Unrecognised weekday from Intl.DateTimeFormat: ${get('weekday')}`);
  }
  return {
    year: parseInt(get('year'), 10),
    month: parseInt(get('month'), 10),
    day: parseInt(get('day'), 10),
    hour: rawHour === 24 ? 0 : rawHour,
    minute: parseInt(get('minute'), 10),
    weekday,
  };
}

/**
 * Find the UTC instant that corresponds to (`year-month-day` `hour`:00 in `tz`).
 *
 * Implementation: guess the UTC instant assuming a zero offset, format it in
 * `tz`, and adjust by the difference. One iteration is enough for non-DST-
 * transition hours (we only ever call this with the payer's `hoursStartHour`,
 * which is 08:00 — well outside any spring-forward window).
 */
function utcOfPayerLocalHour(
  year: number,
  month: number, // 1-12
  day: number,
  hour: number,
  tz: string,
): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, 0, 0));
  const guessParts = partsInZone(guess, tz);
  const hourDelta = hour - guessParts.hour;
  // Day rollover is automatically handled because we only compare the
  // hour and not the date; if hour=8 but guessParts.hour=2, the delta is 6h.
  // If guessParts.hour was 22 (next day in tz), the delta is -14h, which
  // is fine.
  return new Date(guess.getTime() + hourDelta * 3_600_000);
}

function isOpenNow(parts: PayerLocalParts, map: PayerIvrMap): boolean {
  if (!map.daysOfWeek.includes(parts.weekday)) return false;
  if (parts.hour < map.hoursStartHour) return false;
  if (parts.hour >= map.hoursEndHour) return false;
  return true;
}

function nextOpeningAt(now: Date, map: PayerIvrMap): Date {
  const todayParts = partsInZone(now, map.timezone);
  // Try today first if we are still before opening hour.
  for (let dayOffset = 0; dayOffset <= 14; dayOffset += 1) {
    // Walk an offset's worth of days forward in UTC, then re-extract
    // the payer-local date for that instant.
    const dayProbe = new Date(
      Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day + dayOffset, 12, 0, 0),
    );
    const probeParts = partsInZone(dayProbe, map.timezone);
    if (!map.daysOfWeek.includes(probeParts.weekday)) continue;
    const candidate = utcOfPayerLocalHour(
      probeParts.year,
      probeParts.month,
      probeParts.day,
      map.hoursStartHour,
      map.timezone,
    );
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  throw new Error(
    `Could not locate next opening for ${map.payerCode} within 14 days — check daysOfWeek configuration`,
  );
}

export function checkPayerHours(payerCode: PayerCode, now: Date = new Date()): PayerHoursResult {
  const checkedAt = now;
  const map = getIvrMap(payerCode);
  if (map === undefined) {
    return { state: 'unsupported_payer', payerCode, checkedAt };
  }
  const parts = partsInZone(now, map.timezone);
  if (isOpenNow(parts, map)) {
    return { state: 'open', payerCode, checkedAt };
  }
  const reason: 'before_hours' | 'after_hours' | 'non_business_day' = !map.daysOfWeek.includes(
    parts.weekday,
  )
    ? 'non_business_day'
    : parts.hour < map.hoursStartHour
      ? 'before_hours'
      : 'after_hours';
  return {
    state: 'closed',
    payerCode,
    checkedAt,
    nextOpeningAt: nextOpeningAt(now, map),
    reason,
  };
}

/** Convenience helper for binary call-sites. */
export function isWithinPayerHours(payerCode: PayerCode, now: Date = new Date()): boolean {
  return checkPayerHours(payerCode, now).state === 'open';
}
