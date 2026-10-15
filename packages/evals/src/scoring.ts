import {
  GatewayResultSchema,
  ObservationSchema,
  TransportAttemptSchema,
  validateObservation,
  type ClaimObservation,
  type GatewayResult,
  type TransportAttempt,
  type Usage,
} from '@dentabill/model-gateway';

import {
  canonicalJson,
  EVALUATOR_VERSION,
  evaluationRequest,
  evidenceHash,
  parseEvaluation,
  TAGS,
  type EvaluationBundle,
  type EvaluationCase,
  type EvaluationTarget,
} from './contracts.js';

export const FAILURE_FLAGS = [
  'RUNTIME_FAILED',
  'GATEWAY_SCHEMA_INVALID',
  'OUTPUT_MISSING',
  'OUTPUT_SCHEMA_INVALID',
  'OUTPUT_SEMANTIC_INVALID',
  'PROVENANCE_MISMATCH',
  'DISPOSITION_MISMATCH',
  'IDENTITY_MISMATCH',
  'STATUS_MISMATCH',
  'PAYMENT_MISMATCH',
  'CODE_MISMATCH',
  'ACTION_MISMATCH',
  'ABSTENTION_REASON_MISMATCH',
  'EVIDENCE_REFERENCE_MISMATCH',
  'FALSE_ABSTENTION',
  'REQUIRED_ABSTENTION_MISSED',
] as const;
export type FailureFlag = (typeof FAILURE_FLAGS)[number];
export interface Rate {
  numerator: number;
  denominator: number;
  rate: number | null;
}
type TokenField = keyof Usage;
const TOKEN_FIELDS = ['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens'] as const;
const SPLITS = ['DEVELOPMENT', 'CALIBRATION', 'HELD_OUT'] as const;

export interface UsageMeasures {
  /** Subtotals, never an estimate of unknown receipts or the provenance aggregate. */
  knownTokenSubtotals: Record<TokenField, number | null>;
  unknownTokenAttempts: Record<TokenField, number>;
  attempts: number;
  casesWithUnknownTotalTokens: number;
  casesWithoutAttemptReceipts: number;
  casesWithInvalidAttemptReceipts: number;
  casesWithInconsistentUsage: number;
  subtotalOverflow: boolean;
  estimatedCost: null;
}

export interface CaseScore {
  caseId: string;
  split: EvaluationCase['split'];
  tags: EvaluationCase['tags'];
  reviewStatus: EvaluationCase['review']['status'];
  answerable: boolean;
  runtimeStatus: 'VALIDATED' | 'ABSTAINED' | 'FAILED' | 'INVALID';
  gatewaySchemaValid: boolean;
  outputSchemaValid: boolean;
  localSemanticValid: boolean | null;
  provenanceMatchesTarget: boolean | null;
  /** These two comparisons alone do not establish successful execution. */
  goldValuesMatch: boolean | null;
  evidenceReferenceMatch: boolean | null;
  hasAnnotatedEvidence: boolean;
  emittedObservation: boolean;
  emittedAbstention: boolean;
  correct: boolean;
  failureFlags: FailureFlag[];
  correctionProxy: { fieldDifferences: number | null; evidenceAdditionsOrRemovals: number | null };
  usage: UsageMeasures;
  reportedLatencyMs: number | null;
}

