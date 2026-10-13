import { createHash } from 'node:crypto';

import {
  GatewayRequestSchema,
  ObservationSchema,
  ReleaseSchema,
  SYNTHETIC_RELEASE_ID,
  TASK_VERSION,
  validateGatewayInput,
  validateObservation,
  type GatewayRequest,
} from '@dentabill/model-gateway';
import { z } from 'zod';

export const EVALUATOR_VERSION = 'observation-evaluator.v1' as const;
export const IdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.-]+$/);
export const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const TAGS = [
  'PAYMENT',
  'PARTIAL_PAYMENT',
  'REVERSAL',
  'COB',
  'NEGATION',
  'CORRECTION',
  'UNKNOWN_CODE',
  'DENIAL',
  'PENDING',
  'MISSING_EVIDENCE',
  'IDENTITY',
  'PROMPT_INJECTION',
  'NOISE',
  'CONTRADICTORY',
  'CURRENCY',
  'OVERPAYMENT',
  'STALE_SOURCE',
  'QUOTE_CONTEXT',
] as const;

export class EvaluationError extends Error {
  constructor(
    public readonly code:
      | 'INVALID_CORPUS'
      | 'INVALID_BUNDLE'
      | 'BINDING_MISMATCH'
      | 'CASE_SET_MISMATCH'
      | 'LEAKAGE_DETECTED'
      | 'INVALID_REPORT'
      | 'INVALID_INPUT'
      | 'OUTPUT_EXISTS',
  ) {
    super(code);
    this.name = 'EvaluationError';
  }
}

/** Sorted object keys; array ordering remains part of the immutable input. */
export function canonicalJson(value: unknown): string {
  const visit = (current: unknown, depth: number): unknown => {
    if (depth > 40) throw new EvaluationError('INVALID_INPUT');
    if (current === null || typeof current === 'string' || typeof current === 'boolean')
      return current;
    if (typeof current === 'number' && Number.isFinite(current)) return current;
    if (Array.isArray(current)) {
      if (Object.keys(current).length !== current.length)
        throw new EvaluationError('INVALID_INPUT');
      return Array.from(current, (item) => visit(item, depth + 1));
    }
    if (typeof current === 'object' && Object.getPrototypeOf(current) === Object.prototype)
      return Object.fromEntries(
        Object.entries(current)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, visit(item, depth + 1)]),
      );
    throw new EvaluationError('INVALID_INPUT');
  };
  return JSON.stringify(visit(value, 0));
}

export function evidenceHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

const AnnotationSchema = z
  .object({
    reviewerId: IdSchema,
    qualificationEvidenceId: IdSchema,
    recordId: IdSchema,
    inputSha256: HashSchema,
    reviewedAt: z.string().datetime(),
    expected: ObservationSchema,
  })
  .strict();
const ReviewSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('DRAFT') }).strict(),
  z
    .object({
      status: z.literal('ADJUDICATED'),
      annotations: z.array(AnnotationSchema).length(2),
      adjudicatorId: IdSchema,
      adjudicationId: IdSchema,
      adjudicatedAt: z.string().datetime(),
      caseSha256: HashSchema,
    })
    .strict(),
]);

export const EvaluationCaseSchema = z
  .object({
    id: IdSchema,
    split: z.enum(['DEVELOPMENT', 'CALIBRATION', 'HELD_OUT']),
    groups: z
      .object({ practice: IdSchema, patient: IdSchema, claim: IdSchema, scenario: IdSchema })
      .strict(),
    tags: z.array(z.enum(TAGS)).min(1).max(TAGS.length),
    request: GatewayRequestSchema,
    expected: ObservationSchema,
    rationale: z.string().min(1).max(2000),
    prohibitedInterpretations: z.array(z.string().min(1).max(1000)).max(10),
    review: ReviewSchema,
  })
  .strict();
export type EvaluationCase = z.infer<typeof EvaluationCaseSchema>;
export const CorpusSchema = z
  .object({
    schemaVersion: z.literal('observation-eval-corpus.v1'),
    id: IdSchema,
    version: IdSchema,
    task: z.literal(TASK_VERSION),
    dataClass: z.literal('SYNTHETIC'),
    cases: z.array(EvaluationCaseSchema).min(1).max(10_000),
  })
  .strict();
export type EvaluationCorpus = z.infer<typeof CorpusSchema>;

export function caseInputHash(item: EvaluationCase): string {
  return evidenceHash({
    id: item.id,
    split: item.split,
    groups: item.groups,
    tags: item.tags,
    request: item.request,
  });
}
export function caseContentHash(item: EvaluationCase): string {
  return evidenceHash({
    id: item.id,
    split: item.split,
    groups: item.groups,
    tags: item.tags,
    request: item.request,
    expected: item.expected,
    rationale: item.rationale,
    prohibitedInterpretations: item.prohibitedInterpretations,
  });
}

