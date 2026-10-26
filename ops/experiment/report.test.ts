import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FACTORS, type Arms } from "../../apps/game/src/experiment/arms";
import { MAXIMUM_CHANGE_LENGTH, parseChanges, parsePeriod, readChanges } from "./changes";
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
 * A synthetic store: `perCell` games for every combination of levels, on the given decks in turn, each dealt, viewed,
 * and played to the end. Successes are handed out by quota rather than drawn, so each group's rates are exactly what
 * `effects` gives (deal-again per arms and deck, accuracy per arms) and a test checks the report, not a seed's luck.
 * `into` adds the games to another store's directory, on their own day, and the result counts both. `v1` writes them
 * as events schema v1 did, before origins (#173).
 */
const syntheticStore = (perCell: number, effects: Effects = {},
  options: Readonly<{ decks?: readonly string[]; source?: string; day?: string; into?: Store; v1?: boolean }> = {}): Store => {
  const directory = options.into?.directory ?? mkdtempSync(join(tmpdir(), "codeguessr-report-"));
  if (options.into === undefined) stores.push(directory);
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
  let games = options.into?.games ?? 0;
  for (const design of FACTORS.design) for (const theme of FACTORS.theme) for (const layer of FACTORS.layer) {
    for (let index = 0; index < perCell; index += 1) {
      const arms: Arms = { design, theme, layer };
      const deck = decks[games % decks.length]!;
      const game = (games += 1).toString(16).padStart(32, "0");
      // Version 1 stored no origin; version 2 names a deal's game.
      const base = options.v1 ? { v: 1, game, day, source: options.source ?? "real", deck, ...arms }
        : { v: 2, game, day, source: options.source ?? "real", origin: "deal", deck, ...arms };
      const event = (type: string, fields: Record<string, unknown> = {}) => lines.push(JSON.stringify({ ...base, type, ...fields }));
      event("game_dealt");
      event("game_viewed", { viewport: "phone" });
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
  writeFileSync(join(directory, `events-${day}.jsonl`), `${lines.join("\n")}\n`, { flag: "a" });
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
      JSON.stringify({ v: 2, type: "game_dealt", game: "f".repeat(32), day: "2026-11-02", source: "real", origin: "deal", deck: "fix", design: "off", theme: "terminal",
        layer: "off", ip: "127.0.0.1" }),
      JSON.stringify({ v: 2, type: "genui_call", game: "1".padStart(32, "0"), day: "2026-11-02", source: "real", origin: "deal", deck: "algorithm", design: "off",
        theme: "terminal", layer: "off", round: 1, phase: "after-lock", ok: true, status: 0, calls: 1, tokensIn: 7000, tokensOut: 1000, ms: 4000 }),
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
    const line = (type: string, fields: Record<string, unknown> = {}, v = 2) => JSON.stringify({ v, type, game: "1".padStart(32, "0"), day: "2026-11-02",
      source: "real", ...v === 2 ? { origin: "deal" } : {}, deck: "algorithm", design: "off", theme: "terminal", layer: "off", ...fields });
    const shared = [line("result_shared", { via: "share" }), line("result_shared", { via: "clipboard" }), line("result_copied", {}, 1), line("result_shared", { via: "email" })];
    writeFileSync(join(store.directory, "events-2026-11-02.jsonl"), `${shared.join("\n")}\n`, { flag: "a" });
    const built = report(store);
    expect(built.refused).toBe(1);
    expect(built.games).toBe(store.games);
    expect(built.completed).toBe(report(syntheticStore(1)).completed);
  });

  it("reads a store schema v1 wrote as deals' games, the same as version 2's (#173)", () => {
    const effects: Effects = { dealAgain: ({ design }) => design === "host" ? 0.6 : 0.3 };
    const before = report(syntheticStore(3, effects, { v1: true }));
    expect(before).toEqual(report(syntheticStore(3, effects)));
    expect(before.refused).toBe(0);
    expect(before.games).toBe(FACTORS.design.length * FACTORS.theme.length * FACTORS.layer.length * 3);
  });

  it("keeps friends' duel games out of every comparison, and describes the duels on their own (#173)", () => {
    const store = syntheticStore(4);
    const plain = report(syntheticStore(4));
    // Every challenger on the host design challenges a friend; each friend's game plays the challenger's arms, deals again
    // every time, and gets every round right, so it would move the host's deal-again rate and accuracy if it counted.
    const lines: string[] = [];
    const day = "2026-11-02";
    const tallied = { later: 0, completed: 0, won: 0, rematches: 0 };
    const challengers = readStore(store.directory, "real").events.filter(({ type, design }) => type === "game_dealt" && design === "host");
    for (const [index, challenger] of challengers.entries()) {
      const later = index % 3 === 0;
      tallied.later += later ? 1 : 0;
      const own = (type: string, fields: Record<string, unknown>) => JSON.stringify({ ...challenger, type, ...fields });
      lines.push(own("duel_created", { firstPlay: later ? "no" : "yes" }), own("duel_link_copied", { link: "challenge", via: "clipboard" }));
      const game = (0xf0000 + index).toString(16).padStart(32, "0");
      const friend = (type: string, fields: Record<string, unknown> = {}) => JSON.stringify({ ...challenger, game, origin: "duel", type, ...fields });
      lines.push(friend("game_dealt"));
      // Every fourth friend leaves before the end.
      if (index % 4 === 3) continue;
      tallied.completed += 1;
      for (let round = 1; round <= 5; round += 1) lines.push(friend("round_revealed", { round, correct: true, hints: 0, ms: 10_000 }));
      const won = index % 2 === 0;
      tallied.won += won ? 1 : 0;
      tallied.rematches += won ? 1 : 0;
      lines.push(friend("game_completed", { score: 5_000, correct: 5, hints: 0, ms: 60_000 }), friend("deal_again", { to: won ? "rematch" : "chooser" }),
        friend("duel_completed", won ? { outcome: "won", decidedBy: "score" } : { outcome: "drew", decidedBy: "draw" }));
      if (won) lines.push(friend("duel_link_copied", { link: "result", via: "share" }));
    }
    writeFileSync(join(store.directory, `events-${day}.jsonl`), `${lines.join("\n")}\n`, { flag: "a" });
    const built = report(store);
    expect(built.refused).toBe(0);
    // The comparisons, the interactions, and the readiness are exactly those without any duel game.
    expect({ games: built.games, completed: built.completed, factors: built.factors, interactions: built.interactions, readiness: built.readiness })
      .toEqual({ games: plain.games, completed: plain.completed, factors: plain.factors, interactions: plain.interactions, readiness: plain.readiness });
    const host = challengers.length;
    expect(built.duels).toEqual({
      challenges: expect.any(Array), challenged: host, firstPlay: { yes: host - tallied.later, no: tallied.later, shared: 0 },
      dealt: host, completed: tallied.completed, rematches: tallied.rematches,
      outcomes: { won: tallied.won, lost: 0, drew: tallied.completed - tallied.won },
      decidedBy: { score: tallied.won, hints: 0, correct: 0, draw: tallied.completed - tallied.won },
      links: { challenge: { share: 0, clipboard: host }, result: { share: tallied.won, clipboard: 0 } },
    });
    expect(built.duels.challenges.find(({ factor, level }) => factor === "design" && level === "host")).toEqual({ factor: "design", level: "host", completed: host, challenged: host });
    expect(built.duels.challenges.find(({ factor, level }) => factor === "design" && level === "off")).toMatchObject({ challenged: 0 });
    const markdown = renderReport(built);
    expect(markdown).toContain("## Duels");
    expect(markdown).toContain(`${host} duel games, outside the comparisons`);
    expect(markdown).toContain(`Challenges: ${host} from ${built.completed} completed games`);
    expect(markdown).toContain(`Links sent: challenge ${host} (share sheet 0, clipboard ${host}), result ${tallied.won} (share sheet ${tallied.won}, clipboard 0).`);
  });

  it("renders the plan, each factor, and the interactions as descriptive tables", () => {
    const markdown = renderReport(report(syntheticStore(3)));
    for (const heading of ["## Changes", "## Pre-registered plan", "## Design", "## Theme", "## Layer", "### design × theme", "### theme × layer"]) {
      expect(markdown).toContain(heading);
    }
    expect(markdown).toContain("No player-visible change is dated inside this window");
    expect(markdown).toContain("off (control)");
    expect(markdown).toContain("descriptive only");
  });

  it("counts completion over viewed games, so a crawler's or a link preview's deal never lowers it (#169)", () => {
    const store = syntheticStore(1);
    const line = (game: string, type: string, fields: Record<string, unknown> = {}) => JSON.stringify({ v: 1, type, game, day: "2026-11-02",
      source: "real", deck: "fix", design: "off", theme: "terminal", layer: "off", ...fields });
    // Three deals no browser ran, and one game a player opened and left after a round.
    const extra = ["a", "b", "c"].map((id) => line(id.repeat(32), "game_dealt"));
    extra.push(line("d".repeat(32), "game_dealt"), line("d".repeat(32), "game_viewed", { viewport: "phone" }),
      line("d".repeat(32), "round_revealed", { round: 1, correct: true, hints: 0, ms: 9000 }));
    writeFileSync(join(store.directory, "events-2026-11-02.jsonl"), `${extra.join("\n")}\n`, { flag: "a" });
    const built = report(store);
    expect(built).toMatchObject({ v: 3, games: store.games + 4, viewed: store.games + 1, completed: store.games });
    // Control's cells hold one played game each, and the four extra games: completion is over the viewed ones only.
    const control = level(built, "design", "off").secondary;
    expect(control.games).toBe(FACTORS.theme.length * FACTORS.layer.length + 4);
    expect(control.completion).toBeCloseTo((control.games - 4) / (control.games - 3), 9);
    expect(renderReport(built)).toContain(`${built.games} games, ${built.viewed} viewed, ${built.completed} completed · 0 duel games`);
  });

  it("splits a window at each change, and reads one period between changes on its own (#169)", () => {
    // The host chat lifts the deal-again rate until a change on 2026-11-05 takes the lift away.
    const before = syntheticStore(20, { dealAgain: ({ design }) => design === "host" ? 0.6 : 0.3 }, { day: "2026-11-02" });
    const store = syntheticStore(20, {}, { day: "2026-11-05", into: before });
    const changes = parseChanges([
      { date: "2026-11-05", change: "The host chat answers | in one line.", factors: ["design"], pr: 210 },
      { date: "2026-11-20", change: "A new artifact.", factors: ["all"] },
    ])!;
    const whole = report(store, { to: "2026-11-10", changes });
    expect(whole.games).toBe(store.games);
    expect(whole.changes.map(({ date }) => date)).toEqual(["2026-11-05"]);
    expect(whole.periods).toEqual([{ from: "2026-11-02", to: "2026-11-04" }, { from: "2026-11-05", to: "2026-11-10" }]);
    const markdown = renderReport(whole);
    expect(markdown).toContain("| 2026-11-05 | The host chat answers \\| in one line. | design | #210 |");
    expect(markdown).not.toContain("A new artifact.");
    expect(markdown).toContain("Read one at a time: `--period=2026-11-02..2026-11-04`, `--period=2026-11-05..2026-11-10`.");

    const periodReport = (text: string): Report => {
      const asked = parsePeriod(text, changes);
      if (!("period" in asked)) throw new Error(asked.refused);
      const { from, to } = asked.period;
      return buildReport({ read: readStore(store.directory, "real", from, to), source: "real", to, layerDecks: LAYER_DECKS, changes, period: asked.period });
    };
    const first = periodReport("2026-11-02..2026-11-04");
    expect(first).toMatchObject({ games: before.games, changes: [], periods: [{ from: "2026-11-02", to: "2026-11-04" }] });
    expect(level(first, "design", "host").primary.difference!.low).toBeGreaterThan(0);
    const second = periodReport("2026-11-05..2026-11-10");
    expect(second.games).toBe(store.games - before.games);
    const { difference } = level(second, "design", "host").primary;
    expect(difference!.low).toBeLessThan(0);
    expect(difference!.high).toBeGreaterThan(0);
    // The change that starts a period is listed with it.
    expect(second.changes.map(({ pr }) => pr)).toEqual([210]);
    expect(renderReport(second)).toContain("Period: 2026-11-05 to 2026-11-10, one stretch between player-visible changes");
    expect(renderReport(second)).not.toContain("--period=");
  });
});

