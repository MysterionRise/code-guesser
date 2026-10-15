import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  QUESTION_LAYER_SCHEMA_VERSION, QuestionLayerRejected, canonicalHash, labelStems, parseArtifactDecks, parseQuestionLayer, parseQuestionLayers,
  type LayerContext, type ParsedFixture,
} from "../src/index";

const artifact = JSON.parse(readFileSync(new URL("../../../apps/game/src/demo/generated/local-real-rounds.json", import.meta.url), "utf8"));
const decks = parseArtifactDecks(artifact);
const context: LayerContext = { decks, algorithms: artifact.crawlSnapshot.curated.algorithms };
const artifactHash = canonicalHash(artifact);
const fixtureOf = (deck: string): ParsedFixture => decks.find(({ id }) => id === deck)!.fixtures[0]!;
const algorithm = fixtureOf("algorithm");
const language = fixtureOf("language");
/** The masked name as this round's code spells it: `mystery` in Python and Go, `Mystery` for a Java class. */
const masked = /\b([Mm]ystery)\b/u.exec(algorithm.panes[0]!.text)![1]!;

const traceIt = (overrides: Record<string, unknown> = {}) => ({
  roundId: algorithm.roundId,
  design: "trace-it",
  scaffold: { watch: [{ name: masked, role: "the input" }] },
  hints: [
    { kind: "text", text: "It needs a list it may rearrange." },
    { kind: "trace", text: "Follow the list as the loop runs.", input: "[3, 1, 2]",
      frames: [{ label: "Start", state: "[3, 1, 2]" }, { label: "Step 1", state: "[1, 3, 2]" }] },
  ],
  ...overrides,
});
const markerHunt = (overrides: Record<string, unknown> = {}) => ({
  roundId: language.roundId,
  design: "marker-hunt",
  scaffold: { prompts: ["How does a block of code end?", "How is a new name declared?", "How are comments written?"] },
  hints: [{ kind: "lines", text: "These lines decide it.", lines: [1] }, { kind: "text", text: "Look at how the block closes." }],
  ...overrides,
});
const rejection = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof QuestionLayerRejected) return error.code;
    throw error;
  }
  return "ACCEPTED";
};

describe("the committed question layers (#127)", () => {
  const layersText = readFileSync(new URL("../../../apps/game/src/demo/generated/question-layers.json", import.meta.url), "utf8");
  const pin = /"([0-9a-f]{64})"/u.exec(readFileSync(new URL("../../../apps/game/src/demo/question-layers.pin.server.ts", import.meta.url), "utf8"))![1];

  it("were written for the committed artifact, pass every check, and match their pin", () => {
    const file = parseQuestionLayers(JSON.parse(layersText), artifactHash, context);
    expect(canonicalHash(JSON.parse(layersText))).toBe(pin);
    expect(file.layers.length).toBeGreaterThan(0);
    const designed = new Map(decks.flatMap((deck) => deck.fixtures.map((fixture) => [fixture.roundId, deck.id] as const)));
    expect(new Set(file.layers.map(({ roundId }) => designed.get(roundId)))).toEqual(new Set(["algorithm", "language"]));
  });
});

