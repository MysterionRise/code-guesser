import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArtifactDecks } from "../../../packages/artifact/src/index";
import { ROUND_HINT_LIFT } from "./audit";
import { QuestionsError, openRouterClient, type ModelAnswer, type ModelClient, type ModelRequest } from "./client";
import { parseQuestionsArguments } from "./index";
import { prepareQuestions } from "./prepare";

// The operator typecheck keeps vitest types out of its program, as the other ops suites do.
const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const artifact = JSON.parse(readFileSync(new URL("../../../apps/game/src/demo/generated/local-real-rounds.json", import.meta.url), "utf8"));
const decks = parseArtifactDecks(artifact);
const answers = new Map(decks.flatMap((deck) => deck.fixtures.map((fixture) =>
  [fixture.roundId, fixture.candidates.findIndex(({ id }) => id === fixture.correctCandidateId)] as const)));

const roundOf = (request: ModelRequest) => JSON.parse(request.user.slice(request.user.indexOf("{"), request.user.lastIndexOf("}") + 1));

/** A layer that passes every check, built from what the writer is shown. */
const goodLayer = (request: ModelRequest): unknown => {
  const round = roundOf(request);
  if (request.tool.name === "write_trace_it") {
    const name = /\b([Mm]ystery)\b/u.exec(round.code[0].numberedLines)![1];
    return { watch: [{ name, role: "the input" }], need: "It takes a list of numbers.", traceIntro: "Follow the values step by step.",
      traceInput: "[3, 1, 2]", frames: [{ label: "Start", state: "[3, 1, 2]" }, { label: "Then", state: "[1, 2, 3]" }] };
  }
  return { prompts: ["How does a block of code end?", "How is a new name declared?", "How are comments written?"],
    decidingLines: { text: "Look at these lines.", lines: [1] }, feature: "The way a block closes decides it." };
};

interface FakeOptions {
  /** The writer's layer for a request; the good one when unset. */
  readonly write?: (request: ModelRequest, attempt: number) => unknown;
  /** The solver's probability on the answer, by aid: none, scaffold, scaffold and hint. */
  readonly solve?: (aid: number) => number;
}

/** A model client that answers like the real one would, with no network. */
const fakeClient = (options: FakeOptions = {}): ModelClient & { readonly requests: ModelRequest[] } => {
  const requests: ModelRequest[] = [];
  const attempts = new Map<string, number>();
  return {
    model: "anthropic/claude-haiku-5.5",
    requests,
    counts: () => ({ replayed: 0, live: requests.length, tokensIn: 0, tokensOut: 0 }),
    call: async (request): Promise<ModelAnswer> => {
      requests.push(request);
      if (request.tool.name !== "answer") {
        const key = roundOf(request).question + JSON.stringify(roundOf(request).code);
        const attempt = attempts.get(key) ?? 0;
        attempts.set(key, attempt + 1);
        return { value: (options.write ?? goodLayer)(request, attempt), tokensIn: 1, tokensOut: 1 };
      }
      const round = roundOf(request);
      const fixture = decks.flatMap(({ fixtures }) => fixtures).find((candidate) => candidate.prompt === round.question
        && candidate.candidates.map(({ label, detail }) => (detail ? `${label}: ${detail}` : label)).join("|") === round.options.join("|"))!;
      const answer = answers.get(fixture.roundId)!;
      // The stage: 0 with only what the layer quotes from the code, 1 with the scaffold, 2 with hint 1 too.
      const aid: readonly string[] = round.studyAid ?? [];
      const p = (options.solve ?? (() => 0.25))(aid.filter((line) => !line.startsWith("Names the code shows")).length);
      return { value: { probabilities: round.options.map((_: string, index: number) => (index === answer ? p : (1 - p) / (round.options.length - 1))) }, tokensIn: 1, tokensOut: 1 };
    },
  };
};

const logs = () => { const lines: string[] = []; return { lines, log: (line: string) => { lines.push(line); } }; };