export interface SliceMetrics {
  cases: number;
  answerableCases: number;
  requiredAbstentionCases: number;
  gatewaySchemaValidity: Rate;
  outputSchemaValidity: Rate;
  localSemanticValidity: Rate;
  provenanceAgreement: Rate;
  /** Successful, valid execution AND complete reference field agreement. */
  goldValueAgreement: Rate;
  /** Only cases with nonempty gold evidence enter this reference-agreement denominator. */
  evidenceReferenceAgreement: Rate;
  fullReferenceAgreement: Rate;
  answerableCorrectCoverage: Rate;
  answerableAttemptRate: Rate;
  selectiveAccuracy: Rate;
  falseAbstentionRate: Rate;
  requiredAbstentionRecall: Rate;
  requiredAbstentionPrecision: Rate;
  failureCounts: Record<FailureFlag, number>;
  correctionProxy: {
    comparableCases: number;
    unavailableCases: number;
    fieldDifferences: number;
    evidenceAdditionsOrRemovals: number;
    casesRequiringCorrectionOrDiscard: number;
    humanSeconds: null;
  };
  usage: UsageMeasures;
  reportedLatency: {
    samples: number;
    missingCases: number;
    p50Ms: number | null;
    p95Ms: number | null;
    method: 'NEAREST_RANK';
    verification: 'UNVERIFIED_REPORTED';
  };
  confidenceInterval: null;
  confidenceIntervalReason: 'NOT_REPRESENTATIVE_INDEPENDENT_SAMPLE';
}

export interface EvaluationReport {
  schemaVersion: 'observation-eval-report.v1';
  evaluatorVersion: typeof EVALUATOR_VERSION;
  hashes: { corpus: string; target: string; bundle: string };
  corpus: {
    id: string;
    version: string;
    dataClass: 'SYNTHETIC';
    caseCount: number;
    draftCases: number;
    adjudicatedCases: number;
  };
  target: { kind: EvaluationTarget['kind']; releaseId: string };
  capture: EvaluationBundle['capture'];
  provenanceVerification: 'UNAUTHENTICATED_DECLARATION';
  productionApproval: false;
  interpretation: {
    localValidity: 'SCHEMA_AND_LEXICAL_RULES_NOT_DENTAL_CORRECTNESS';
    goldAgreement: 'REFERENCE_AGREEMENT_NOT_ENTAILMENT';
    correctionBurden: 'FIELD_AND_CITATION_EDIT_PROXY_NOT_HUMAN_TIME';
    usage: 'ATTEMPT_RECEIPT_SUBTOTALS_UNKNOWN_USAGE_NOT_ZERO';
    cost: 'NO_PRICE_DATA';
    domainReview: 'RECORDED_REVIEW_ATTESTATIONS_NOT_EXTERNALLY_VERIFIED';
  };
  aggregate: SliceMetrics;
  byTag: { tag: (typeof TAGS)[number]; metrics: SliceMetrics }[];
  bySplit: { split: EvaluationCase['split']; metrics: SliceMetrics }[];
  cases: CaseScore[];
}

function object(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function rate(numerator: number, denominator: number): Rate {
  return { numerator, denominator, rate: denominator === 0 ? null : numerator / denominator };
}

function sorted(values: readonly unknown[]): string[] {
  return values.map(canonicalJson).sort();
}

function equal(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function fieldValues(output: ClaimObservation): unknown[] {
  return [
    output.disposition,
    output.claimId,
    output.claimVersion,
    output.status.value,
    output.payerReportedPayment?.amountMinorUnits ?? null,
    output.payerReportedPayment?.currency ?? null,
    sorted(output.denialCodes.map(({ system, code }) => ({ system, code }))),
    output.proposedAction,
    output.abstentionReason,
  ];
}

/** Citation order is irrelevant; duplicates, field placement, span, source, and quote are not. */
function citations(output: ClaimObservation): string[] {
  return sorted([
    ...output.status.evidence.map((evidence) => ({ field: 'status', evidence })),
    ...(output.payerReportedPayment?.evidence ?? []).map((evidence) => ({
      field: 'payment',
      evidence,
    })),
    ...output.denialCodes.flatMap(({ system, code, evidence }) =>
      evidence.map((anchor) => ({ field: 'code', system, code, evidence: anchor })),
    ),
  ]);
}

function citationEdits(left: string[], right: string[]): number {
  const counts = new Map<string, number>();
  for (const key of left) counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const key of right) counts.set(key, (counts.get(key) ?? 0) - 1);
  return [...counts.values()].reduce((total, count) => total + Math.abs(count), 0);
}

function provenanceMatches(
  result: Exclude<GatewayResult, { status: 'FAILED' }>,
  target: EvaluationTarget,
): boolean {
  if ((result.status === 'ABSTAINED') !== (result.output.disposition === 'ABSTAIN')) return false;
  const provenance = result.provenance;
  if (target.kind === 'SYNTHETIC_BASELINE') {
    return (
      provenance.kind === 'SYNTHETIC' &&
      provenance.releaseId === target.releaseId &&
      provenance.model === null &&
      provenance.responseId === null &&
      provenance.attempts.length === 0
    );
  }
  const policy = target.release.policy;
  // Both envelope and target schemas already require the same task/prompt/schema literals.
  return (
    provenance.kind === 'FIREWORKS' &&
    provenance.releaseId === policy.id &&
    provenance.model !== null &&
    policy.responseModels.includes(provenance.model)
  );
}

function emptyUsage(): UsageMeasures {
  return {
    knownTokenSubtotals: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0 },
    unknownTokenAttempts: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cachedInputTokens: 0 },
    attempts: 0,
    casesWithUnknownTotalTokens: 0,
    casesWithoutAttemptReceipts: 0,
    casesWithInvalidAttemptReceipts: 0,
    casesWithInconsistentUsage: 0,
    subtotalOverflow: false,
    estimatedCost: null,
  };
}