describe("the change log (#169)", () => {
  const entry = (fields: Record<string, unknown> = {}) => ({ date: "2026-11-03", change: "The host chat gets a hint button.", factors: ["design"], ...fields });

  it("parses the committed log, empty until launch day", () => {
    expect(readChanges(join(process.cwd(), "ops/experiment/changes.json"))).toEqual([]);
    expect(readChanges(join(tmpdir(), "codeguessr-no-such-changes.json"))).toBeNull();
  });

  it("takes exact keys, real days in order, one line of text, and known factors, `all` alone", () => {
    expect(parseChanges([entry(), entry({ factors: ["theme", "layer"], pr: 212 }), entry({ date: "2026-11-09", factors: ["all"] })]))
      .toEqual([entry(), entry({ factors: ["theme", "layer"], pr: 212 }), entry({ date: "2026-11-09", factors: ["all"] })]);
    for (const refused of [
      {}, [null], [entry({ note: "x" })], [{ date: "2026-11-03", change: "x" }], [entry({ date: "2026-11-31" })],
      [entry({ date: "2026-11-04" }), entry({ date: "2026-11-03" })],
      [entry({ change: "" })], [entry({ change: " padded" })], [entry({ change: "two\nlines" })], [entry({ change: "x".repeat(MAXIMUM_CHANGE_LENGTH + 1) })],
      [entry({ factors: [] })], [entry({ factors: ["colour"] })], [entry({ factors: ["design", "design"] })], [entry({ factors: ["all", "theme"] })],
      [entry({ pr: 0 })], [entry({ pr: "212" })], [entry({ pr: null })],
    ]) {
      expect(parseChanges(refused), JSON.stringify(refused)).toBeNull();
    }
  });

  it("reads `--period` as two real days in order with no change inside, though a change may start it", () => {
    const changes = parseChanges([entry({ date: "2026-11-05" })])!;
    expect(parsePeriod("2026-11-01..2026-11-04", changes)).toEqual({ period: { from: "2026-11-01", to: "2026-11-04" } });
    expect(parsePeriod("2026-11-05..2026-11-30", changes)).toEqual({ period: { from: "2026-11-05", to: "2026-11-30" } });
    expect(parsePeriod("2026-11-03..2026-11-03", changes)).toEqual({ period: { from: "2026-11-03", to: "2026-11-03" } });
    expect(parsePeriod("2026-11-01..2026-11-05", changes)).toEqual({ refused: "PERIOD_SPANS_CHANGE" });
    for (const malformed of ["2026-11-01", "2026-11-01..", "2026-11-04..2026-11-01", "2026-11-01..2026-11-31", "2026-11-01..2026-11-02..2026-11-03",
      "11/01..11/04"]) {
      expect(parsePeriod(malformed, changes), malformed).toEqual({ refused: "PERIOD_MALFORMED" });
    }
  });
});