describe("prepare:questions (#127)", () => {
  it("writes a layer for every round of a designed deck, and none for the others", async () => {
    const client = fakeClient();
    const { lines, log } = logs();
    const prepared = await prepareQuestions({ artifact, client, log, limit: 3 });
    expect(prepared.file.layers.map(({ design }) => design).sort()).toEqual(["marker-hunt", "marker-hunt", "marker-hunt", "trace-it", "trace-it", "trace-it"]);
    expect(lines).toEqual(["QUESTIONS_DECK language attempted=3 kept=3", "QUESTIONS_DECK algorithm attempted=3 kept=3"]);
    // One writer call and three solver calls a round; the writer is told the answer, the solver never sees the code.
    expect(client.requests.filter(({ tool }) => tool.name === "answer")).toHaveLength(18);
    for (const request of client.requests.filter(({ tool }) => tool.name === "answer")) {
      expect(request.user).not.toMatch(/numberedLines|"answer"/u);
    }
    expect(client.requests.filter(({ tool }) => tool.name !== "answer").every((request) => /"answer":/u.test(request.user))).toBe(true);
    // The game words the lines hint itself, whatever the writer sent.
    expect(prepared.file.layers.filter(({ design }) => design === "marker-hunt").map(({ hints }) => hints[0].text)).toEqual(Array(3).fill("Look closely at line 1."));
  });

  it("repairs a refused layer once, telling the writer which check refused it", async () => {
    const client = fakeClient({ write: (request, attempt) => attempt === 0 && request.tool.name === "write_marker_hunt"
      ? { ...(goodLayer(request) as object), feature: "Typical of Python." } : goodLayer(request) });
    const prepared = await prepareQuestions({ artifact, client, log: () => {}, decks: ["language"], limit: 2 });
    expect(prepared.file.layers).toHaveLength(2);
    const repairs = client.requests.filter(({ user }) => user.includes("refused by the check NAMES_LANGUAGE"));
    expect(repairs).toHaveLength(2);
  });

  it("drops a layer that still fails its checks, and one the solver can read the answer from", async () => {
    const naming = fakeClient({ write: (request) => ({ ...(goodLayer(request) as object), feature: { text: "As in Rust." } }) });
    // (A nested `{ text }`, as models sometimes send it, is read the same as a string.)
    const { lines, log } = logs();
    expect((await prepareQuestions({ artifact, client: naming, log, decks: ["language"], limit: 2 })).file.layers).toEqual([]);
    expect(lines).toEqual(["QUESTIONS_DECK language attempted=2 kept=0 NAMES_LANGUAGE=2"]);

    const keyed = fakeClient({ solve: (aid) => (aid === 2 ? 0.26 + ROUND_HINT_LIFT : 0.25) });
    const second = logs();
    expect((await prepareQuestions({ artifact, client: keyed, log: second.log, decks: ["algorithm"], limit: 2 })).file.layers).toEqual([]);
    expect(second.lines).toEqual(["QUESTIONS_DECK algorithm attempted=2 kept=0 HINT_KEY=2"]);
  });

  it("refuses a layer a review found wrong without writing it, so the round plays static and costs no call", async () => {
    const [first, second] = decks.find(({ id }) => id === "algorithm")!.fixtures.map(({ roundId }) => roundId).sort();
    const client = fakeClient();
    const { lines, log } = logs();
    const prepared = await prepareQuestions({ artifact, client, log, decks: ["algorithm"], limit: 2, reviewed: { [second!]: "TRACE_WRONG" } });
    expect(prepared.file.layers.map(({ roundId }) => roundId)).toEqual([first]);
    expect(lines).toEqual(["QUESTIONS_DECK algorithm attempted=2 kept=1 REVIEW_TRACE_WRONG=1"]);
    // One writer and three solver calls, all for the first round.
    expect(client.requests).toHaveLength(4);
  });

  it("drops a whole deck whose scaffolds lift the answer too much on average, though no single round crosses its bound", async () => {
    const client = fakeClient({ solve: (aid) => (aid === 0 ? 0.25 : 0.45) });
    const { lines, log } = logs();
    const prepared = await prepareQuestions({ artifact, client, log, decks: ["algorithm"], limit: 3 });
    expect(prepared.file.layers).toEqual([]);
    expect(lines).toEqual(["QUESTIONS_DECK_REFUSED algorithm", "QUESTIONS_DECK algorithm attempted=3 kept=0"]);
    expect(prepared.decks[0]!.audit.within).toBe(false);
  });
});