function consistentUsage(usage: Usage): boolean {
  const { inputTokens, outputTokens, totalTokens, cachedInputTokens } = usage;
  return (
    !(inputTokens !== null && cachedInputTokens !== null && cachedInputTokens > inputTokens) &&
    !(totalTokens !== null && inputTokens !== null && totalTokens < inputTokens) &&
    !(totalTokens !== null && outputTokens !== null && totalTokens < outputTokens) &&
    !(
      totalTokens !== null &&
      inputTokens !== null &&
      outputTokens !== null &&
      totalTokens !== inputTokens + outputTokens
    )
  );
}

function addSubtotal(target: UsageMeasures, field: TokenField, value: number | null): void {
  const current = target.knownTokenSubtotals[field];
  if (current === null || value === null || !Number.isSafeInteger(current + value)) {
    target.knownTokenSubtotals[field] = null;
    target.subtotalOverflow = true;
  } else target.knownTokenSubtotals[field] = current + value;
}

function measureUsage(raw: Record<string, unknown> | null): UsageMeasures {
  const measures = emptyUsage();
  const candidate = raw?.status === 'FAILED' ? raw.attempts : object(raw?.provenance)?.attempts;
  const parsed: TransportAttempt[] = [];
  const validArray = Array.isArray(candidate) && candidate.length <= 2;
  if (validArray) {
    for (const item of candidate) {
      const receipt = TransportAttemptSchema.safeParse(item);
      if (receipt.success) parsed.push(receipt.data);
    }
  }
  const valid =
    validArray &&
    parsed.length === candidate.length &&
    parsed.every((attempt, index) => attempt.index === index + 1);
  if (!valid) {
    measures.casesWithInvalidAttemptReceipts = 1;
    measures.casesWithUnknownTotalTokens = 1;
    return measures;
  }
  measures.attempts = parsed.length;
  if (parsed.length === 0) {
    measures.casesWithoutAttemptReceipts = 1;
    measures.casesWithUnknownTotalTokens = 1;
  }
  for (const attempt of parsed) {
    const consistent = consistentUsage(attempt.usage);
    if (!consistent) measures.casesWithInconsistentUsage = 1;
    for (const field of TOKEN_FIELDS) {
      const value = consistent ? attempt.usage[field] : null;
      if (value === null) measures.unknownTokenAttempts[field] += 1;
      else addSubtotal(measures, field, value);
    }
    if (!consistent || attempt.usage.totalTokens === null) measures.casesWithUnknownTotalTokens = 1;
  }
  return measures;
}

