import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FACTORS, type Arms } from "../../apps/game/src/experiment/arms";
import { buildReport, layerDecksFrom, readStore, targetFor, type Report } from "./report";
import { renderReport } from "./render";
import { compareArms, normalQuantile, sampleSize } from "./statistics";

// The operator typecheck keeps vitest types out of its program, as the other ops suites do.
const testModuleName: string = "vitest";
const { afterEach, describe, expect, it } = await import(testModuleName) as any;

type Effects = Readonly<{ dealAgain?: (arms: Arms, deck: string) => number; accuracy?: (arms: Arms) => number }>;
interface Store { directory: string; games: number }
const stores: string[] = [];
afterEach(() => { for (const directory of stores.splice(0)) rmSync(directory, { recursive: true, force: true }); });

const LAYER_DECKS = ["algorithm", "language"];

/**
 * A synthetic store: `perCell` games for every combination of levels, on the given decks in turn, each dealt and played
 * to the end. Successes are handed out by quota rather than drawn, so each group's rates are exactly what `effects`
 * gives (deal-again per arms and deck, accuracy per arms) and a test checks the report, not a seed's luck.
 */
const syntheticStore = (perCell: number, effects: Effects = {}, options: Readonly<{ decks?: readonly string[]; source?: string; day?: string }> = {}): Store => {
  const directory = mkdtempSync(join(tmpdir(), "codeguessr-report-"));
  stores.push(directory);
  const quotas = new Map<string, { trials: number; successes: number }>();
  const succeeds = (key: string, rate: number): boolean => {
    const quota = quotas.get(key) ?? { trials: 0, successes: 0 };
    quotas.set(key, quota);
    quota.trials += 1;
    const success = quota.successes + 1 <= rate * quota.trials + 1e-9;
    quota.successes += success ? 1 : 0;
    return success;
  };
  const decks = options.decks ?? ["algorithm", "fix"];
  const day = options.day ?? "2026-11-02";
  const lines: string[] = [];
  let games = 0;
  for (const design of FACTORS.design) for (const theme of FACTORS.theme) for (const layer of FACTORS.layer) {
    for (let index = 0; index < perCell; index += 1) {
      const arms: Arms = { design, theme, layer };
      const deck = decks[games % decks.length]!;
      const game = (games += 1).toString(16).padStart(32, "0");
      const base = { v: 1, game, day, source: options.source ?? "real", deck, ...arms };
      const event = (type: string, fields: Record<string, unknown> = {}) => lines.push(JSON.stringify({ ...base, type, ...fields }));
      event("game_dealt");
      let correct = 0;
      for (let round = 1; round <= 5; round += 1) {
        const right = succeeds(`accuracy ${design} ${theme} ${layer}`, effects.accuracy?.(arms) ?? 0.5);
        correct += right ? 1 : 0;
        event("round_revealed", { round, correct: right, hints: round === 1 ? 1 : 0, ms: 20_000 + round * 1000 });
      }
      event("game_completed", { score: correct * 1000, correct, hints: 1, ms: 120_000 });
      if (succeeds(`deal ${design} ${theme} ${layer} ${deck}`, effects.dealAgain?.(arms, deck) ?? 0.3)) event("deal_again", { to: "same-deck" });
    }
  }
  writeFileSync(join(directory, `events-${day}.jsonl`), `${lines.join("\n")}\n`);
  return { directory, games };
};

const report = (store: Store, overrides: Partial<Parameters<typeof buildReport>[0]> = {}): Report => buildReport({
  read: readStore(store.directory, "real"), source: "real", to: "2026-11-02", layerDecks: LAYER_DECKS, ...overrides,
});
const level = (built: Report, factor: string, name: string) =>
  built.factors.find(({ factor: own }) => own === factor)!.levels.find(({ level: own }) => own === name)!;

