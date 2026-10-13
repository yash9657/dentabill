export class SummaryInferenceBusyError extends Error {
  public readonly code = 'SUMMARY_INFERENCE_BUSY';
  public constructor() {
    super('Summary inference ownership is busy.');
    this.name = 'SummaryInferenceBusyError';
  }
}

type ObservationJobErrorCode =
  | 'OBSERVATION_CONFIGURATION_UNAVAILABLE'
  | 'OBSERVATION_RELEASE_UNAVAILABLE'
  | 'OBSERVATION_SOURCE_UNAVAILABLE'
  | 'OBSERVATION_REQUEST_INVALID'
  | 'OBSERVATION_BUDGET_EXCEEDED'
  | 'OBSERVATION_EXECUTION_UNCONFIRMED';

/** Queue failures contain only closed codes; raw provider/database errors never enter job logs. */
export class ObservationJobError extends Error {
  public constructor(readonly code: ObservationJobErrorCode) {
    super(code);
    this.name = 'ObservationJobError';
  }
}
