import type { Prisma } from '@dentabill/db';
import { z } from 'zod';

const NullableReference = z.string().max(200).nullable();
const NullableArea = z.string().max(80).nullable();
const Amount = z.string().regex(/^(?:0|[1-9]\d{0,7})\.\d{2}$/);

const SourceLineSchema = z
  .object({
    id: z.string(),
    sourceLineId: z.string().min(1).max(200),
    sourceProcedureId: NullableReference,
    position: z.number().int().nonnegative(),
    procedureCode: z.string().min(1).max(32),
    codeVersion: z.string().max(32).nullable(),
    serviceDate: z.iso.date(),
    billedAmount: Amount,
    quantity: z
      .string()
      .regex(/^\d{1,9}\.\d{3}$/)
      .nullable(),
    treatmentArea: NullableArea,
    tooth: NullableArea,
    surface: NullableArea,
    quadrant: NullableArea,
    toothRange: NullableArea,
    toothNumberingSystem: NullableArea,
  })
  .strict();

const SourceCoverageSchema = z
  .object({
    id: z.string(),
    sourceCoverageId: z.string().min(1).max(200),
    sequence: z.number().int().min(1).max(9),
    payerName: z.string().min(1).max(200),
    payerIdentifier: NullableReference,
    payerIdentifierSystem: NullableArea,
    isClaimCoverage: z.boolean(),
    sourcePlanId: NullableReference,
    sourceSubscriptionId: NullableReference,
    subscriberId: NullableReference,
    patientMemberId: NullableReference,
    groupNumber: NullableReference,
    relationship: NullableArea,
    effectiveDate: z.iso.date().nullable(),
    terminationDate: z.iso.date().nullable(),
  })
  .strict();

export const ClaimSourceDetailsResponseSchema = z
  .object({
    schemaVersion: z.literal(1),
    importedClaimAmount: Amount,
    sourceSystem: z.enum(['DENTRIX', 'EAGLESOFT', 'OPEN_DENTAL']),
    sourceNamespace: z.string().min(1).max(80),
    sourceClaimId: z.string().min(1).max(200),
    sourceVersion: NullableReference,
    createdAt: z.iso.datetime(),
    lines: z.array(SourceLineSchema),
    coverages: z.array(SourceCoverageSchema),
  })
  .strict();

function buildSourceDetailsInclude(organizationId: string) {
  return {
    sourceDetails: {
      where: { organizationId },
      select: {
        schemaVersion: true,
        importedClaimAmount: true,
        createdAt: true,
        lines: {
          where: { organizationId },
          orderBy: { position: 'asc' },
          select: {
            id: true,
            sourceLineId: true,
            sourceProcedureId: true,
            position: true,
            procedureCode: true,
            codeVersion: true,
            serviceDate: true,
            billedAmount: true,
            quantity: true,
            treatmentArea: true,
            tooth: true,
            surface: true,
            quadrant: true,
            toothRange: true,
            toothNumberingSystem: true,
          },
        },
        coverages: {
          where: { organizationId },
          orderBy: { sequence: 'asc' },
          select: {
            id: true,
            sourceCoverageId: true,
            sequence: true,
            payerName: true,
            payerIdentifier: true,
            payerIdentifierSystem: true,
            isClaimCoverage: true,
            sourcePlanId: true,
            sourceSubscriptionId: true,
            subscriberId: true,
            patientMemberId: true,
            groupNumber: true,
            relationship: true,
            effectiveDate: true,
            terminationDate: true,
          },
        },
      },
    },
  } as const satisfies Prisma.ClaimInclude;
}

/** Eager-load only the imported snapshot's public fields, within the same tenant. */
export function sourceDetailsInclude(
  organizationId: string,
): ReturnType<typeof buildSourceDetailsInclude> {
  return buildSourceDetailsInclude(organizationId);
}

type ClaimWithSourceDetails = Prisma.ClaimGetPayload<{
  include: ReturnType<typeof sourceDetailsInclude>;
}>;

/** Imported source facts are exposed verbatim; they do not replace editable claim fields. */
export function toSourceDetailsResponse(
  row: ClaimWithSourceDetails,
): z.infer<typeof ClaimSourceDetailsResponseSchema> | null {
  const details = row.sourceDetails;
  if (!details) return null;
  return ClaimSourceDetailsResponseSchema.parse({
    schemaVersion: details.schemaVersion,
    importedClaimAmount: details.importedClaimAmount.toFixed(2),
    sourceSystem: row.sourceSystem,
    sourceNamespace: row.sourceNamespace,
    sourceClaimId: row.sourceClaimId,
    sourceVersion: row.sourceVersion,
    createdAt: details.createdAt.toISOString(),
    lines: details.lines.map((line) => ({
      ...line,
      serviceDate: line.serviceDate.toISOString().slice(0, 10),
      billedAmount: line.billedAmount.toFixed(2),
      quantity: line.quantity?.toFixed(3) ?? null,
    })),
    coverages: details.coverages.map((coverage) => ({
      ...coverage,
      effectiveDate: coverage.effectiveDate?.toISOString().slice(0, 10) ?? null,
      terminationDate: coverage.terminationDate?.toISOString().slice(0, 10) ?? null,
    })),
  });
}