function scoreCase(item: EvaluationCase, result: unknown, target: EvaluationTarget): CaseScore {
  const raw = object(result);
  const envelope = GatewayResultSchema.safeParse(result);
  const parsedOutput = ObservationSchema.safeParse(raw?.output);
  const output = parsedOutput.success ? parsedOutput.data : null;
  const declaredDisposition = object(raw?.output)?.disposition;
  const semantic = output ? validateObservation(output, evaluationRequest(item, target)).ok : null;
  const successful = envelope.success && envelope.data.status !== 'FAILED';
  const provenance =
    envelope.success && envelope.data.status !== 'FAILED'
      ? provenanceMatches(envelope.data, target)
      : null;
  const expected = item.expected;
  const goldFields = fieldValues(expected);
  const actualFields = output ? fieldValues(output) : null;
  const fieldDifferences =
    actualFields?.reduce<number>(
      (sum, value, index) => sum + Number(!equal(value, goldFields[index])),
      0,
    ) ?? null;
  const goldCitations = citations(expected);
  const actualCitations = output ? citations(output) : null;
  const evidenceEdits = actualCitations ? citationEdits(goldCitations, actualCitations) : null;
  const valuesMatch = fieldDifferences === null ? null : fieldDifferences === 0;
  const evidenceMatch = evidenceEdits === null ? null : evidenceEdits === 0;
  const correct =
    successful &&
    semantic === true &&
    provenance === true &&
    valuesMatch === true &&
    evidenceMatch === true;
  const flags = new Set<FailureFlag>();
  if (raw?.status === 'FAILED') flags.add('RUNTIME_FAILED');
  if (!envelope.success) flags.add('GATEWAY_SCHEMA_INVALID');
  if (!raw || !Object.prototype.hasOwnProperty.call(raw, 'output')) flags.add('OUTPUT_MISSING');
  else if (!output) flags.add('OUTPUT_SCHEMA_INVALID');
  if (semantic === false) flags.add('OUTPUT_SEMANTIC_INVALID');
  if (successful && provenance === false) flags.add('PROVENANCE_MISMATCH');
  if (output) {
    if (output.disposition !== expected.disposition) flags.add('DISPOSITION_MISMATCH');
    if (output.claimId !== expected.claimId || output.claimVersion !== expected.claimVersion)
      flags.add('IDENTITY_MISMATCH');
    if (output.status.value !== expected.status.value) flags.add('STATUS_MISMATCH');
    if (!equal(actualFields?.[4], goldFields[4]) || !equal(actualFields?.[5], goldFields[5]))
      flags.add('PAYMENT_MISMATCH');
    if (!equal(actualFields?.[6], goldFields[6])) flags.add('CODE_MISMATCH');
    if (output.proposedAction !== expected.proposedAction) flags.add('ACTION_MISMATCH');
    if (output.abstentionReason !== expected.abstentionReason)
      flags.add('ABSTENTION_REASON_MISMATCH');
    if (!evidenceMatch) flags.add('EVIDENCE_REFERENCE_MISMATCH');
  }
  if (expected.disposition === 'OBSERVED' && declaredDisposition === 'ABSTAIN')
    flags.add('FALSE_ABSTENTION');
  if (expected.disposition === 'ABSTAIN' && !correct) flags.add('REQUIRED_ABSTENTION_MISSED');
  const reported = raw?.status === 'FAILED' ? raw.elapsedMs : object(raw?.provenance)?.elapsedMs;
  return {
    caseId: item.id,
    split: item.split,
    tags: [...item.tags],
    reviewStatus: item.review.status,
    answerable: expected.disposition === 'OBSERVED',
    runtimeStatus:
      raw?.status === 'VALIDATED' || raw?.status === 'ABSTAINED' || raw?.status === 'FAILED'
        ? raw.status
        : 'INVALID',
    gatewaySchemaValid: envelope.success,
    outputSchemaValid: parsedOutput.success,
    localSemanticValid: semantic,
    provenanceMatchesTarget: provenance,
    goldValuesMatch: valuesMatch,
    evidenceReferenceMatch: evidenceMatch,
    hasAnnotatedEvidence: goldCitations.length > 0,
    // Malformed declared answers remain in selective denominators, never in correct numerators.
    emittedObservation: declaredDisposition === 'OBSERVED',
    emittedAbstention: declaredDisposition === 'ABSTAIN',
    correct,
    failureFlags: FAILURE_FLAGS.filter((flag) => flags.has(flag)),
    correctionProxy: { fieldDifferences, evidenceAdditionsOrRemovals: evidenceEdits },
    usage: measureUsage(raw),
    reportedLatencyMs:
      typeof reported === 'number' && Number.isFinite(reported) && reported >= 0 ? reported : null,
  };
}

