import { GatewayResultSchema } from '@dentabill/model-gateway';
import { describe, expect, it } from 'vitest';

import { runSyntheticBaseline } from './baseline.js';
import { evidenceHash } from './contracts.js';
import { prepareEvaluationReview } from './review.js';
import { evaluate } from './scoring.js';
import { createSeedCorpus } from './seed.js';

const artifact = '1'.repeat(64);

describe('evaluation evidence review', () => {
  it('runs a label-independent abstaining baseline and keeps every blocker visible', async () => {
    const corpus = createSeedCorpus();
    const bundle = await runSyntheticBaseline(corpus);
    expect(bundle.records).toHaveLength(25);
    for (const record of bundle.records) {
      const result = GatewayResultSchema.parse(record.result);
      expect(result.status).toBe('ABSTAINED');
      if (result.status === 'FAILED') throw new Error('Unexpected baseline failure.');
      expect(result.output.abstentionReason).toBe('INSUFFICIENT_EVIDENCE');
      expect(result.provenance.attempts).toEqual([]);
      expect(result.provenance.model).toBeNull();
    }
    const report = evaluate(corpus, bundle);
    const review = prepareEvaluationReview(corpus, bundle, report, artifact);
    expect(review).toMatchObject({
      status: 'ENGINEERING_REVIEW_REQUIRED',
      productionApproval: false,
      counts: { cases: 25, draft: 25, declaredAdjudicated: 0, heldOut: 0 },
      bindings: { corpusSha256: evidenceHash(corpus), reportSha256: evidenceHash(report) },
    });
    expect(review.blockers).toEqual(
      expect.arrayContaining([
        'DRAFT_REFERENCE_LABELS',
        'SYNTHETIC_BASELINE_ONLY',
        'NO_HELD_OUT_CASES',
        'DOMAIN_REVIEW_ATTESTATIONS_NOT_AUTHENTICATED',
        'NO_PRODUCTION_APPROVAL_AUTHORITY',
      ]),
    );
    expect(evaluate(corpus, bundle)).toEqual(report);
    expect(prepareEvaluationReview(corpus, bundle, report, artifact)).toEqual(review);
  });

  it('rejects report tampering and binds the actual scorer artifact', async () => {
    const corpus = createSeedCorpus();
    const bundle = await runSyntheticBaseline(corpus);
    const report = evaluate(corpus, bundle);
    expect(() =>
      prepareEvaluationReview(corpus, bundle, { ...report, productionApproval: true }, artifact),
    ).toThrow('INVALID_REPORT');
    expect(() => prepareEvaluationReview(corpus, bundle, report, 'not-a-hash')).toThrow(
      'INVALID_INPUT',
    );
    const first = prepareEvaluationReview(corpus, bundle, report, artifact);
    const second = prepareEvaluationReview(corpus, bundle, report, '2'.repeat(64));
    expect(first.evaluator).not.toEqual(second.evaluator);
    expect(second.productionApproval).toBe(false);
  });

  it('cannot reuse a report after replacing a failed result or editing draft annotations', async () => {
    const corpus = createSeedCorpus();
    const bundle = await runSyntheticBaseline(corpus);
    const report = evaluate(corpus, bundle);
    const changed = structuredClone(bundle);
    const record = changed.records[0];
    if (!record) throw new Error('Missing fixture.');
    record.result = { status: 'FAILED', code: 'NETWORK_ERROR', attempts: [], elapsedMs: 1 };
    expect(() => prepareEvaluationReview(corpus, changed, report, artifact)).toThrow(
      'INVALID_REPORT',
    );
    corpus.cases[0]!.rationale += ' Another reference version.';
    expect(() => prepareEvaluationReview(corpus, bundle, report, artifact)).toThrow(
      'BINDING_MISMATCH',
    );
  });
});