describe("experiment statistics", () => {
  it("matches the standard normal quantiles", () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(normalQuantile(0.8)).toBeCloseTo(0.841621, 5);
    expect(normalQuantile(0.5)).toBeCloseTo(0, 9);
    expect(normalQuantile(0.001)).toBeCloseTo(-3.090232, 5);
  });

  it("sizes the plan as #108 pre-registered: about 430 games per arm for two comparisons with control", () => {
    expect(sampleSize({ base: 0.3, lift: 0.1, comparisons: 2 })).toBe(432);
    // More comparisons split α more finely, so a factor with more levels needs more games per level.
    expect(targetFor("design")).toBeGreaterThan(targetFor("theme"));
    expect(targetFor("theme")).toBeGreaterThan(targetFor("layer"));
    expect(targetFor("layer")).toBe(sampleSize({ base: 0.3, lift: 0.1, comparisons: 1 }));
  });

  it("gives equal arms an even chance of being best, and the same draws on every run", () => {
    const arms = [{ level: "a", successes: 30, trials: 100 }, { level: "b", successes: 30, trials: 100 }];
    const [a, b] = compareArms(arms, "a", 1);
    expect(a!.pBest).toBeCloseTo(0.5, 1);
    expect(a!.rate.low).toBeLessThan(0.3);
    expect(a!.rate.high).toBeGreaterThan(0.3);
    expect(b!.difference!.low).toBeLessThan(0);
    expect(b!.difference!.high).toBeGreaterThan(0);
    expect(compareArms(arms, "a", 1)).toEqual(compareArms(arms, "a", 1));
    // A level with no data never counts as best, so a lone level with data is best outright.
    const lone = compareArms([{ level: "a", successes: 30, trials: 100 }, { level: "b", successes: 0, trials: 0 }], "a", 1);
    expect(lone.map(({ pBest }) => pBest)).toEqual([1, 0]);
  });
});

