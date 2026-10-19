import { DEAL_SEEDS, DECKS, DEFAULT_ANSWER_CHOREOGRAPHY, DEMO_SCENE, MIXED_CARD, SCENES, parseAnswerChoreography } from "./scenes";

// The operator typecheck keeps vitest types out of its program, as the other ops suites do.
const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

describe("demo recorder scenes", () => {
  it("defaults the answer choreography and parses a five-index override", () => {
    expect(parseAnswerChoreography(undefined)).toBe(DEFAULT_ANSWER_CHOREOGRAPHY);
    expect(parseAnswerChoreography("  ")).toBe(DEFAULT_ANSWER_CHOREOGRAPHY);
    expect(parseAnswerChoreography("0, 1,1,0,1")).toEqual([0, 1, 1, 0, 1]);
    for (const bad of ["0,1", "0,1,1,0,4", "a,b,c,d,e", "0,1,1,0,-1"]) {
      expect(() => parseAnswerChoreography(bad)).toThrow(RangeError);
    }
  });

  it("records one scene per deck, each at its fixed deal with the static design, plus a full run with the MP4", () => {
    expect(SCENES.map(({ id }) => id)).toEqual(["demo", ...DECKS.map((deck) => `deck-${deck}`), "full-run"]);
    expect(SCENES.filter(({ mp4 }) => mp4).map(({ id, mp4 }) => `${id}:${mp4}`)).toEqual(["full-run:codeguessr-demo"]);
    for (const deck of DECKS) {
      const scene = SCENES.find(({ id }) => id === `deck-${deck}`)!;
      expect(scene.steps[0]).toMatchObject({ kind: "goto" });
      const query = new URLSearchParams((scene.steps[0] as { path: string }).path.slice(2));
      expect(Object.fromEntries(query)).toMatchObject({ deck, deal: DEAL_SEEDS[deck], game: "0", design: "off" });
      expect(DEAL_SEEDS[deck]).toMatch(/^[0-9a-f]{8}$/u);
    }
  });

  it("shows the question layers in the two decks that have them, and steps through an algorithm's trace", () => {
    for (const deck of ["algorithm", "language"]) {
      const path = (SCENES.find(({ id }) => id === `deck-${deck}`)!.steps[0] as { path: string }).path;
      expect(path).toContain("layer=on");
    }
    const algorithm = SCENES.find(({ id }) => id === "deck-algorithm")!.steps;
    expect(algorithm).toContainEqual({ kind: "click", name: "Reveal hint 2" });
    expect(algorithm).toContainEqual({ kind: "scrollTo", selector: ".trace-stepper" });
  });

  it("starts the full run at the chooser, plays a mixed game, and ends it by choosing another deck", () => {
    const steps = SCENES.find(({ id }) => id === "full-run")!.steps;
    expect(steps[0]).toMatchObject({ kind: "goto", path: expect.stringMatching(/^\/\?design=off&/u) });
    expect(steps).toContainEqual({ kind: "link", name: MIXED_CARD });
    const last = steps.filter(({ kind }) => kind === "link").at(-1);
    expect(last).toEqual({ kind: "link", name: "Choose another deck" });
    expect(steps.filter((step) => step.kind === "click" && step.name === "Lock in answer")).toHaveLength(5);
  });

  it("only picks the first two answers in the two-choice before-or-after deck", () => {
    const beforeAfter = SCENES.find(({ id }) => id === "deck-before-after")!;
    for (const step of beforeAfter.steps) if (step.kind === "choose") expect(step.index).toBeLessThan(2);
  });

  it("captions the before-or-after deck with where its answers come from", () => {
    const captions = SCENES.find(({ id }) => id === "deck-before-after")!.steps
      .flatMap((step) => step.kind === "caption" ? [step.text] : []);
    expect(captions.some((text) => /commit/iu.test(text))).toBe(true);
    expect(captions.join(" ")).not.toMatch(/human[- ]written|detect|AI-generated/iu);
  });

  it("records the headline demo vertically, through seven decks in three themes and both question layers, answering each round right", () => {
    expect(DEMO_SCENE.viewport).toEqual({ width: 360, height: 640 });
    expect(DEMO_SCENE.viewport!.height / DEMO_SCENE.viewport!.width).toBeCloseTo(16 / 9, 2);
    expect(DEMO_SCENE.captionStyle).toBe("sticker");
    const games = DEMO_SCENE.steps.flatMap((step: any) => step.kind === "goto" && step.path.includes("deck=")
      ? [Object.fromEntries(new URLSearchParams(step.path.slice(2)))] : []);
    expect(new Set(games.map(({ deck }) => deck)).size).toBe(7);
    expect(games.filter(({ layer }) => layer === "on").map(({ deck }) => deck).sort()).toEqual(["algorithm", "language"]);
    expect(new Set(games.map(({ theme }) => theme)).size).toBeGreaterThanOrEqual(3);
    for (const game of games) expect(game).toMatchObject({ deal: DEAL_SEEDS[game.deck as keyof typeof DEAL_SEEDS], design: "off" });
    const answers = DEMO_SCENE.steps.filter((step: any) => step.kind === "answer");
    const verdicts = DEMO_SCENE.steps.filter((step: any) => step.kind === "expectHeading" && step.pattern === "^Nice read\\.$");
    expect(answers).toHaveLength(7);
    expect(verdicts).toHaveLength(7);
    expect(DEMO_SCENE.steps.some((step: any) => step.kind === "choose")).toBe(false);
    // No caption may name an answer, only the deck and the points.
    const captions = DEMO_SCENE.steps.flatMap((step: any) => step.kind === "caption" ? [step.text] : []);
    expect(captions.join(" ")).not.toMatch(/search|svelte|react|python|java|rust|go\b|line \d|collatz|getmin|pop\b/iu);
  });
});
