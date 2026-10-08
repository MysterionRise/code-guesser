import { DEFAULT_ANSWER_CHOREOGRAPHY, SCENES, parseAnswerChoreography } from "./scenes";

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

  it("records three scenes with distinct outputs and one MP4", () => {
    expect(SCENES.map(({ id }) => id)).toEqual(["01-read-the-code", "02-lock-in", "03-full-run"]);
    expect(SCENES.filter(({ mp4 }) => mp4).map(({ mp4 }) => mp4)).toEqual(["codeguessr-demo"]);
    for (const scene of SCENES) expect(scene.steps[0]).toEqual({ kind: "goto" });
  });
});