export function parseCorpus(input: unknown, now = new Date()): EvaluationCorpus {
  const parsed = CorpusSchema.safeParse(input);
  if (!parsed.success || !Number.isFinite(now.getTime()))
    throw new EvaluationError('INVALID_CORPUS');
  const corpus = parsed.data;
  const ids = new Set<string>();
  const partitions = new Map<string, EvaluationCase['split']>();
  for (const item of corpus.cases) {
    if (
      ids.has(item.id) ||
      new Set(item.tags).size !== item.tags.length ||
      item.request.dataClass !== 'SYNTHETIC' ||
      !validateGatewayInput(item.request) ||
      !validateObservation(item.expected, item.request).ok
    )
      throw new EvaluationError('INVALID_CORPUS');
    ids.add(item.id);
    const keys = [
      ...Object.entries(item.groups).map(([kind, value]) => `${kind}:${value}`),
      `request-claim:${item.request.organizationId}:${item.request.claim.id}`,
      ...item.request.sources.map((source) => `source:${evidenceHash(source.text)}`),
    ];
    for (const key of keys) {
      const previous = partitions.get(key);
      if (previous && previous !== item.split) throw new EvaluationError('LEAKAGE_DETECTED');
      partitions.set(key, item.split);
    }
    if (item.review.status === 'ADJUDICATED') {
      const review = item.review;
      if (
        Date.parse(review.adjudicatedAt) > now.getTime() ||
        new Set(review.annotations.map((a) => a.reviewerId)).size !== 2 ||
        new Set(review.annotations.map((a) => a.recordId)).size !== 2 ||
        review.caseSha256 !== caseContentHash(item) ||
        review.annotations.some(
          (a) =>
            a.inputSha256 !== caseInputHash(item) ||
            Date.parse(a.reviewedAt) > Date.parse(review.adjudicatedAt) ||
            !validateObservation(a.expected, item.request).ok,
        )
      )
        throw new EvaluationError('INVALID_CORPUS');
    }
  }
  return corpus;
}

export const TargetSchema = z.discriminatedUnion('kind', [
  z
    .object({ kind: z.literal('SYNTHETIC_BASELINE'), releaseId: z.literal(SYNTHETIC_RELEASE_ID) })
    .strict(),
  z.object({ kind: z.literal('FIREWORKS_CANDIDATE'), release: ReleaseSchema }).strict(),
]);
export type EvaluationTarget = z.infer<typeof TargetSchema>;
export const BundleSchema = z
  .object({
    schemaVersion: z.literal('observation-eval-results.v1'),
    corpusSha256: HashSchema,
    target: TargetSchema,
    capture: z.enum(['LOCAL_SYNTHETIC', 'UNVERIFIED_IMPORT']),
    records: z
      .array(
        z
          .object({
            caseId: IdSchema,
            requestSha256: HashSchema,
            result: z.unknown(),
          })
          .strict(),
      )
      .max(10_000),
  })
  .strict();
export type EvaluationBundle = z.infer<typeof BundleSchema>;

export function evaluationRequest(item: EvaluationCase, target: EvaluationTarget): GatewayRequest {
  return {
    ...structuredClone(item.request),
    releaseId: target.kind === 'SYNTHETIC_BASELINE' ? target.releaseId : target.release.policy.id,
  };
}

export function parseEvaluation(
  corpusInput: unknown,
  bundleInput: unknown,
): {
  corpus: EvaluationCorpus;
  bundle: EvaluationBundle;
} {
  const corpus = parseCorpus(corpusInput);
  const parsed = BundleSchema.safeParse(bundleInput);
  if (!parsed.success) throw new EvaluationError('INVALID_BUNDLE');
  const bundle = parsed.data;
  if (bundle.corpusSha256 !== evidenceHash(corpus)) throw new EvaluationError('BINDING_MISMATCH');
  if (bundle.target.kind !== 'SYNTHETIC_BASELINE' && bundle.capture === 'LOCAL_SYNTHETIC')
    throw new EvaluationError('INVALID_BUNDLE');
  if (
    bundle.records.length !== corpus.cases.length ||
    new Set(bundle.records.map((r) => r.caseId)).size !== bundle.records.length
  )
    throw new EvaluationError('CASE_SET_MISMATCH');
  const records = new Map(bundle.records.map((record) => [record.caseId, record]));
  for (const item of corpus.cases) {
    const record = records.get(item.id);
    if (!record || !Object.prototype.hasOwnProperty.call(record, 'result'))
      throw new EvaluationError('CASE_SET_MISMATCH');
    if (record.requestSha256 !== evidenceHash(evaluationRequest(item, bundle.target)))
      throw new EvaluationError('BINDING_MISMATCH');
  }
  // Bounds malformed result trees too, without emitting any source/output text in errors.
  canonicalJson(bundle);
  return { corpus, bundle };
}
