import { randomUUID, createHash } from 'node:crypto';
import { hostname } from 'node:os';

import {
  CANDIDATE_RELEASES,
  ReleaseSchema,
  buildObservationRequestBody,
  type ModelRelease,
} from '@dentabill/model-gateway';
import { z } from 'zod';

import {
  HashSchema,
  IdSchema,
  evidenceHash,
  evaluationRequest,
  parseCorpus,
  type EvaluationCorpus,
} from './contracts.js';

const Integer = z.number().int().nonnegative().safe();
export class CaptureError extends Error {
  constructor(
    readonly code:
      | 'CAPTURE_INVALID_INPUT'
      | 'CAPTURE_BINDING_MISMATCH'
      | 'CAPTURE_AUTHORIZATION_REQUIRED'
      | 'CAPTURE_EXPIRED'
      | 'CAPTURE_BUSY'
      | 'CAPTURE_ACCOUNT_MISMATCH'
      | 'CAPTURE_BUDGET_EXCEEDED'
      | 'CAPTURE_JOURNAL_ERROR',
  ) {
    super(code);
  }
}

export const CaptureEvidenceSchema = z
  .object({
    checkedAt: z.string().datetime(),
    accountSha256: HashSchema,
    accountEvidenceSha256: HashSchema,
    priceSource: z.literal('https://docs.fireworks.ai/serverless/pricing'),
    contextSource: z.literal('https://docs.fireworks.ai/api-reference/get-model'),
    model: z.enum([
      'accounts/fireworks/routers/glm-5p3-flash-us',
      'accounts/fireworks/routers/deepseek-v4p1-flash-us',
    ]),
    serviceTier: z.literal('STANDARD_DEFAULT'),
    contextTokens: Integer.min(1).max(10_000_000),
    inputUsdMicrosPerMillion: Integer.min(1),
    outputUsdMicrosPerMillion: Integer.min(1),
    publisherRevision: IdSchema,
    publisherLicenseSha256: HashSchema,
    servingRevisionVerified: z.literal(false),
    regionalRouteVerified: z.literal(false),
  })
  .strict();
export type CaptureEvidence = z.infer<typeof CaptureEvidenceSchema>;

export const CapturePlanSchema = z
  .object({
    schemaVersion: z.literal('observation-contract-capture.v1'),
    mode: z.literal('UNVERIFIED_DISCOVERY'),
    runId: IdSchema,
    directory: z.string().min(1).max(4096),
    hostSha256: HashSchema,
    createdAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    implementationSha256: HashSchema,
    corpusSha256: HashSchema,
    target: ReleaseSchema,
    evidence: CaptureEvidenceSchema,
    budget: z
      .object({
        currency: z.literal('USD'),
        maximumAllowanceUsdMicros: Integer.min(1).max(100_000_000),
        reservedPerCaseUsdMicros: Integer.min(1),
        reservedTotalUsdMicros: Integer.min(1),
        inputTokenAllowance: Integer.min(1),
        completionTokenAllowance: Integer.min(1),
        maxAttemptsPerCase: z.literal(1),
        refunds: z.literal(false),
        providerBillingCapVerified: z.literal(false),
      })
      .strict(),
    cases: z
      .array(
        z
          .object({
            caseId: IdSchema,
            storageId: HashSchema,
            requestSha256: HashSchema,
            wireRequestSha256: HashSchema,
            requestBytes: Integer.min(1),
          })
          .strict(),
      )
      .min(1)
      .max(25),
    productionApproval: z.literal(false),
  })
  .strict();
export type CapturePlan = z.infer<typeof CapturePlanSchema>;

export const CaptureAuthorizationSchema = z
  .object({
    schemaVersion: z.literal('observation-capture-authorization.v1'),
    planSha256: HashSchema,
    authorizedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    authority: z.literal('LOCAL_OPERATOR_EXPLICIT_CONFIRMATION'),
    authenticatedHumanApproval: z.literal(false),
  })
  .strict();

function usdMicros(inputTokens: number, outputTokens: number, evidence: CaptureEvidence): number {
  const numerator =
    BigInt(inputTokens) * BigInt(evidence.inputUsdMicrosPerMillion) +
    BigInt(outputTokens) * BigInt(evidence.outputUsdMicrosPerMillion);
  const result = Number((numerator + 999_999n) / 1_000_000n);
  if (!Number.isSafeInteger(result)) throw new CaptureError('CAPTURE_INVALID_INPUT');
  return result;
}

