import { SYNTHETIC_RELEASE_ID, createFakeModelGateway } from '@dentabill/model-gateway';

import {
  evidenceHash,
  evaluationRequest,
  parseCorpus,
  type EvaluationBundle,
} from './contracts.js';

/** Empty fake fixtures intentionally abstain; reference annotations never reach the gateway. */
export async function runSyntheticBaseline(corpusInput: unknown): Promise<EvaluationBundle> {
  const corpus = parseCorpus(corpusInput);
  const target = { kind: 'SYNTHETIC_BASELINE', releaseId: SYNTHETIC_RELEASE_ID } as const;
  const gateway = createFakeModelGateway();
  const records: EvaluationBundle['records'] = [];
  for (const item of corpus.cases) {
    const request = evaluationRequest(item, target);
    records.push({
      caseId: item.id,
      requestSha256: evidenceHash(request),
      result: await gateway.generate(request),
    });
  }
  return {
    schemaVersion: 'observation-eval-results.v1',
    corpusSha256: evidenceHash(corpus),
    target,
    capture: 'LOCAL_SYNTHETIC',
    records,
  };
}
