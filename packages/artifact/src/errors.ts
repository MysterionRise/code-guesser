/** Every malformed or inconsistent artifact record fails with this one error and no detail. */
export class ExperimentRecordError extends Error {
  public constructor() {
    super("EXPERIMENT_RECORD_REJECTED");
    this.name = "ExperimentRecordError";
  }
}

export const fail = (): never => { throw new ExperimentRecordError(); };