describe("pnpm experiment:report (#169)", () => {
  /** The command as an operator runs it, on a store of its own; it reads the committed change log. */
  const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", "ops/experiment/index.ts", ...args], {
    cwd: process.cwd(), encoding: "utf8", env: { ...process.env, EXPERIMENT_EVENTS_DIR: "" },
  });

  it("reads one period when `--period` names two days in order, and refuses anything else with a code", () => {
    const store = syntheticStore(1);
    const read = run(`--dir=${store.directory}`, "--period=2026-11-01..2026-11-03");
    expect(read.stderr).toBe("");
    expect(read.status).toBe(0);
    expect(read.stdout).toContain("Period: 2026-11-01 to 2026-11-03");
    expect(read.stdout).toContain(`${store.games} games, ${store.games} viewed, ${store.games} completed · 0 duel games`);
    for (const [args, code] of [
      [["--period=2026-11-03..2026-11-01"], "EXPERIMENT_REPORT_PERIOD_MALFORMED"],
      [["--period=2026-11-01..2026-11-31"], "EXPERIMENT_REPORT_PERIOD_MALFORMED"],
      [["--period=2026-11-01..2026-11-03", "--from=2026-11-01"], "EXPERIMENT_REPORT_ARGUMENTS"],
      [["--period=2026-11-01..2026-11-03", "--to=2026-11-03"], "EXPERIMENT_REPORT_ARGUMENTS"],
    ] as const) {
      const refused = run(`--dir=${store.directory}`, ...args);
      expect(refused.status, args.join(" ")).toBe(1);
      expect(refused.stderr.split("\n")[0], args.join(" ")).toBe(code);
      expect(refused.stdout).toBe("");
    }
  });
});