export function wireHash(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

export function createCapturePlan(options: {
  corpus: unknown;
  candidateId: string;
  evidence: unknown;
  directory: string;
  implementationSha256: string;
  allowanceUsdMicros: number;
  now?: Date;
  runId?: string;
}): CapturePlan {
  const now = options.now ?? new Date();
  const corpus = parseCorpus(options.corpus, now);
  const parsed = CaptureEvidenceSchema.safeParse(options.evidence);
  const candidate = CANDIDATE_RELEASES.find((item) => item.policy.id === options.candidateId);
  if (
    !parsed.success ||
    parsed.data.model !== candidate?.policy.requestModel ||
    corpus.cases.length > 25 ||
    !Number.isFinite(now.getTime()) ||
    Date.parse(parsed.data.checkedAt) > now.getTime() ||
    now.getTime() - Date.parse(parsed.data.checkedAt) > 24 * 60 * 60 * 1000
  )
    throw new CaptureError('CAPTURE_INVALID_INPUT');
  const evidence = parsed.data;
  const target: ModelRelease = structuredClone(candidate);
  target.policy.limits.maxAttempts = 1;
  // The full documented context on both sides intentionally over-reserves hidden reasoning.
  // This is a price-based allowance, not proof of the provider's invoice or serving revision.
  const perCase = usdMicros(evidence.contextTokens, evidence.contextTokens, evidence);
  const total = perCase * corpus.cases.length;
  if (!Number.isSafeInteger(total) || total > options.allowanceUsdMicros)
    throw new CaptureError('CAPTURE_BUDGET_EXCEEDED');
  const plan = CapturePlanSchema.safeParse({
    schemaVersion: 'observation-contract-capture.v1',
    mode: 'UNVERIFIED_DISCOVERY',
    runId: options.runId ?? randomUUID(),
    directory: options.directory,
    hostSha256: evidenceHash(hostname()),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    implementationSha256: options.implementationSha256,
    corpusSha256: evidenceHash(corpus),
    target,
    evidence,
    budget: {
      currency: 'USD',
      maximumAllowanceUsdMicros: options.allowanceUsdMicros,
      reservedPerCaseUsdMicros: perCase,
      reservedTotalUsdMicros: total,
      inputTokenAllowance: evidence.contextTokens,
      completionTokenAllowance: evidence.contextTokens,
      maxAttemptsPerCase: 1,
      refunds: false,
      providerBillingCapVerified: false,
    },
    cases: corpus.cases.map((item) => {
      const request = evaluationRequest(item, { kind: 'FIREWORKS_CANDIDATE', release: target });
      const body = buildObservationRequestBody(request, target);
      const bytes = Buffer.byteLength(body, 'utf8');
      if (bytes > target.policy.limits.requestBytes)
        throw new CaptureError('CAPTURE_INVALID_INPUT');
      return {
        caseId: item.id,
        storageId: evidenceHash(item.id),
        requestSha256: evidenceHash(request),
        wireRequestSha256: wireHash(body),
        requestBytes: bytes,
      };
    }),
    productionApproval: false,
  });
  if (!plan.success) throw new CaptureError('CAPTURE_INVALID_INPUT');
  return plan.data;
}

export function validateCapturePlan(
  input: unknown,
  corpusInput: unknown,
  implementationSha256: string,
  directory: string,
): { plan: CapturePlan; corpus: EvaluationCorpus } {
  const parsed = CapturePlanSchema.safeParse(input);
  if (!parsed.success) throw new CaptureError('CAPTURE_INVALID_INPUT');
  const plan = parsed.data;
  const corpus = parseCorpus(corpusInput);
  const reconstructed = createCapturePlan({
    corpus,
    candidateId: plan.target.policy.id,
    evidence: plan.evidence,
    directory,
    implementationSha256,
    allowanceUsdMicros: plan.budget.maximumAllowanceUsdMicros,
    now: new Date(plan.createdAt),
    runId: plan.runId,
  });
  if (evidenceHash(reconstructed) !== evidenceHash(plan))
    throw new CaptureError('CAPTURE_BINDING_MISMATCH');
  return { plan, corpus };
}
