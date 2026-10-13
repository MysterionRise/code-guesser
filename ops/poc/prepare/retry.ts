export class RetryError extends Error {
  public constructor(public readonly code: string, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = "RetryError";
  }
}

/** A request asking to be tried again after a wait; `cause` names a transient failure when there is one. */
export class RetryRequestError extends Error {
  public constructor(public readonly retryAfterMilliseconds: unknown, cause?: unknown) {
    super("RETRY_REQUESTED", cause === undefined ? undefined : { cause });
    this.name = "RetryRequestError";
  }
}

export interface RetryOptions {
  readonly maxRunRetries: number;
  readonly maxWaitMilliseconds: number;
  readonly maxTotalWaitMilliseconds: number;
  readonly sleep: (milliseconds: number) => Promise<void>;
}

export interface RetryState {
  readonly retries: number;
  readonly waitedMilliseconds: number;
}

export interface RetryController {
  execute<T>(operation: () => Promise<T>): Promise<T>;
  state(): RetryState;
}

/** Retries per run, shared by rate-limit and transient retries; total waiting is bounded separately. */
export const RUN_RETRY_LIMIT = 5;

const SIGNED_RETRY_CEILINGS = Object.freeze({
  runRetries: RUN_RETRY_LIMIT,
  waitMilliseconds: 15_000,
  totalWaitMilliseconds: 30_000,
});

const validPositiveLimit = (value: number, ceiling: number): boolean =>
  Number.isSafeInteger(value) && value > 0 && value <= ceiling;

export const createRetryController = (options: RetryOptions): RetryController => {
  if (
    !validPositiveLimit(options.maxRunRetries, SIGNED_RETRY_CEILINGS.runRetries)
    || !validPositiveLimit(options.maxWaitMilliseconds, SIGNED_RETRY_CEILINGS.waitMilliseconds)
    || !validPositiveLimit(options.maxTotalWaitMilliseconds, SIGNED_RETRY_CEILINGS.totalWaitMilliseconds)
  ) {
    throw new TypeError("INVALID_RETRY_LIMITS");
  }
  let runRetries = 0;
  let totalWait = 0;

  const execute = async <T>(operation: () => Promise<T>): Promise<T> => {
    let logicalRetries = 0;
    while (true) {
      try {
        return await operation();
      } catch (error) {
        if (!(error instanceof RetryRequestError)) throw new RetryError("RETRY_SIGNAL_MISSING", error);
        const wait = error.retryAfterMilliseconds;
        // A refused retry keeps the transient failure, if any, as its cause for diagnostics.
        const { cause } = error;
        if (!Number.isSafeInteger(wait) || (wait as number) <= 0) {
          throw new RetryError("RETRY_SIGNAL_MALFORMED", cause);
        }
        if (logicalRetries >= 1) throw new RetryError("LOGICAL_RETRY_LIMIT", cause);
        if (runRetries >= options.maxRunRetries) throw new RetryError("RUN_RETRY_LIMIT", cause);
        if ((wait as number) > options.maxWaitMilliseconds) throw new RetryError("WAIT_LIMIT", cause);
        if (totalWait + (wait as number) > options.maxTotalWaitMilliseconds) {
          throw new RetryError("TOTAL_WAIT_LIMIT", cause);
        }
        logicalRetries += 1;
        runRetries += 1;
        totalWait += wait as number;
        await options.sleep(wait as number);
      }
    }
  };

  return Object.freeze({
    execute,
    state: (): RetryState => Object.freeze({
      retries: runRetries,
      waitedMilliseconds: totalWait,
    }),
  });
};
