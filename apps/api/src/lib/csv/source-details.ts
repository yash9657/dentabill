import { z } from 'zod';

import { normaliseDate } from './normalisers.js';

export const MAX_SOURCE_LINES = 500;
export const MAX_SOURCE_COVERAGES = 9;
export const MAX_IMPORT_CHILDREN = 10000;
const MAX_DETAILS_CELL_BYTES = 512 * 1024;

const text = (max: number): z.ZodString =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => value.trim() === value && !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value));
const optionalText = (max: number) =>
  text(max)
    .nullish()
    .transform((value) => value ?? null);
const money = z.string().regex(/^(?:0|[1-9][0-9]{0,7})\.[0-9]{2}$/);
const date = z
  .string()
  .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)
  .refine((value) => {
    try {
      return normaliseDate(value, 'date') === value;
    } catch {
      return false;
    }
  });

function validQuantity(value: string): boolean {
  const parts = value.split('.');
  const whole = parts[0];
  const fractional = parts[1];
  return (
    parts.length <= 2 &&
    whole !== undefined &&
    whole.length >= 1 &&
    whole.length <= 9 &&
    /^[0-9]+$/.test(whole) &&
    (whole === '0' || !whole.startsWith('0')) &&
    (fractional === undefined ||
      (fractional.length >= 1 && fractional.length <= 3 && /^[0-9]+$/.test(fractional))) &&
    /[1-9]/.test(value)
  );
}

const LineSchema = z.strictObject({
  sourceLineId: text(200),
  sourceProcedureId: optionalText(200),
  procedureCode: text(32),
  codeVersion: optionalText(32),
  serviceDate: date,
  billedAmount: money,
  quantity: z
    .string()
    .max(13)
    .refine(validQuantity)
    .nullish()
    .transform((value) => value ?? null),
  treatmentArea: optionalText(80),
  tooth: optionalText(80),
  surface: optionalText(80),
  quadrant: optionalText(80),
  toothRange: optionalText(80),
  toothNumberingSystem: optionalText(80),
});
const CoverageSchema = z
  .strictObject({
    sourceCoverageId: text(200),
    sequence: z.number().int().min(1).max(MAX_SOURCE_COVERAGES),
    payerName: text(200),
    payerIdentifier: optionalText(200),
    payerIdentifierSystem: optionalText(80),
    isClaimCoverage: z.boolean(),
    sourcePlanId: optionalText(200),
    sourceSubscriptionId: optionalText(200),
    subscriberId: optionalText(200),
    patientMemberId: optionalText(200),
    groupNumber: optionalText(200),
    relationship: optionalText(80),
    effectiveDate: date.nullish().transform((value) => value ?? null),
    terminationDate: date.nullish().transform((value) => value ?? null),
  })
  .refine(
    (value) =>
      !value.effectiveDate ||
      !value.terminationDate ||
      value.effectiveDate <= value.terminationDate,
  );

export type ImportedClaimLine = z.infer<typeof LineSchema>;
export type ImportedClaimCoverage = z.infer<typeof CoverageSchema>;
export interface ImportedSourceDetails {
  readonly schemaVersion: 1;
  readonly lines: readonly ImportedClaimLine[];
  readonly coverages: readonly ImportedClaimCoverage[];
}

export class CsvChildLimitError extends Error {
  public constructor() {
    super(
      `CSV exceeds the ${String(MAX_IMPORT_CHILDREN)} combined procedure and coverage record limit.`,
    );
    this.name = 'CsvChildLimitError';
  }
}

function parseCell<T>(cell: string, field: string, schema: z.ZodType<T[]>): T[] {
  if (!cell.trim()) return [];
  if (Buffer.byteLength(cell, 'utf8') > MAX_DETAILS_CELL_BYTES)
    throw new Error(`${field}: exceeds the 512 KiB cell limit`);
  let input: unknown;
  try {
    input = JSON.parse(cell) as unknown;
  } catch {
    // JSON parser errors can include private source text.
    throw new Error(`${field}: expected a JSON array`);
  }
  const result = schema.safeParse(input);
  if (!result.success)
    throw new Error(`${field}: invalid or unsupported fields; use the version 1 import contract`);
  return result.data;
}

export function parseSourceDetails(
  linesCell: string,
  coveragesCell: string,
  claimAmount: string,
  cdtCodes: readonly string[],
): ImportedSourceDetails | null {
  const lines = parseCell(
    linesCell,
    'ClaimLines',
    z.array(LineSchema).min(1).max(MAX_SOURCE_LINES),
  );
  const coverages = parseCell(
    coveragesCell,
    'Coverages',
    z.array(CoverageSchema).min(1).max(MAX_SOURCE_COVERAGES),
  );
  if (!lines.length && !coverages.length) return null;
  if (new Set(lines.map((line) => line.sourceLineId)).size !== lines.length)
    throw new Error('ClaimLines: sourceLineId must be unique within the claim');
  if (lines.length) {
    const cents = (value: string): bigint => BigInt(value.replace('.', ''));
    if (lines.reduce((sum, line) => sum + cents(line.billedAmount), 0n) !== cents(claimAmount))
      throw new Error('ClaimLines: billed amounts must sum to the claim amount');
    const codes = new Set(lines.map((line) => line.procedureCode.toUpperCase()));
    if (codes.size !== cdtCodes.length || cdtCodes.some((code) => !codes.has(code)))
      throw new Error('ClaimLines: procedure codes must agree with the claim code list');
  }
  if (new Set(coverages.map((coverage) => coverage.sourceCoverageId)).size !== coverages.length)
    throw new Error('Coverages: sourceCoverageId must be unique within the claim');
  if (new Set(coverages.map((coverage) => coverage.sequence)).size !== coverages.length)
    throw new Error('Coverages: sequence must be unique within the claim');
  if (coverages.length && coverages.filter((coverage) => coverage.isClaimCoverage).length !== 1)
    throw new Error('Coverages: exactly one coverage must be marked for this claim');
  return { schemaVersion: 1, lines, coverages };
}
