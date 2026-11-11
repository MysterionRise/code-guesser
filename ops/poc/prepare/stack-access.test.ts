import { readFile } from "node:fs/promises";

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CapacityError, createCapacityMeter } from "./capacity";
import { failureDiagnostic, runStop } from "./diagnostics";
import { JOURNAL_SCHEMA, openJournal } from "./journal";
import { MAINSTREAM_LANGUAGES, parseCrawlProfile, type CrawlProfile } from "./profile";
import { createPreparationRuntime, RunInterruptedError } from "./runtime";
import { preflightStackAccess, StackAccessError } from "./stack-access";
import { createBoundedTransport, type BoundedTransport } from "./transport";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const REVISION = "e565caa3a78c2423bd374333a472b049eb090e47";
const RELEASE = "v2.2.0";
const profilePath = new URL("../profiles/local-real-rounds.v5.json", import.meta.url);

const loadProfile = async (): Promise<CrawlProfile> =>
  parseCrawlProfile(JSON.parse(await readFile(profilePath, "utf8")));

const metadata = (overrides: Record<string, unknown> = {}) => ({
  _id: "65dc13085ca10be41fdd8b27",
  id: "bigcode/the-stack-v2",
  author: "bigcode",
  private: false,
  gated: "auto",
  disabled: false,
  sha: REVISION,
  cardData: {
    extra_gated_prompt: [
      "The Stack v2 is regularly updated to enact validated data removal requests.",
      "By clicking on Access repository, you agree to update your own version",
      "of The Stack v2 to the most recent usable version.",
    ].join(" "),
    extra_gated_fields: {
      Email: "text",
      "I have read the License and agree with its terms": "checkbox",
    },
  },
  siblings: [
    { rfilename: "README.md" },
    { rfilename: "data/Python/train-00000-of-00100.parquet" },
  ],
  ...overrides,
});

const card = (release = RELEASE): string => [
  "---",
  "extra_gated_prompt: |-",
  "  The Stack v2 is regularly updated to enact validated data removal requests.",
  "  Use the most recent usable version.",
  "extra_gated_fields:",
  "  Email: text",
  "  I have read the License and agree with its terms: checkbox",
  "---",
  "### Changelog",
  "Release  | Description",
  "--- | ---",
  `${release}  | Current release description.`,
  "v2.0.1  | Prior release description.",
  "",
].join("\n");

const directTransport = (
  metadataValue: unknown = metadata(),
  cardValue: string = card(),
  calls: string[] = [],
): BoundedTransport => ({
  requestJson: async (request) => {
    calls.push(request.url);
    return metadataValue;
  },
  requestBytes: async (request) => {
    calls.push(request.url);
    return Buffer.from(cardValue);
  },
});

const run = async (overrides: Record<string, unknown> = {}) => ({
  profile: await loadProfile(),
  acknowledgedUsableRevision: REVISION,
  transport: directTransport(),
  ...overrides,
});

