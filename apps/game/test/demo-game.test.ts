import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { DEMO_MODE, createDemoReveal } from "../src/demo/demo-game.js";

const request = (overrides: Partial<Parameters<typeof createDemoReveal>[0]> = {}) => ({
  roundId: "demo-round-1",
  roundVersionId: "demo-round-version-1",
  candidateId: "recorded-model-output",
  completedRounds: 0,
  currentScore: 0,
  cluesUsed: 0,
  ...overrides,
});

describe("playable synthetic demo", () => {
  it("publishes a frozen five-round GeoGuessr-for-code run without protected answers", () => {
    expect(DEMO_MODE.rounds).toHaveLength(5);
    expect(DEMO_MODE.rounds.map(({ mode }) => mode.kind)).toEqual([
      "provenance", "provenance", "provenance", "language", "language",
    ]);
    expect(Object.isFrozen(DEMO_MODE)).toBe(true);
    expect(JSON.stringify(DEMO_MODE)).not.toMatch(/correctCandidate|futureAnswers|restrictedEvidence/iu);
  });

  it("scores a correct no-clue answer and returns a minimal evidence-backed reveal", () => {
    const reveal = createDemoReveal(request());

    expect(reveal.correct).toBe(true);
    expect(reveal.score).toBe(1000);
    expect(reveal.result).toEqual({
      score: 1000,
      attainableMaximum: 5000,
      completedRounds: 1,
      resultVersionId: "demo-result-v1-round-1",
    });
    expect(reveal.evidence).toMatch(/synthetic demo fixture/iu);
    expect(JSON.stringify(reveal)).not.toMatch(/prompt|reviewer|signature|deployment/iu);
  });

  it("applies the frozen clue values and carries the demo score between rounds", () => {
    expect(createDemoReveal(request({ cluesUsed: 1 })).score).toBe(800);
    expect(createDemoReveal(request({ cluesUsed: 2 })).score).toBe(500);

    const wrong = createDemoReveal(request({
      roundId: "demo-round-2",
      roundVersionId: "demo-round-version-2",
      candidateId: "project-owned-human",
      completedRounds: 1,
      currentScore: 800,
      cluesUsed: 2,
    }));
    expect(wrong.correct).toBe(false);
    expect(wrong.score).toBe(0);
    expect(wrong.result.score).toBe(800);
    expect(wrong.result.completedRounds).toBe(2);
  });

  it("fails closed on out-of-order, drifted, unknown, and extra demo requests", () => {
    expect(() => createDemoReveal(request({ completedRounds: 1 }))).toThrow(/order/iu);
    expect(() => createDemoReveal(request({
      roundId: "demo-round-2",
      roundVersionId: "demo-round-version-2",
      completedRounds: 1,
      currentScore: 1,
    }))).toThrow(/score/iu);
    expect(() => createDemoReveal(request({ roundVersionId: "drift" }))).toThrow(/version/iu);
    expect(() => createDemoReveal(request({ candidateId: "unknown" }))).toThrow(/candidate/iu);
    expect(() => createDemoReveal({ ...request(), deployment: "READY" } as Parameters<typeof createDemoReveal>[0]))
      .toThrow(/shape/iu);
  });

  it("mounts the existing arcade shell through an explicit server-backed demo action", () => {
    const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
    const actions = readFileSync(new URL("../src/app/actions.ts", import.meta.url), "utf8");
    const mount = readFileSync(new URL("../src/demo/demo-arcade.tsx", import.meta.url), "utf8");
    const rehearsal = readFileSync(
      new URL("../src/demo/rehearsal-catalogue.ts", import.meta.url),
      "utf8",
    );

    expect(page).toContain("DemoArcade");
    expect(page).toContain("activeLocalRealExperiment");
    expect(page).toContain("authorizeLocalExperimentReveal");
    expect(page).not.toContain("ACTIVE_REHEARSAL_CATALOGUE");
    expect(rehearsal).toContain("Synthetic local demo");
    expect(mount).toContain("ArcadeShell");
    expect(mount).toContain("dynamic");
    expect(mount).toContain("ssr: false");
    expect(actions).toContain('"use server"');
    expect(actions).toContain("activeLocalRealExperiment");
    expect(actions).toContain("createReveal");
    expect(actions).not.toContain("ACTIVE_REHEARSAL_CATALOGUE");
    expect(actions).not.toMatch(/READY|APPROVED|invitation|deployment/gu);
  });
});
