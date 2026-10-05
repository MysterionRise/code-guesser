import { createRetryController, RetryError, RetryRequestError } from "./retry";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const controller = (sleep: (milliseconds: number) => Promise<void> = async () => {}) =>
  createRetryController({
    maxRunRetries: 3,
    maxWaitMilliseconds: 15_000,
    maxTotalWaitMilliseconds: 30_000,
    sleep,
  });

describe("bounded retry controller", () => {
  it("retries one logical request once and records immutable state", async () => {
    let attempts = 0;
    const retry = controller();

    const result = await retry.execute(async () => {
      attempts += 1;
      if (attempts === 1) throw new RetryRequestError(10);
      return "ok";
    });

    expect(result).toBe("ok");
    expect(attempts).toBe(2);
    expect(retry.state()).toEqual({ retries: 1, waitedMilliseconds: 10 });
    expect(Object.isFrozen(retry.state())).toBe(true);
  });

  it("never retries the same logical request more than once", async () => {
    let attempts = 0;
    const retry = controller();

    await expect(retry.execute(async () => {
      attempts += 1;
      throw new RetryRequestError(1);
    })).rejects.toMatchObject({ code: "LOGICAL_RETRY_LIMIT" });
    expect(attempts).toBe(2);
  });

  it("accepts three run retries exactly and rejects the fourth", async () => {
    const retry = controller();
    const succeedAfterRetry = async (): Promise<string> => {
      let attempts = 0;
      return retry.execute(async () => {
        attempts += 1;
        if (attempts === 1) throw new RetryRequestError(1);
        return "ok";
      });
    };

    await expect(succeedAfterRetry()).resolves.toBe("ok");
    await expect(succeedAfterRetry()).resolves.toBe("ok");
    await expect(succeedAfterRetry()).resolves.toBe("ok");
    await expect(succeedAfterRetry()).rejects.toMatchObject({ code: "RUN_RETRY_LIMIT" });
    expect(retry.state().retries).toBe(3);
  });

  it("accepts exact wait ceilings and rejects the first value over either ceiling", async () => {
    const waits: number[] = [];
    const retry = controller(async (milliseconds) => { waits.push(milliseconds); });
    const once = async (milliseconds: number): Promise<void> => {
      let attempts = 0;
      await retry.execute(async () => {
        attempts += 1;
        if (attempts === 1) throw new RetryRequestError(milliseconds);
      });
    };

    await once(15_000);
    await once(15_000);
    expect(waits).toEqual([15_000, 15_000]);
    expect(retry.state().waitedMilliseconds).toBe(30_000);
    await expect(once(1)).rejects.toMatchObject({ code: "TOTAL_WAIT_LIMIT" });

    const fresh = controller();
    await expect(fresh.execute(async () => { throw new RetryRequestError(15_001); }))
      .rejects.toMatchObject({ code: "WAIT_LIMIT" });
  });

  it("rejects missing or malformed retry instructions without sleeping", async () => {
    let sleeps = 0;
    const invalid = [undefined, null, "5", 0, -1, 1.5];

    for (const signal of invalid) {
      const retry = controller(async () => { sleeps += 1; });
      await expect(retry.execute(async () => { throw new RetryRequestError(signal); }))
        .rejects.toBeInstanceOf(RetryError);
    }
    expect(sleeps).toBe(0);
  });

  it("leaves caller-owned artifact state untouched when retry fails", async () => {
    const artifact = Object.freeze({ identity: "previous", fixtures: Object.freeze([1, 2, 3, 4, 5]) });
    const before = JSON.stringify(artifact);

    await expect(controller().execute(async () => { throw new RetryRequestError(undefined); }))
      .rejects.toBeInstanceOf(RetryError);
    expect(JSON.stringify(artifact)).toBe(before);
  });

  it("preserves the original failure as the cause when no retry signal exists", async () => {
    const retry = controller();
    const original = new Error("UNSUPPORTED_STATUS");

    let caught: unknown;
    try {
      await retry.execute(async () => { throw original; });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RetryError);
    expect((caught as RetryError).code).toBe("RETRY_SIGNAL_MISSING");
    expect((caught as Error).cause).toBe(original);
    expect(retry.state()).toEqual({ retries: 0, waitedMilliseconds: 0 });
  });
});