function summarize(cases: CaseScore[]): SliceMetrics {
  const count = (predicate: (item: CaseScore) => boolean): number => cases.filter(predicate).length;
  const valid = (item: CaseScore): boolean =>
    item.gatewaySchemaValid &&
    item.localSemanticValid === true &&
    item.provenanceMatchesTarget === true;
  const answerable = count((item) => item.answerable);
  const correctAnswerable = count((item) => item.answerable && item.correct);
  const correctAbstention = count((item) => !item.answerable && item.correct);
  const usage = emptyUsage();
  for (const item of cases) {
    for (const field of TOKEN_FIELDS) {
      addSubtotal(usage, field, item.usage.knownTokenSubtotals[field]);
      usage.unknownTokenAttempts[field] += item.usage.unknownTokenAttempts[field];
    }
    usage.attempts += item.usage.attempts;
    usage.casesWithUnknownTotalTokens += item.usage.casesWithUnknownTotalTokens;
    usage.casesWithoutAttemptReceipts += item.usage.casesWithoutAttemptReceipts;
    usage.casesWithInvalidAttemptReceipts += item.usage.casesWithInvalidAttemptReceipts;
    usage.casesWithInconsistentUsage += item.usage.casesWithInconsistentUsage;
    usage.subtotalOverflow ||= item.usage.subtotalOverflow;
  }
  const latency = cases
    .flatMap((item) => (item.reportedLatencyMs === null ? [] : [item.reportedLatencyMs]))
    .sort((a, b) => a - b);
  const percentile = (fraction: number): number | null =>
    latency[Math.ceil(latency.length * fraction) - 1] ?? null;
  const comparable = count((item) => item.correctionProxy.fieldDifferences !== null);
  return {
    cases: cases.length,
    answerableCases: answerable,
    requiredAbstentionCases: cases.length - answerable,
    gatewaySchemaValidity: rate(
      count((item) => item.gatewaySchemaValid),
      cases.length,
    ),
    outputSchemaValidity: rate(
      count((item) => item.outputSchemaValid),
      cases.length,
    ),
    localSemanticValidity: rate(
      count((item) => item.localSemanticValid === true),
      cases.length,
    ),
    provenanceAgreement: rate(
      count((item) => item.provenanceMatchesTarget === true),
      cases.length,
    ),
    goldValueAgreement: rate(
      count((item) => valid(item) && item.goldValuesMatch === true),
      cases.length,
    ),
    evidenceReferenceAgreement: rate(
      count(
        (item) => item.hasAnnotatedEvidence && valid(item) && item.evidenceReferenceMatch === true,
      ),
      count((item) => item.hasAnnotatedEvidence),
    ),
    fullReferenceAgreement: rate(
      count((item) => item.correct),
      cases.length,
    ),
    answerableCorrectCoverage: rate(correctAnswerable, answerable),
    answerableAttemptRate: rate(
      count((item) => item.answerable && item.emittedObservation),
      answerable,
    ),
    selectiveAccuracy: rate(
      correctAnswerable,
      count((item) => item.emittedObservation),
    ),
    falseAbstentionRate: rate(
      count((item) => item.answerable && item.emittedAbstention),
      answerable,
    ),
    requiredAbstentionRecall: rate(correctAbstention, cases.length - answerable),
    requiredAbstentionPrecision: rate(
      correctAbstention,
      count((item) => item.emittedAbstention),
    ),
    failureCounts: Object.fromEntries(
      FAILURE_FLAGS.map((flag) => [flag, count((item) => item.failureFlags.includes(flag))]),
    ) as Record<FailureFlag, number>,
    correctionProxy: {
      comparableCases: comparable,
      unavailableCases: cases.length - comparable,
      fieldDifferences: cases.reduce(
        (sum, item) => sum + (item.correctionProxy.fieldDifferences ?? 0),
        0,
      ),
      evidenceAdditionsOrRemovals: cases.reduce(
        (sum, item) => sum + (item.correctionProxy.evidenceAdditionsOrRemovals ?? 0),
        0,
      ),
      casesRequiringCorrectionOrDiscard: count((item) => !item.correct),
      humanSeconds: null,
    },
    usage,
    reportedLatency: {
      samples: latency.length,
      missingCases: cases.length - latency.length,
      p50Ms: percentile(0.5),
      p95Ms: percentile(0.95),
      method: 'NEAREST_RANK',
      verification: 'UNVERIFIED_REPORTED',
    },
    confidenceInterval: null,
    confidenceIntervalReason: 'NOT_REPRESENTATIVE_INDEPENDENT_SAMPLE',
  };
}

