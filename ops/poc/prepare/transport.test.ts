import { RetryRequestError } from "./retry";
import { createBoundedTransport, TransportError } from "./transport";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const githubRequest = (suffix = "q=refactor") => ({
  provider: "github" as const,
  method: "GET" as const,
  url: `https://api.github.com/search/commits?${suffix}`,
});

const limits = {
  timeoutMilliseconds: 50,
  concurrentRequests: 2,
  requestCount: 4,
  responseBytes: 128,
  pages: 3,
};

const transportReturning = (response: Response, responseBytes = limits.responseBytes) =>
  createBoundedTransport({
    limits: { ...limits, responseBytes },
    fetch: async () => response,
  });

describe("bounded preparation transport", () => {
  it("uses manual redirects and returns strictly parsed JSON", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const transport = createBoundedTransport({
      limits,
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response('{"complete":true}', {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "17" },
        });
      },
    });

    await expect(transport.requestJson(githubRequest(), 1)).resolves.toEqual({ complete: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.redirect).toBe("manual");
    expect(calls[0]!.init.method).toBe("GET");
  });

  it("accepts a decoded encoded response when the decoded body is within the byte ceiling", async () => {
    const transport = transportReturning(new Response('{"decoded":true}', {
      status: 200,
      headers: {
        "content-encoding": "gzip",
        "content-length": "5",
        "content-type": "application/json",
      },
    }));

    await expect(transport.requestJson(githubRequest())).resolves.toEqual({ decoded: true });
  });

  it("meters decoded encoded bodies against the response byte ceiling", async () => {
    const transport = transportReturning(new Response("abcd", {
      status: 200,
      headers: {
        "content-encoding": "gzip",
        "content-length": "2",
      },
    }), 3);

    await expect(transport.requestBytes(githubRequest())).rejects.toMatchObject({
      code: "RESPONSE_LIMIT",
    });
  });

  it.each([undefined, "identity"])(
    "rejects a declared-length mismatch with %s content encoding",
    async (contentEncoding: string | undefined) => {
      const headers = new Headers({ "content-length": "3" });
      if (contentEncoding) headers.set("content-encoding", contentEncoding);
      const transport = transportReturning(new Response("body", { status: 200, headers }));

      await expect(transport.requestBytes(githubRequest())).rejects.toMatchObject({
        code: "MALFORMED_BODY",
      });
    },
  );

  it.each(["not-a-number", "-1"])(
    "rejects malformed declared content length %s",
    async (contentLength: string) => {
      const transport = transportReturning(new Response("body", {
        status: 200,
        headers: {
          "content-encoding": "gzip",
          "content-length": contentLength,
        },
      }));

      await expect(transport.requestBytes(githubRequest())).rejects.toMatchObject({
        code: "MALFORMED_BODY",
      });
    },
  );

  it("fails before and during stream consumption at the byte ceiling", async () => {
    const declared = createBoundedTransport({
      limits: { ...limits, responseBytes: 3 },
      fetch: async () => new Response("abcd", {
        status: 200,
        headers: { "content-length": "4" },
      }),
    });
    const streamed = createBoundedTransport({
      limits: { ...limits, responseBytes: 3 },
      fetch: async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("ab"));
          controller.enqueue(new TextEncoder().encode("cd"));
          controller.close();
        },
      }), { status: 200 }),
    });

    await expect(declared.requestBytes(githubRequest())).rejects.toMatchObject({
      code: "RESPONSE_LIMIT",
    });
    await expect(streamed.requestBytes(githubRequest())).rejects.toMatchObject({
      code: "RESPONSE_LIMIT",
    });
  });

  it("bounds timeout, concurrency, request count, and page number", async () => {
    let release: ((response: Response) => void) | undefined;
    const pending = createBoundedTransport({
      limits: { ...limits, concurrentRequests: 1 },
      fetch: async () => new Promise<Response>((resolve) => { release = resolve; }),
    });
    const first = pending.requestBytes(githubRequest());
    await expect(pending.requestBytes(githubRequest())).rejects.toMatchObject({ code: "CONCURRENCY_LIMIT" });
    release!(new Response("ok", { status: 200 }));
    await first;

    const counted = createBoundedTransport({
      limits: { ...limits, requestCount: 1 },
      fetch: async () => new Response("ok", { status: 200 }),
    });
    await counted.requestBytes(githubRequest());
    await expect(counted.requestBytes(githubRequest())).rejects.toMatchObject({ code: "REQUEST_LIMIT" });
    await expect(counted.requestBytes(githubRequest("q=x&page=4"), 4)).rejects.toMatchObject({ code: "PAGE_LIMIT" });

    const timed = createBoundedTransport({
      limits: { ...limits, timeoutMilliseconds: 5 },
      fetch: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init.signal!.addEventListener("abort", () => reject(new Error("provider detail")));
      }),
    });
    await expect(timed.requestBytes(githubRequest())).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("bounds a response body stream that ignores the request AbortSignal", async () => {
    const secret = "never-report-this-body";
    const transport = createBoundedTransport({
      limits: { ...limits, timeoutMilliseconds: 5 },
      fetch: async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(secret));
        },
      }), { status: 200 }),
    });
    const outcome = await Promise.race([
      transport.requestBytes(githubRequest()).then(
        () => ({ code: "RESOLVED" }),
        (error: unknown) => error,
      ),
      new Promise((resolve) => setTimeout(() => resolve({ code: "BODY_READ_HUNG" }), 50)),
    ]);

    expect(outcome).toMatchObject({ code: "TIMEOUT" });
    expect(JSON.stringify(outcome)).not.toContain(secret);
  });

  it("rejects malformed JSON, mismatched media types, and unsupported statuses", async () => {
    const malformed = createBoundedTransport({
      limits,
      fetch: async () => new Response("not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    });
    const media = createBoundedTransport({
      limits,
      fetch: async () => new Response("{}", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    });
    const status = createBoundedTransport({
      limits,
      fetch: async () => new Response("private body", { status: 418 }),
    });

    await expect(malformed.requestJson(githubRequest())).rejects.toMatchObject({ code: "MALFORMED_BODY" });
    await expect(media.requestJson(githubRequest())).rejects.toMatchObject({ code: "MALFORMED_BODY" });
    await expect(status.requestBytes(githubRequest())).rejects.toMatchObject({ code: "UNSUPPORTED_STATUS" });
  });


  it("translates a GitHub 403/429 with an integer retry-after into a retry request without reading the body", async () => {
    for (const status of [403, 429]) {
      let pulled = false;
      const body = new ReadableStream<Uint8Array>({ pull() { pulled = true; throw new Error("BODY_READ"); } }, { highWaterMark: 0 });
      const transport = transportReturning(new Response(body, { status, headers: { "retry-after": "2" } }));

      let caught: unknown;
      try { await transport.requestJson(githubRequest()); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(RetryRequestError);
      expect((caught as RetryRequestError).retryAfterMilliseconds).toBe(2000);
      expect(pulled).toBe(false);
    }
  });

  it("derives the wait from x-ratelimit-reset when the remaining budget is zero", async () => {
    const now = 1_700_000_000_000;
    const transport = createBoundedTransport({
      limits,
      now: () => now,
      fetch: async () => new Response(null, { status: 403, headers: {
        "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(now / 1000 + 5),
      } }),
    });

    await expect(transport.requestJson(githubRequest())).rejects.toMatchObject({ retryAfterMilliseconds: 5000 });
  });

  it("reports a malformed or elapsed retry instruction as a malformed signal, never as a network failure", async () => {
    const now = 1_700_000_000_000;
    const malformedCases = [
      { "retry-after": "soon" },
      { "retry-after": "0" },
      { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" },
      { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "not-a-number" },
      { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(now / 1000 - 1) },
    ];
    for (const headers of malformedCases) {
      const transport = createBoundedTransport({ limits, now: () => now,
        fetch: async () => new Response(null, { status: 429, headers }) });
      let caught: unknown;
      try { await transport.requestBytes(githubRequest()); } catch (error) { caught = error; }
      expect(caught).toBeInstanceOf(RetryRequestError);
      const wait = (caught as RetryRequestError).retryAfterMilliseconds;
      expect(Number.isSafeInteger(wait) && (wait as number) > 0).toBe(false);
    }
  });

  it("keeps UNSUPPORTED_STATUS for a GitHub 403 without an instruction and for non-GitHub rate limits", async () => {
    const github = transportReturning(new Response(null, { status: 403, headers: { "x-ratelimit-remaining": "7" } }));
    await expect(github.requestBytes(githubRequest())).rejects.toMatchObject({
      code: "UNSUPPORTED_STATUS", diagnostic: { statusClass: "4xx", provider: "github" },
    });

    const huggingFace = transportReturning(new Response(null, { status: 429, headers: { "retry-after": "1" } }));
    await expect(huggingFace.requestBytes({
      provider: "huggingFace", method: "GET", url: "https://huggingface.co/api/datasets/bigcode/the-stack-v2",
    })).rejects.toMatchObject({ code: "UNSUPPORTED_STATUS", diagnostic: { statusClass: "4xx", provider: "huggingFace" } });

    const github500 = transportReturning(new Response(null, { status: 500, headers: { "retry-after": "1" } }));
    await expect(github500.requestBytes(githubRequest())).rejects.toMatchObject({ code: "UNSUPPORTED_STATUS", diagnostic: { statusClass: "5xx" } });
  });

  it("keeps credentials, URLs, queries, and response bodies out of errors and diagnostics", async () => {
    const secret = "credential-value-123";
    const fullUrl = `https://api.github.com/search/commits?q=${secret}`;
    const transport = createBoundedTransport({
      limits,
      credentials: { github: `Bearer ${secret}` },
      fetch: async () => new Response(`private-body-${secret}`, { status: 500 }),
    });

    let caught: unknown;
    try {
      await transport.requestBytes({ provider: "github", method: "GET", url: fullUrl });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TransportError);
    const serialized = JSON.stringify(caught);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(fullUrl);
    expect(serialized).not.toContain("private-body");
    expect(serialized).toContain("/search/commits");

    const rateLimited = createBoundedTransport({
      limits,
      credentials: { github: `Bearer ${secret}` },
      fetch: async () => new Response(`private-body-${secret}`, { status: 429, headers: { "retry-after": "3" } }),
    });
    let retrySignal: unknown;
    try {
      await rateLimited.requestBytes({ provider: "github", method: "GET", url: fullUrl });
    } catch (error) {
      retrySignal = error;
    }
    expect(retrySignal).toBeInstanceOf(RetryRequestError);
    const serializedSignal = JSON.stringify({ ...(retrySignal as object), message: (retrySignal as Error).message });
    expect(serializedSignal).not.toContain(secret);
    expect(serializedSignal).not.toContain(fullUrl);
    expect(serializedSignal).not.toContain("private-body");
  });
});
