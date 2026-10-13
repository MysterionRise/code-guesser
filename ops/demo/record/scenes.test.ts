import { DEFAULT_ANSWER_CHOREOGRAPHY, DEMO_SCENE, SCENES, parseAnswerChoreography } from "./scenes";

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

  it("records one scene per deck, each opened through the deck parameter, plus a full run with the MP4", () => {
    expect(SCENES.map(({ id }) => id)).toEqual([
      "demo", "deck-project", "deck-language", "deck-before-after", "deck-algorithm", "deck-output", "deck-fix", "full-run",
    ]);
    expect(SCENES.filter(({ mp4 }) => mp4).map(({ id, mp4 }) => `${id}:${mp4}`)).toEqual(["full-run:codeguessr-demo"]);
    for (const deck of ["project", "language", "before-after", "algorithm", "output", "fix"]) {
      const scene = SCENES.find(({ id }) => id === `deck-${deck}`)!;
      expect(scene.steps[0]).toEqual({ kind: "goto", path: `/?deck=${deck}` });
    }
  });

  it("starts the full run at the chooser and ends it by choosing another deck", () => {
    const steps = SCENES.find(({ id }) => id === "full-run")!.steps;
    expect(steps[0]).toEqual({ kind: "goto", path: "/" });
    expect(steps).toContainEqual({ kind: "link", name: "Which project?" });
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

  it("records the headline demo vertically, through every deck, answering each round right", () => {
    expect(DEMO_SCENE.viewport).toEqual({ width: 360, height: 640 });
    expect(DEMO_SCENE.viewport!.height / DEMO_SCENE.viewport!.width).toBeCloseTo(16 / 9, 2);
    expect(DEMO_SCENE.captionStyle).toBe("sticker");
    const visited = DEMO_SCENE.steps.flatMap((step: any) => step.kind === "goto" && step.path.startsWith("/?deck=") ? [step.path.slice(7)] : []);
    expect(visited.sort()).toEqual(["algorithm", "before-after", "fix", "language", "output", "project"]);
    const answers = DEMO_SCENE.steps.filter((step: any) => step.kind === "answer");
    const verdicts = DEMO_SCENE.steps.filter((step: any) => step.kind === "expectHeading" && step.pattern === "^Nice read\\.$");
    expect(answers).toHaveLength(6);
    expect(verdicts).toHaveLength(6);
    expect(DEMO_SCENE.steps.some((step: any) => step.kind === "choose")).toBe(false);
    // Rounds are dealt at random, so no caption may name an answer, only the deck and the points.
    const captions = DEMO_SCENE.steps.flatMap((step: any) => step.kind === "caption" ? [step.text] : []);
    expect(captions.join(" ")).not.toMatch(/quicksort|merge sort|python|java|rust|line \d/iu);
  });
});