describe("the question layers' model client (#127)", () => {
  const answer = (name: string, value: unknown) => ({ choices: [{ message: { tool_calls: [{ function: { name, arguments: JSON.stringify(value) } }] } }],
    usage: { prompt_tokens: 10, completion_tokens: 5 } });
  const request: ModelRequest = { system: "rules", user: "round", tool: { name: "answer", description: "d", parameters: {} }, maxTokens: 10 };
  const scratch = () => join(mkdtempSync(join(tmpdir(), "codeguessr-questions-")), "journal.jsonl");

  it("journals each answer under its request's hash and replays it, offline too, never storing the key", async () => {
    const journalPath = scratch();
    const sent: RequestInit[] = [];
    const fetcher = async (_url: unknown, init: RequestInit) => { sent.push(init); return new Response(JSON.stringify(answer("answer", { probabilities: [1] }))); };
    const live = openRouterClient({ model: "anthropic/claude-haiku-5.5", apiKey: "sk-or-secret", baseUrl: "http://fake", journalPath, mode: "resume", fetch: fetcher as typeof fetch });
    expect((await live.call(request)).value).toEqual({ probabilities: [1] });
    expect(live.counts()).toMatchObject({ live: 1, tokensIn: 10, tokensOut: 5 });
    expect(JSON.parse(String(sent[0]!.body))).toMatchObject({ provider: { data_collection: "deny" }, reasoning: { enabled: false }, tool_choice: { function: { name: "answer" } } });
    expect(readFileSync(journalPath, "utf8")).not.toContain("sk-or-secret");
    const offline = openRouterClient({ model: "anthropic/claude-haiku-5.5", apiKey: undefined, baseUrl: "http://fake", journalPath, mode: "offline" });
    expect((await offline.call(request)).value).toEqual({ probabilities: [1] });
    await expect(offline.call({ ...request, user: "another round" })).rejects.toThrow("JOURNAL_MISS");
  });

  it("retries a limited or failing provider once, then reports only its status", async () => {
    let calls = 0;
    const flaky = async () => (calls += 1) === 1 ? new Response("slow down", { status: 429 }) : new Response(JSON.stringify(answer("answer", { ok: true })));
    const client = openRouterClient({ model: "m/x", apiKey: "k", baseUrl: "http://fake", journalPath: scratch(), mode: "fresh", fetch: flaky as typeof fetch, wait: async () => {} });
    expect((await client.call(request)).value).toEqual({ ok: true });
    const spent = openRouterClient({ model: "m/x", apiKey: "k", baseUrl: "http://fake", journalPath: scratch(), mode: "fresh",
      fetch: (async () => new Response("provider body with detail", { status: 402 })) as typeof fetch, wait: async () => {} });
    await expect(spent.call(request)).rejects.toThrow(new QuestionsError("QUESTIONS_PROVIDER_402"));
    const wrongTool = openRouterClient({ model: "m/x", apiKey: "k", baseUrl: "http://fake", journalPath: scratch(), mode: "fresh",
      fetch: (async () => new Response(JSON.stringify(answer("other", {})))) as typeof fetch });
    await expect(wrongTool.call(request)).rejects.toThrow("QUESTIONS_MALFORMED");
    const keyless = openRouterClient({ model: "m/x", apiKey: "", baseUrl: "http://fake", journalPath: scratch(), mode: "resume" });
    await expect(keyless.call(request)).rejects.toThrow("OPENROUTER_KEY_MISSING");
  });

  it("takes only its own flags", () => {
    expect(parseQuestionsArguments([])).toEqual({ mode: "resume" });
    expect(parseQuestionsArguments(["--offline", "--decks=algorithm,language", "--limit=4"])).toEqual({ mode: "offline", decks: ["algorithm", "language"], limit: 4 });
    for (const argv of [["--offline", "--fresh"], ["--decks=algo"], ["--limit=0"], ["--model=Bad Model"], ["--token=x"]]) {
      expect(parseQuestionsArguments(argv)).toBeUndefined();
    }
  });
});