/** Offline comparison only. Bundle/corpus integrity errors throw; model failures are scored. */
export function evaluate(corpusInput: unknown, bundleInput: unknown): EvaluationReport {
  const { corpus, bundle } = parseEvaluation(corpusInput, bundleInput);
  const records = new Map(bundle.records.map((record) => [record.caseId, record.result]));
  const cases = corpus.cases.map((item) => scoreCase(item, records.get(item.id), bundle.target));
  return {
    schemaVersion: 'observation-eval-report.v1',
    evaluatorVersion: EVALUATOR_VERSION,
    hashes: {
      corpus: evidenceHash(corpus),
      target: evidenceHash(bundle.target),
      bundle: evidenceHash(bundle),
    },
    corpus: {
      id: corpus.id,
      version: corpus.version,
      dataClass: corpus.dataClass,
      caseCount: cases.length,
      draftCases: cases.filter((item) => item.reviewStatus === 'DRAFT').length,
      adjudicatedCases: cases.filter((item) => item.reviewStatus === 'ADJUDICATED').length,
    },
    target: {
      kind: bundle.target.kind,
      releaseId:
        bundle.target.kind === 'SYNTHETIC_BASELINE'
          ? bundle.target.releaseId
          : bundle.target.release.policy.id,
    },
    capture: bundle.capture,
    provenanceVerification: 'UNAUTHENTICATED_DECLARATION',
    productionApproval: false,
    interpretation: {
      localValidity: 'SCHEMA_AND_LEXICAL_RULES_NOT_DENTAL_CORRECTNESS',
      goldAgreement: 'REFERENCE_AGREEMENT_NOT_ENTAILMENT',
      correctionBurden: 'FIELD_AND_CITATION_EDIT_PROXY_NOT_HUMAN_TIME',
      usage: 'ATTEMPT_RECEIPT_SUBTOTALS_UNKNOWN_USAGE_NOT_ZERO',
      cost: 'NO_PRICE_DATA',
      domainReview: 'RECORDED_REVIEW_ATTESTATIONS_NOT_EXTERNALLY_VERIFIED',
    },
    aggregate: summarize(cases),
    byTag: TAGS.map((tag) => ({
      tag,
      metrics: summarize(cases.filter((item) => item.tags.includes(tag))),
    })),
    bySplit: SPLITS.map((split) => ({
      split,
      metrics: summarize(cases.filter((item) => item.split === split)),
    })),
    cases,
  };
}