describe("experiment report", () => {
  it("recovers known effects in each factor at once, and finds none where there is none", () => {
    const store = syntheticStore(40, {
      dealAgain: ({ design, theme }) => 0.3 + (design === "host" ? 0.2 : 0) + (theme === "arcade" ? 0.15 : 0),
    });
    const built = report(store);
    expect(built.games).toBe(store.games);
    const host = level(built, "design", "host").primary;
    expect(host.pBest).toBeGreaterThan(0.95);
    expect(host.difference!.low).toBeGreaterThan(0);
    expect(host.difference!.low).toBeLessThan(0.2);
    expect(host.difference!.high).toBeGreaterThan(0.2);
    expect(level(built, "theme", "arcade").primary.difference!.low).toBeGreaterThan(0);
    for (const [factor, name] of [["design", "catalog"], ["design", "visualizer"], ["theme", "paper"], ["theme", "contrast"]] as const) {
      const { difference } = level(built, factor, name).primary;
      expect(difference!.low).toBeLessThan(0);
      expect(difference!.high).toBeGreaterThan(0);
    }
    expect(built.factors.every(({ guardrail }) => guardrail.length === 0)).toBe(true);
  });

  it("flags a level whose accuracy rises over control's, as a leak would", () => {
    const built = report(syntheticStore(30, { accuracy: ({ design }) => design === "composer" ? 0.7 : 0.5 }));
    expect(built.factors.find(({ factor }) => factor === "design")!.guardrail).toEqual(["composer"]);
    expect(renderReport(built)).toContain("EXPERIMENT_DISABLED=design:composer");
  });

  it("counts layers only on decks that have them", () => {
    const store = syntheticStore(10, { dealAgain: ({ layer }, deck) => layer === "on" && deck === "algorithm" ? 0.6 : 0.3 });
    const built = report(store);
    const layers = built.factors.find(({ factor }) => factor === "layer")!;
    expect(layers.decks).toEqual(LAYER_DECKS);
    // Half the games are on the fix deck, which has no layers.
    expect(layers.levels.reduce((total, { completed }) => total + completed, 0)).toBe(store.games / 2);
    expect(level(built, "layer", "on").primary.difference!.low).toBeGreaterThan(0);
    expect(layerDecksFrom(join(process.cwd(), "apps/game/src/demo/generated/question-layers.json"))).toEqual(LAYER_DECKS);
  });

  it("never mixes sources: synthetic events stay out of the real report", () => {
    const store = syntheticStore(2, {}, { source: "synthetic" });
    expect(report(store).games).toBe(0);
    expect(buildReport({ read: readStore(store.directory, "synthetic"), source: "synthetic", to: "2026-11-02", layerDecks: LAYER_DECKS }).games).toBe(store.games);
  });

  it("runs on an empty or missing store, and holds the read until the targets or the eighth week", () => {
    const empty = report({ directory: join(tmpdir(), "codeguessr-report-missing"), games: 0 });
    expect(empty).toMatchObject({ games: 0, completed: 0, from: null, readiness: { ready: false, day: null } });
    expect(renderReport(empty)).toContain("No games yet.");
    const early = report(syntheticStore(1, {}, { day: "2026-10-20" }), { to: "2026-11-02" });
    expect(early.readiness).toMatchObject({ ready: false, day: 14 });
    expect(early.readiness.short).toContain(`design:host 8/${targetFor("design")}`);
    const late = report(syntheticStore(1, {}, { day: "2026-09-01" }), { to: "2026-10-26" });
    expect(late.readiness).toMatchObject({ ready: true, day: 56 });
  });

  it("counts lines the schema refuses without reading them, and prices model calls when given prices", () => {
    const store = syntheticStore(1);
    const extra = [
      "not json",
      JSON.stringify({ v: 1, type: "game_dealt", game: "f".repeat(32), day: "2026-11-02", source: "real", deck: "fix", design: "off", theme: "terminal", layer: "off", ip: "127.0.0.1" }),
      JSON.stringify({ v: 1, type: "genui_call", game: "1".padStart(32, "0"), day: "2026-11-02", source: "real", deck: "algorithm", design: "off", theme: "terminal", layer: "off",
        round: 1, phase: "after-lock", ok: true, status: 0, calls: 1, tokensIn: 7000, tokensOut: 1000, ms: 4000 }),
    ];
    writeFileSync(join(store.directory, "events-2026-11-02.jsonl"), `${extra.join("\n")}\n`, { flag: "a" });
    const built = report(store, { prices: { input: 1, output: 5 } });
    expect(built.refused).toBe(2);
    const control = level(built, "design", "off").secondary;
    expect(control.p95ModelSeconds).toBe(4);
    expect(control.costPerGame).toBeCloseTo((7000 * 1 + 1000 * 5) / 1_000_000 / control.games, 9);
    expect(renderReport(built)).toContain("2 stored lines failed the event schema");
  });

  it("reads shared results, and the copied results stored before them, without counting either as a game (#171)", () => {
    const store = syntheticStore(1);
    const line = (type: string, fields: Record<string, unknown> = {}) => JSON.stringify({ v: 1, type, game: "1".padStart(32, "0"), day: "2026-11-02",
      source: "real", deck: "algorithm", design: "off", theme: "terminal", layer: "off", ...fields });
    const shared = [line("result_shared", { via: "share" }), line("result_shared", { via: "clipboard" }), line("result_copied"), line("result_shared", { via: "email" })];
    writeFileSync(join(store.directory, "events-2026-11-02.jsonl"), `${shared.join("\n")}\n`, { flag: "a" });
    const built = report(store);
    expect(built.refused).toBe(1);
    expect(built.games).toBe(store.games);
    expect(built.completed).toBe(report(syntheticStore(1)).completed);
  });

  it("renders the plan, each factor, and the interactions as descriptive tables", () => {
    const markdown = renderReport(report(syntheticStore(3)));
    for (const heading of ["## Pre-registered plan", "## Design", "## Theme", "## Layer", "### design × theme", "### theme × layer"]) {
      expect(markdown).toContain(heading);
    }
    expect(markdown).toContain("off (control)");
    expect(markdown).toContain("descriptive only");
  });
});
