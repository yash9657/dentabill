import { CONTRACT_FINGERPRINTS, releasePolicyHash } from '@dentabill/model-gateway';

import {
  EVALUATOR_VERSION,
  EvaluationError,
  HashSchema,
  evidenceHash,
  parseEvaluation,
} from './contracts.js';
import { evaluate } from './scoring.js';

export function prepareEvaluationReview(
  corpusInput: unknown,
  bundleInput: unknown,
  reportInput: unknown,
  evaluatorArtifactSha256: string,
): {
  schemaVersion: 'observation-eval-review.v1';
  status: 'ENGINEERING_REVIEW_REQUIRED';
  productionApproval: false;
  evaluator: { version: typeof EVALUATOR_VERSION; artifactSha256: string };
  contractFingerprints: typeof CONTRACT_FINGERPRINTS;
  bindings: {
    corpusSha256: string;
    annotationsSha256: string;
    inventorySha256: string;
    resultsSha256: string;
    reportSha256: string;
    targetSha256: string;
    targetPolicySha256: string | null;
    targetImplementationSha256: string | null;
  };
  counts: { cases: number; draft: number; declaredAdjudicated: number; heldOut: number };
  blockers: string[];
} {
  if (!HashSchema.safeParse(evaluatorArtifactSha256).success)
    throw new EvaluationError('INVALID_INPUT');
  const { corpus, bundle } = parseEvaluation(corpusInput, bundleInput);
  const computed = evaluate(corpus, bundle);
  if (evidenceHash(computed) !== evidenceHash(reportInput))
    throw new EvaluationError('INVALID_REPORT');
  const target = bundle.target.kind === 'FIREWORKS_CANDIDATE' ? bundle.target.release.policy : null;
  const draft = corpus.cases.filter((item) => item.review.status === 'DRAFT').length;
  const heldOut = corpus.cases.filter((item) => item.split === 'HELD_OUT').length;
  const blockers = [
    'SYNTHETIC_CORPUS_ONLY',
    'CAPTURE_PROVENANCE_NOT_AUTHENTICATED',
    'DOMAIN_REVIEW_ATTESTATIONS_NOT_AUTHENTICATED',
    'PROVIDER_CONTRACT_AND_CAPTURE_EVIDENCE_NOT_VERIFIED',
    'RELEASE_THRESHOLDS_NOT_RATIFIED',
    'NO_PRODUCTION_APPROVAL_AUTHORITY',
    ...(draft > 0 ? ['DRAFT_REFERENCE_LABELS'] : []),
    ...(heldOut === 0 ? ['NO_HELD_OUT_CASES'] : []),
    ...(bundle.capture === 'UNVERIFIED_IMPORT'
      ? ['IMPORTED_RESULTS_NOT_AUTHENTICATED']
      : ['SYNTHETIC_BASELINE_ONLY']),
    ...(target?.implementationArtifactSha256 ? [] : ['TARGET_IMPLEMENTATION_NOT_PINNED']),
    ...(target?.fingerprints.prompt === CONTRACT_FINGERPRINTS.prompt &&
    target.fingerprints.schema === CONTRACT_FINGERPRINTS.schema &&
    target.fingerprints.validator === CONTRACT_FINGERPRINTS.validator
      ? []
      : target
        ? ['TARGET_CONTRACT_FINGERPRINT_MISMATCH']
        : []),
  ];
  return {
    schemaVersion: 'observation-eval-review.v1',
    status: 'ENGINEERING_REVIEW_REQUIRED',
    productionApproval: false,
    evaluator: { version: EVALUATOR_VERSION, artifactSha256: evaluatorArtifactSha256 },
    contractFingerprints: { ...CONTRACT_FINGERPRINTS },
    bindings: {
      corpusSha256: evidenceHash(corpus),
      annotationsSha256: evidenceHash(
        corpus.cases.map((item) => ({ id: item.id, expected: item.expected, review: item.review })),
      ),
      inventorySha256: evidenceHash(
        corpus.cases.map((item) => ({
          id: item.id,
          split: item.split,
          groups: item.groups,
          tags: item.tags,
        })),
      ),
      resultsSha256: evidenceHash(bundle),
      reportSha256: evidenceHash(computed),
      targetSha256: evidenceHash(bundle.target),
      targetPolicySha256: target ? releasePolicyHash(target) : null,
      targetImplementationSha256: target?.implementationArtifactSha256 ?? null,
    },
    counts: {
      cases: corpus.cases.length,
      draft,
      declaredAdjudicated: corpus.cases.length - draft,
      heldOut,
    },
    blockers,
  };
}
