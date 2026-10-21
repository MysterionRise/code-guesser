export class RetryError extends Error {
  public constructor(
    public readonly code: string,
    cause?: unknown,
    /** When GitHub's rate limit lifts, in epoch milliseconds, on a `RATE_LIMIT_CHECKPOINT`. */
    public readonly resetAt?: number,
  ) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = "RetryError";
  }
}

/** GitHub's rate limit behind a retry request: when it lifts, in epoch milliseconds. */
export interface RateLimitSignal {
  readonly resetAt: number;
}

/**
 * A request asking to be tried again after a wait; `cause` names a transient failure, or the 403 or 429 of a
 * rate limit, when there is one. `rateLimit` marks a GitHub rate limit, whose refused retry stops the run.
 */
export class RetryRequestError extends Error {
  public constructor(
    public readonly retryAfterMilliseconds: unknown,
    cause?: unknown,
    public readonly rateLimit?: RateLimitSignal,
  ) {
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
        const { cause, rateLimit } = error;
        if (!Number.isSafeInteger(wait) || (wait as number) <= 0) {
          throw new RetryError("RETRY_SIGNAL_MALFORMED", cause);
        }
        // A refused rate-limit retry stops the run at a checkpoint (#165): until the limit lifts, every later
        // request would be refused the same way, and counting each as a rejected candidate would shrink the decks.
        const fail = (code: string): never => {
          throw rateLimit === undefined ? new RetryError(code, cause) : new RetryError("RATE_LIMIT_CHECKPOINT", cause, rateLimit.resetAt);
        };
        if (logicalRetries >= 1) fail("LOGICAL_RETRY_LIMIT");
        if (runRetries >= options.maxRunRetries) fail("RUN_RETRY_LIMIT");
        if ((wait as number) > options.maxWaitMilliseconds) fail("WAIT_LIMIT");
        if (totalWait + (wait as number) > options.maxTotalWaitMilliseconds) fail("TOTAL_WAIT_LIMIT");
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
