export class RetryError extends Error {
  public constructor(public readonly code: string, cause?: unknown) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = "RetryError";
  }
}

export class RetryRequestError extends Error {
  public constructor(public readonly retryAfterMilliseconds: unknown) {
    super("RETRY_REQUESTED");
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

const SIGNED_RETRY_CEILINGS = Object.freeze({
  runRetries: 3,
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
        if (!Number.isSafeInteger(wait) || (wait as number) <= 0) {
          throw new RetryError("RETRY_SIGNAL_MALFORMED");
        }
        if (logicalRetries >= 1) throw new RetryError("LOGICAL_RETRY_LIMIT");
        if (runRetries >= options.maxRunRetries) throw new RetryError("RUN_RETRY_LIMIT");
        if ((wait as number) > options.maxWaitMilliseconds) throw new RetryError("WAIT_LIMIT");
        if (totalWait + (wait as number) > options.maxTotalWaitMilliseconds) {
          throw new RetryError("TOTAL_WAIT_LIMIT");
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
