import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// Counts the game's parses and hashes, which reach the shared parser through its index.
vi.mock("../../../packages/artifact/src/index", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../packages/artifact/src/index")>();
  return { ...original, canonicalHash: vi.fn(original.canonicalHash), parseArtifactDecks: vi.fn(original.parseArtifactDecks) };
});

const { loadLocalRealExperiment } = await import("../src/demo/local-real-experiment-loader.server");
const { canonicalHash, parseArtifactDecks } = await import("../../../packages/artifact/src/index");
const { projectHintDetail } = await import("../src/components/arcade/arcade-session");

const ARTIFACT_PATH = fileURLToPath(new URL("../src/demo/generated/local-real-rounds.json", import.meta.url));
const LAYERS_PATH = fileURLToPath(new URL("../src/demo/generated/question-layers.json", import.meta.url));
const layersFile = JSON.parse(readFileSync(LAYERS_PATH, "utf8")) as { layers: { roundId: string; design: string; hints: { text: string }[] }[] };
const layered = new Map(layersFile.layers.map((layer) => [layer.roundId, layer]));

const experimentWith = (layers: { path?: string; trustedHash?: string } = { path: LAYERS_PATH }) => {
  const loaded = loadLocalRealExperiment({ artifactPath: ARTIFACT_PATH, layers });
  if (!loaded.ok) throw new Error("committed artifact unavailable");
  return loaded.experiment;
};
const ARMS = { design: "off", theme: "terminal" } as const;
/** Deals until a game's first round has a layer, so the test reads a layered round whatever the seed. */
const layeredGame = (experiment: ReturnType<typeof experimentWith>, deck: "algorithm" | "language", layer: "on" | "off") => {
  for (let seed = 1; seed < 200; seed += 1) {
    let state = seed;
    const random = () => { state = (state * 1103515245 + 12345) % 2147483648; return state / 2147483648; };
    const dealt = experiment.dealGame(deck, random, Date.now(), { arms: { ...ARMS, layer }, record: false });
    if (layered.has(dealt.mode.rounds[0]!.roundId)) return dealt;
  }
  throw new Error("no layered first round");
};

describe("question layers in the game (#128)", () => {
  it("deals a layered round its scaffold and sells the layer's hints, with what each shows beside its text", () => {
    const experiment = experimentWith();
    const dealt = layeredGame(experiment, "algorithm", "on");
    const round = dealt.mode.rounds[0]!;
    expect(round.scaffold?.design).toBe("trace-it");
    const layer = layered.get(round.roundId)!;
    const first = experiment.revealHint({ sessionToken: dealt.sessionToken, roundId: round.roundId }) as any;
    expect(first).toMatchObject({ ok: true, hint: layer.hints[0]!.text });
    expect(first.detail).toBeUndefined();
    const second = experiment.revealHint({ sessionToken: first.sessionToken, roundId: round.roundId }) as any;
    expect(second).toMatchObject({ ok: true, hint: layer.hints[1]!.text, detail: { kind: "trace" } });
    expect(projectHintDetail(second.detail)).toEqual(second.detail);

    const language = layeredGame(experiment, "language", "on");
    const hint = experiment.revealHint({ sessionToken: language.sessionToken, roundId: language.mode.rounds[0]!.roundId }) as any;
    expect(language.mode.rounds[0]!.scaffold?.design).toBe("marker-hunt");
    expect(hint.detail).toEqual({ kind: "lines", lines: expect.any(Array) });
    expect(hint.hint).toMatch(/^Look closely at lines? /u);
  });

  it("deals a game drawn without layers the static question and hints", () => {
    const experiment = experimentWith();
    const dealt = layeredGame(experiment, "algorithm", "off");
    const round = dealt.mode.rounds[0]!;
    expect(round.scaffold).toBeUndefined();
    const hint = experiment.revealHint({ sessionToken: dealt.sessionToken, roundId: round.roundId }) as any;
    expect(hint.ok).toBe(true);
    expect(hint.hint).not.toBe(layered.get(round.roundId)!.hints[0]!.text);
    expect(hint.detail).toBeUndefined();
  });

  it("shows no layers at all when the file doesn't match its pin or is missing", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    for (const options of [{ path: LAYERS_PATH, trustedHash: "0".repeat(64) }, { path: "/no/such/question-layers.json" }]) {
      const experiment = experimentWith(options);
      for (let seed = 0; seed < 5; seed += 1) {
        const dealt = experiment.dealGame("algorithm", Math.random, Date.now(), { arms: { ...ARMS, layer: "on" }, record: false });
        expect(dealt.mode.rounds.every(({ scaffold }) => scaffold === undefined)).toBe(true);
      }
    }
    expect(logged.mock.calls.map(([line]) => line)).toEqual(["QUESTION_LAYERS_UNAVAILABLE QUESTION_LAYERS_PIN"]);
    logged.mockRestore();
  });

  it("loads the artifact with one parse and one hash, and checks the layers against them (#166)", () => {
    vi.mocked(parseArtifactDecks).mockClear();
    vi.mocked(canonicalHash).mockClear();
    const experiment = experimentWith();
    expect(parseArtifactDecks).toHaveBeenCalledTimes(1);
    expect(vi.mocked(canonicalHash).mock.calls.filter(([value]) => typeof value === "object" && value !== null && "crawlSnapshot" in value))
      .toHaveLength(1);
    expect(layeredGame(experiment, "algorithm", "on").mode.rounds[0]!.scaffold?.design).toBe("trace-it");
  });

  it("refuses a hint detail that isn't one of the two shapes", () => {
    for (const junk of [null, "lines", { kind: "lines", lines: [] }, { kind: "lines", lines: [0] }, { kind: "lines", lines: [1, 2, 3] },
      { kind: "lines", lines: [1], extra: true }, { kind: "trace", input: "x", frames: [{ label: "a", state: "b" }] },
      { kind: "trace", input: "x", frames: [{ label: "a" }, { label: "b", state: "c" }] }, { kind: "html", html: "<b>" }]) {
      expect(() => projectHintDetail(junk), JSON.stringify(junk)).toThrow("invalid hint detail");
    }
  });
});