describe("Stack access preflight", () => {
  it("constructs exact host-scoped authenticated metadata and independent current-card requests", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const responses = [
      new Response(JSON.stringify(metadata()), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
      new Response(card(), {
        status: 200,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }),
    ];
    const transport = createBoundedTransport({
      credentials: { huggingFace: "Bearer external-hf-token" },
      limits: {
        timeoutMilliseconds: 1_000,
        concurrentRequests: 1,
        requestCount: 2,
        responseBytes: 64_000,
        pages: 1,
      },
      fetch: async (url, init) => {
        calls.push({ url: url.toString(), init });
        return responses.shift() as Response;
      },
    });

    const grant = await preflightStackAccess(await run({ transport }));

    expect(grant).toEqual({ release: RELEASE, revision: REVISION });
    expect(Object.isFrozen(grant)).toBe(true);
    expect(calls.map(({ url }) => url)).toEqual([
      `https://huggingface.co/api/datasets/bigcode/the-stack-v2/revision/${REVISION}`,
      "https://huggingface.co/datasets/bigcode/the-stack-v2/raw/main/README.md",
    ]);
    expect(calls.map(({ init }) => init)).toEqual([
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
        headers: { accept: "application/json", authorization: "Bearer external-hf-token" },
      }),
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
        headers: {
          accept: "text/plain; charset=utf-8",
          authorization: "Bearer external-hf-token",
        },
      }),
    ]);
  });

  it("compares acknowledgement before either provider request", async () => {
    for (const [acknowledgement, code] of [
      [undefined, "ACKNOWLEDGEMENT_MISSING"],
      ["bad", "ACKNOWLEDGEMENT_MISMATCH"],
      ["a".repeat(40), "ACKNOWLEDGEMENT_MISMATCH"],
    ] as const) {
      const calls: string[] = [];
      await expect(preflightStackAccess(await run({
        acknowledgedUsableRevision: acknowledgement,
        transport: directTransport(metadata(), card(), calls),
      }))).rejects.toMatchObject({ code });
      expect(calls).toEqual([]);
    }
  });

  it("rejects malformed, inaccessible, or changed dataset state before reading the card", async () => {
    const failures: readonly [string, unknown][] = [
      ["ACCESS_RESPONSE_MALFORMED", null],
      ["ACCESS_RESPONSE_MALFORMED", metadata({ id: "other/dataset" })],
      ["ACCESS_RESPONSE_MALFORMED", metadata({ sha: "main" })],
      ["ACCESS_RESPONSE_MALFORMED", metadata({ siblings: [] })],
      ["ACCESS_DENIED", metadata({ private: true })],
      ["ACCESS_DENIED", metadata({ disabled: true })],
      ["ACCESS_GATE_CHANGED", metadata({ gated: false })],
      ["TERMS_CHANGED", metadata({ cardData: {} })],
    ];
    for (const [code, value] of failures) {
      const calls: string[] = [];
      await expect(preflightStackAccess(await run({
        transport: directTransport(value, card(), calls),
      }))).rejects.toMatchObject({ code });
      expect(calls).toHaveLength(1);
    }
  });

  it("independently rejects pinned revision response SHA and current-card release mismatch", async () => {
    const calls: string[] = [];
    await expect(preflightStackAccess(await run({
      transport: directTransport(metadata({ sha: "a".repeat(40) }), card(), calls),
    }))).rejects.toMatchObject({ code: "REVISION_MISMATCH" });
    expect(calls).toHaveLength(1);

    await expect(preflightStackAccess(await run({
      transport: directTransport(metadata(), card("v2.3.0")),
    }))).rejects.toMatchObject({ code: "RELEASE_MISMATCH" });

    const currentPipeTable = card("v2.2.0").replace(
      "Release  | Description\n--- | ---\nv2.2.0  | Current release description.",
      "|Release|Description|\n|-|-|\n| v2.2.0 | Current release description. |",
    );
    await expect(preflightStackAccess(await run({
      transport: directTransport(metadata(), currentPipeTable),
    }))).resolves.toEqual({ release: RELEASE, revision: REVISION });
  });

  it("rejects malformed or changed current cards", async () => {
    for (const value of [
      card().replace("### Changelog", "### Releases"),
      card().replace("Release  | Description", "Version | Notes"),
      card().replace("most recent usable version", "any old version"),
      card().replace("I have read the License and agree with its terms: checkbox", "Terms: checkbox"),
    ]) {
      await expect(preflightStackAccess(await run({
        transport: directTransport(metadata(), value),
      }))).rejects.toBeInstanceOf(StackAccessError);
    }
  });

  it("maps provider failures and invalid UTF-8 to non-sensitive codes", async () => {
    const failingMetadata: BoundedTransport = {
      requestJson: async () => { throw new Error("Bearer secret"); },
      requestBytes: async () => Buffer.from(card()),
    };
    await expect(preflightStackAccess(await run({ transport: failingMetadata })))
      .rejects.toMatchObject({ code: "ACCESS_UNAVAILABLE", message: "ACCESS_UNAVAILABLE" });

    const badCard: BoundedTransport = {
      requestJson: async () => metadata(),
      requestBytes: async () => Uint8Array.of(0xff),
    };
    await expect(preflightStackAccess(await run({ transport: badCard })))
      .rejects.toMatchObject({ code: "CARD_UNAVAILABLE", message: "CARD_UNAVAILABLE" });
  });

  it("keeps the status class of a failed request, and passes a run stop or a spent budget through (#93)", async () => {
    const profile = await loadProfile();
    const runtimeFor = (fetchLike: typeof fetch, journal?: ReturnType<typeof openJournal>, signal?: AbortSignal) =>
      createPreparationRuntime(profile, { PATH: "/bin", HF_TOKEN: "revoked-token" }, createCapacityMeter({ limits: profile.capacity,
        githubQueryIds: profile.github.queries.map(({ id }) => id), stackLanguages: MAINSTREAM_LANGUAGES }), fetchLike, journal,
      signal ? { signal } : {});
    const answering = (status: number, body = "{}") => (async () => new Response(body, { status,
      headers: { "content-type": "application/json" } })) as typeof fetch;
    const failed = async (transport: BoundedTransport): Promise<unknown> =>
      preflightStackAccess(await run({ transport })).then(() => undefined, (error: unknown) => error);

    // A refused token and a Hub that is down keep the request's code, now with the answer's status class.
    const refused = await failed(runtimeFor(answering(401)).transport);
    expect(refused).toMatchObject({ name: "StackAccessError", code: "ACCESS_UNAVAILABLE", message: "ACCESS_UNAVAILABLE" });
    expect(failureDiagnostic(refused)).toEqual({ code: "ACCESS_UNAVAILABLE", statusClass: "4xx" });
    expect(failureDiagnostic(await failed(runtimeFor(answering(503)).transport))).toEqual({ code: "ACCESS_UNAVAILABLE", statusClass: "5xx" });
    // The card's request reports the same way, under its own code.
    let calls = 0;
    const cardRefused = (async () => (calls += 1) === 1
      ? new Response(JSON.stringify(metadata()), { status: 200, headers: { "content-type": "application/json" } })
      : new Response("", { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } })) as typeof fetch;
    expect(failureDiagnostic(await failed(runtimeFor(cardRefused).transport))).toEqual({ code: "CARD_UNAVAILABLE", statusClass: "4xx" });
    // A failure with no answer has no status class.
    const unreachable = (async () => { throw new Error("Bearer secret"); }) as typeof fetch;
    expect(failureDiagnostic(await failed(runtimeFor(unreachable).transport))).toEqual({ code: "ACCESS_UNAVAILABLE", statusClass: "none" });

    // An offline replay of a journal with no access check is a journal miss, not an access failure.
    const path = join(mkdtempSync(join(tmpdir(), "codeguessr-access-")), "run.jsonl");
    writeFileSync(path, `${JSON.stringify({ schema: JOURNAL_SCHEMA, discoveryComplete: true, entries: 0 })}\n`);
    const missed = await failed(runtimeFor(unreachable, openJournal({ mode: "offline", path })).transport);
    expect(missed).toMatchObject({ code: "JOURNAL_MISS" });
    expect(missed).not.toBeInstanceOf(StackAccessError);
    // An interruption during the check stops the run as itself.
    const interrupted = await failed(runtimeFor(answering(200), undefined, AbortSignal.abort()).transport);
    expect(interrupted).toBeInstanceOf(RunInterruptedError);
    expect(runStop(interrupted)).toBe(interrupted);
    // A spent request budget is reported as the budget.
    const spent = new CapacityError("REQUEST_COUNT");
    expect(await failed({ requestJson: async () => { throw spent; }, requestBytes: async () => Buffer.from(card()) })).toBe(spent);
    expect(await failed({ requestJson: async () => metadata(), requestBytes: async () => { throw spent; } })).toBe(spent);
  });

  it("exposes stable preflight errors", () => {
    const error = new StackAccessError("ACCESS_DENIED");
    expect(error.name).toBe("StackAccessError");
    expect(error.message).toBe("ACCESS_DENIED");
  });
});