describe("question layers (#127)", () => {
  it("accepts a layer that names no option and points only at the round's own code", () => {
    expect(parseQuestionLayer(traceIt(), algorithm, "algorithm", context).design).toBe("trace-it");
    expect(parseQuestionLayer(markerHunt(), language, "language", context).hints[0]).toEqual({ kind: "lines", text: "These lines decide it.", lines: [1] });
  });

  it("refuses an algorithm layer that names an option by label, spelling, or stem", () => {
    const [label] = algorithm.candidates.map((candidate) => candidate.label);
    const named = traceIt({ hints: [{ kind: "text", text: `This is ${label}.` }, traceIt().hints[1]] });
    expect(rejection(() => parseQuestionLayer(named, algorithm, "algorithm", context))).toBe("NAMES_OPTION");
    // A decoy's stem counts too, inside a longer word: `heap` in "heaped" rules Heapsort in or out alike.
    const stem = algorithm.candidates.flatMap(({ label: option }) => labelStems(option)).at(-1)!;
    const stemmed = traceIt({ hints: [{ kind: "text", text: `Values get ${stem}ed here.` }, traceIt().hints[1]] });
    expect(rejection(() => parseQuestionLayer(stemmed, algorithm, "algorithm", context))).toBe("NAMES_OPTION");
  });

  it("refuses a language layer that names any language, in any case, or a file extension", () => {
    for (const text of ["Typical of Python.", "typical of python.", "As in Go.", "Pointers, as in C.", "C++ templates.", "A .rb file."]) {
      const layer = markerHunt({ hints: [markerHunt().hints[0], { kind: "text", text }] });
      expect(rejection(() => parseQuestionLayer(layer, language, "language", context)), text).toBe("NAMES_LANGUAGE");
    }
    // "C" inside a word, or "go" as English, lower case, is not a language name.
    const plain = markerHunt({ hints: [markerHunt().hints[0], { kind: "text", text: "Compare how each call goes." }] });
    expect(rejection(() => parseQuestionLayer(plain, language, "language", context))).toBe("ACCEPTED");
  });

  it("refuses lines outside the pane, names the code doesn't show, and the wrong design", () => {
    const lines = language.panes[0]!.text.split("\n").length;
    expect(rejection(() => parseQuestionLayer(markerHunt({ hints: [{ kind: "lines", text: "Here.", lines: [lines + 1] }, markerHunt().hints[1]] }),
      language, "language", context))).toBe("LINE_RANGE");
    expect(rejection(() => parseQuestionLayer(traceIt({ scaffold: { watch: [{ name: "notInTheCode", role: "a list" }] } }),
      algorithm, "algorithm", context))).toBe("WATCH_NAME");
    // A scaffold says what kind of value a name holds from a closed list, and asks only the bank's questions.
    expect(rejection(() => parseQuestionLayer(traceIt({ scaffold: { watch: [{ name: masked, role: "the index computed from the target" }] } }),
      algorithm, "algorithm", context))).toBe("WATCH_KIND");
    expect(rejection(() => parseQuestionLayer(markerHunt({ scaffold: { prompts: ["Where is the annotation?", "How is a loop written?", "How are comments written?"] } }),
      language, "language", context))).toBe("PROMPT");
    expect(rejection(() => parseQuestionLayer(markerHunt({ scaffold: { prompts: ["How is a loop written?", "How is a loop written?", "How are comments written?"] } }),
      language, "language", context))).toBe("PROMPT");
    expect(rejection(() => parseQuestionLayer(markerHunt(), language, "algorithm", context))).toBe("SHAPE");
    expect(rejection(() => parseQuestionLayer(markerHunt(), fixtureOf("fix"), "fix", context))).toBe("DECK");
  });

  it("takes plain, bounded text only, and exact keys", () => {
    for (const text of ["See https://example.org", "Two\nlines", "<b>bold</b>", "x".repeat(201), " padded", "[link](x)", "Ask @someone"]) {
      const layer = markerHunt({ hints: [markerHunt().hints[0], { kind: "text", text }] });
      expect(rejection(() => parseQuestionLayer(layer, language, "language", context)), text).toBe("TEXT");
    }
    expect(rejection(() => parseQuestionLayer({ ...markerHunt(), extra: 1 }, language, "language", context))).toBe("SHAPE");
    expect(rejection(() => parseQuestionLayer(markerHunt({ scaffold: { prompts: ["How is a loop written?", "How are comments written?"] } }), language, "language", context))).toBe("SCAFFOLD");
  });

  it("binds the file to its artifact and keeps layers in round order", () => {
    const layers = [traceIt(), markerHunt()].sort((left, right) => left.roundId < right.roundId ? -1 : 1);
    const file = { schemaVersion: QUESTION_LAYER_SCHEMA_VERSION, artifactHash, model: "anthropic/claude-haiku-5.5", layers };
    expect(parseQuestionLayers(file, artifactHash, context).layers).toHaveLength(2);
    expect(rejection(() => parseQuestionLayers(file, "0".repeat(64), context))).toBe("FILE");
    expect(rejection(() => parseQuestionLayers({ ...file, layers: [...layers].reverse() }, artifactHash, context))).toBe("ORDER");
    expect(rejection(() => parseQuestionLayers({ ...file, layers: [...layers, layers[0]] }, artifactHash, context))).toBe("ORDER");
    expect(rejection(() => parseQuestionLayers({ ...file, layers: [{ ...layers[0], roundId: "local-unknown" }] }, artifactHash, context))).toBe("ROUND");
  });
});
