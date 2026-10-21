import { describe, expect, it, vi } from "vitest";

import { CONTROL, FACTORS, assignArms, effectiveWeights, labMode, labOverrides, parseArms, parseDisabled, type Arms } from "../src/experiment/arms";
import { SOURCES } from "../src/experiment/events";

vi.mock("server-only", () => ({}));

const { eventSource } = await import("../src/experiment/event-store.server");

/** A small deterministic generator, so draws are repeatable. */
const seeded = (seed: number) => () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
};

const draws = (count: number, options: Omit<Parameters<typeof assignArms>[0], "random">): Arms[] => {
  const random = seeded(7);
  return Array.from({ length: count }, () => assignArms({ ...options, random }));
};

const share = (arms: readonly Arms[], factor: keyof Arms, level: string): number =>
  arms.filter((value) => value[factor] === level).length / arms.length;

describe("experiment arms (#106)", () => {
  it("draws every level of every factor by its committed weight", () => {
    const arms = draws(20_000, { genuiEnabled: true, disabled: new Set() });
    for (const level of FACTORS.design) expect(share(arms, "design", level)).toBeCloseTo(0.2, 1);
    for (const level of FACTORS.theme) expect(share(arms, "theme", level)).toBeCloseTo(0.25, 1);
    for (const level of FACTORS.layer) expect(share(arms, "layer", level)).toBeCloseTo(0.5, 1);
  });

  it("draws factors independently, so every design meets every other factor's levels at its own rate", () => {
    const arms = draws(20_000, { genuiEnabled: true, disabled: new Set() });
    const host = arms.filter(({ design }) => design === "host");
    expect(host.length / arms.length).toBeCloseTo(0.2, 1);
    for (const level of FACTORS.theme) expect(share(host, "theme", level)).toBeCloseTo(0.25, 1);
  });

  it("gives a switched-off level's weight to the control level, and never switches control off", () => {
    const disabled = parseDisabled("design:host, design:visualizer,design:off,theme:nope,junk,design:catalog:extra");
    expect([...disabled].sort()).toEqual(["design:host", "design:off", "design:visualizer"]);
    expect(effectiveWeights("design", disabled)).toEqual([3, 1, 1, 0, 0]);
    const arms = draws(20_000, { genuiEnabled: true, disabled });
    expect(share(arms, "design", "host")).toBe(0);
    expect(share(arms, "design", "visualizer")).toBe(0);
    expect(share(arms, "design", "off")).toBeCloseTo(0.6, 1);
  });

  it("deals the static game when generative UI is off, whatever the draw or override", () => {
    const arms = draws(500, { genuiEnabled: false, disabled: new Set(), overrides: { design: "host" } });
    expect(share(arms, "design", "off")).toBe(1);
  });

  it("lets a lab tester pick levels by query, and only in lab mode", () => {
    expect(labMode({ EXPERIMENT_LAB: "1", NODE_ENV: "production" })).toBe(true);
    expect(labMode({ NODE_ENV: "development" })).toBe(true);
    expect(labMode({ NODE_ENV: "production" })).toBe(false);
    expect(labMode({ EXPERIMENT_LAB: "yes", NODE_ENV: "production" })).toBe(false);
    // A public server (#97) keeps the draw, except on a smoke run whose events never mix with real games.
    for (const source of [...SOURCES, undefined, "admin"]) {
      const smoke = eventSource({ EXPERIMENT_SOURCE: source }) !== "real";
      expect(labMode({ CODEGUESSR_PUBLIC: "1", EXPERIMENT_LAB: "1", EXPERIMENT_SOURCE: source, NODE_ENV: "production" })).toBe(smoke);
      expect(labMode({ CODEGUESSR_PUBLIC: "1", EXPERIMENT_SOURCE: source, NODE_ENV: "development" })).toBe(smoke);
    }
    expect(labMode({ CODEGUESSR_PUBLIC: "0", EXPERIMENT_LAB: "1", NODE_ENV: "production" })).toBe(true);
    const overrides = labOverrides({ design: "composer", theme: ["paper"], layer: "sideways", deck: "fix" });
    expect(overrides).toEqual({ design: "composer" });
    expect(assignArms({ genuiEnabled: true, disabled: new Set(), overrides, random: seeded(1) }).design).toBe("composer");
  });

  it("parses only exact arms with known levels", () => {
    expect(parseArms(CONTROL)).toEqual(CONTROL);
    expect(parseArms({ ...CONTROL, extra: 1 })).toBeNull();
    expect(parseArms({ design: "off", theme: "terminal" })).toBeNull();
    expect(parseArms({ ...CONTROL, theme: "neon" })).toBeNull();
    expect(parseArms(null)).toBeNull();
    expect(parseArms([])).toBeNull();
  });
});
