import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { RELEASE_BAR, aggregate, aggregateRun, armRows, parseFindings, parseJudge, parseTable, scoreOf, section } from "./aggregate.mjs";

// The operator typecheck keeps vitest types out of its program, as the other ops suites do.
const testModuleName: string = "vitest";
const { afterEach, describe, expect, it } = await import(testModuleName) as any;

const FINDINGS = `# regular findings, run 3 (2026-11-03)
Session(s): abc. Model: sonnet. Games: 2. Rounds: 10. Genui calls: 0.

## Games
| # | deck | deal/date | design | theme | layer | viewport | score | right | hints | K/R/G | fun | fun-if-blind |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | exercise | c0de0010/0 | off | terminal | off | desktop | 3,300/5,000 | 3 | 2 | KRRGK | 3 | 4 |
| 2 | exercise | c0de0010/1 | off | terminal | off | desktop | 4,000/5,000 | 4 | 0 | RRRRG | 4 | 4 |
| 3 | mixed | 1a2b3c4d/0 | off | arcade | off | desktop | 2,500/4,500 | 3 | 1 | KKRGG | – | 3 |

## Moments
- Best: the last round (regular.events.json#40)

## Per deck
### exercise
Fine.

## Copy that stuck out
| string | where | times per game | why |
| --- | --- | --- | --- |
| Why it's X | reveal | 5 | the same sentence |

## Defects
| severity guess | steps | event | screenshot |
| --- | --- | --- | --- |

## Scores
| dimension | score | evidence |
| --- | --- | --- |
| F1 variety | 3 | regular.events.json#2 |
| F2 tension | – | |
| F3 payoff | 4 | g1-complete.png |

## Repetition and records
Nothing seen twice.

## Would you come back?
maybe: once more.
`;

const JUDGE_FUN = `# Judge: fun, run 3 (2026-11-03)

## Method and limits
Read everything.

## Table A
| row | F1 | F2 | F3 | F4 | F5 | F6 | F7 | F8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| exercise | 4 (regular.findings.md) | 3 (events) | 2 (g1-complete.png) | 3 | 3 | 2 (judge-copy) | 3 | 4 |
| mixed | – | 3 | 3 | – | – | – | 3 | 2 |

## Table B
| arm | F2 | F3 | F4 | F6 | completion | median s/round |
| --- | --- | --- | --- | --- | --- | --- |
| design:off | 3 | 2 (chooser) | 3 | 2 | – | – |
| viewport:phone | 3 | 3 | – | 2 | – | – |

## What makes it fun
1. The mix.

## Verdict
| line | result | detail |
| --- | --- | --- |
| 1 | fail | exercise F3 2, exercise F6 2, mixed F8 2 |
| 1b | fail | design:off F3 2 |
`;

const JUDGE_COPY = `# Judge: copy, run 3

## Table A
| string | where | times per game | class | rewrite |
| --- | --- | --- | --- | --- |
| Why it's X | reveal | 5 | repeated, no new information | – |

## Verdict
| line | result | detail |
| --- | --- | --- |
| 2 | pass | none |
`;

const REPORT = {
  v: 3,
  source: "agent",
  games: 3,
  viewed: 3,
  completed: 3,
  refused: 0,
  factors: [{
    factor: "design",
    control: "off",
    levels: [
      { level: "off", completed: 3, secondary: { games: 3, completion: 1, hintsPerRound: 0.6, medianRoundSeconds: 31.5, fallbacksPerRound: 0, costPerGame: null } },
      { level: "catalog", completed: 0, secondary: { games: 0, completion: null, hintsPerRound: null, medianRoundSeconds: null, fallbacksPerRound: null, costPerGame: null } },
    ],
  }],
};

describe("playtest aggregator parsers", () => {
  it("reads a section and its first table, keeping escaped pipes and stopping before a second table", () => {
    const markdown = "# T\n\n## Tally\nintro\n| a | b |\n| --- | --- |\n| x \\| y | 1 |\n\n| c |\n| --- |\n| 2 |\n\n## Next\n";
    expect(section(markdown, "Tally")).toContain("| a | b |");
    expect(section(markdown, "Missing")).toBeNull();
    const table = parseTable(section(markdown, "Tally")!);
    expect(table).toEqual({ header: ["a", "b"], rows: [{ a: "x | y", b: "1" }] });
    expect(parseTable("no pipes here")).toEqual({ error: "no table" });
    expect(parseTable("| a |\n| b |")).toEqual({ error: "no header separator" });
    expect(parseTable("| a | b |\n| --- | --- |\n| only one |")).toMatchObject({ error: expect.stringContaining("1 cells") });
  });

  it("reads a findings file's persona, model, games, and scores", () => {
    const findings = parseFindings(FINDINGS, "regular");
    expect(findings.persona).toBe("regular");
    expect(findings.model).toBe("sonnet");
    expect(findings.games).toHaveLength(3);
    expect(findings.games[1]).toMatchObject({ deck: "exercise", "k/r/g": "RRRRG", fun: "4" });
    expect(findings.scores.map((row) => row.dimension)).toEqual(["F1 variety", "F2 tension", "F3 payoff"]);
    expect(findings.problems).toEqual([]);
    const broken = parseFindings("# x findings\n\n## Games\n| a |\n| --- |\n| 1 | 2 |\n", "x");
    expect(broken.problems).toEqual(expect.arrayContaining([expect.stringContaining("Model:"), expect.stringContaining("Games:"), expect.stringContaining('no "## Scores" section')]));
    expect(broken.games).toEqual([]);
  });

  it("reads a judge's tables and verdict, and scores cells by their leading number", () => {
    const judge = parseJudge(JUDGE_FUN, "judge-fun");
    expect(judge.tableA).toHaveLength(2);
    expect(judge.tableB).toHaveLength(2);
    expect(judge.verdict.map((row) => row.line)).toEqual(["1", "1b"]);
    expect(parseJudge(JUDGE_COPY, "judge-copy").tableB).toEqual([]);
    expect(scoreOf("4 (regular.findings.md)")).toBe(4);
    expect(scoreOf("3.5")).toBe(3.5);
    expect(scoreOf("–")).toBeNull();
    expect(scoreOf(undefined)).toBeNull();
  });

  it("reads one arm row per factor level of a report, and none from something else", () => {
    expect(armRows(REPORT)).toEqual([
      { arm: "design:off", games: 3, completion: 1, hintsPerRound: 0.6, medianRoundSeconds: 31.5, fallbacksPerRound: 0, costPerGame: null },
      { arm: "design:catalog", games: 0, completion: null, hintsPerRound: null, medianRoundSeconds: null, fallbacksPerRound: null, costPerGame: null },
    ]);
    expect(armRows(null)).toEqual([]);
    expect(armRows({ factors: "no" })).toEqual([]);
  });
});

describe("playtest aggregate", () => {
  const input = () => ({
    findings: [parseFindings(FINDINGS, "regular")],
    judges: [parseJudge(JUDGE_FUN, "judge-fun"), parseJudge(JUDGE_COPY, "judge-copy")],
    reports: { haiku: REPORT, sonnet: null },
  });

  it("joins the judge's deck scores with the players' games, and the arms with the report", () => {
    const markdown = aggregate(input());
    expect(markdown).toContain("| exercise | 4 | 3 | 2 | 3 | 3 | 2 | 3 | 4 | 2 | K 20% · R 60% · G 20% | 3.5 | 4.0 |");
    expect(markdown).toContain("| mixed | – | 3 | 3 | – | – | – | 3 | 2 | 1 | K 40% · R 20% · G 40% | – | 3.0 |");
    expect(markdown).toContain("| project | – | – | – | – | – | – | – | – | 0 | – | – | – |");
    expect(markdown).toContain("| regular | sonnet | 3 | – | 4 | – | – | – | – | – |");
    expect(markdown).toContain("| design:off | 3 | 2 | 3 | 2 | 3 | 100% | 0.60 | 31.5 | 0.00 | – |");
    expect(markdown).toContain("| viewport:phone | 3 | 3 | – | 2 | – | – | – | – | – | – |");
    expect(markdown).toContain("| design:catalog | – | – | – | – | 0 | – | – | – | – | – |");
  });

  it("fills the release bar from the judges' verdicts and the report, and marks the rest unjudged", () => {
    const markdown = aggregate(input());
    expect(RELEASE_BAR.map(({ line }) => line)).toEqual(["1", "1b", "2", "3", "4", "4-leaks", "5", "6", "7"]);
    expect(markdown).toContain("| 1 | fail | exercise F3 2, exercise F6 2, mixed F8 2 |");
    expect(markdown).toContain("| 1b | fail | design:off F3 2 |");
    expect(markdown).toContain("| 2 | pass | none |");
    expect(markdown).toContain("| 3 | unjudged | judge-difficulty: no Verdict row 3 |");
    expect(markdown).toContain("| 6 | unjudged | read duel-pair.findings.md, Both sides |");
    expect(markdown).toContain("| 7 | pass | 0 refused lines over 1 report |");
    expect(markdown).toContain("No judge-difficulty Table A.");
    expect(markdown).toContain("## Problems\n\nNone.");
  });

  it("reports a malformed table as a problem instead of failing", () => {
    const broken = parseFindings(FINDINGS.replace("| 2 | exercise", "| 2 | exercise | extra"), "regular");
    const markdown = aggregate({ ...input(), findings: [broken] });
    expect(markdown).toContain("- regular: Games: a row has 14 cells where the header has 13");
    expect(markdown).toContain("| exercise | 4 | 3 | 2 | 3 | 3 | 2 | 3 | 4 | 0 | – | – | – |");
  });
});

describe("playtest aggregate command", () => {
  const directories: string[] = [];
  afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

  it("writes aggregate.md for a run folder and tolerates a missing report", () => {
    const directory = mkdtempSync(join(tmpdir(), "playtest-aggregate-"));
    directories.push(directory);
    writeFileSync(join(directory, "regular.findings.md"), FINDINGS);
    writeFileSync(join(directory, "judge-fun.md"), JUDGE_FUN);
    writeFileSync(join(directory, "experiment-report-sonnet.json"), "not json");
    const { problems } = aggregateRun(directory);
    const markdown = readFileSync(join(directory, "aggregate.md"), "utf8");
    expect(markdown).toContain("Players: regular (sonnet). Judges: judge-fun. Reports: sonnet.");
    expect(problems).toEqual(["experiment-report-sonnet.json is not JSON"]);
    expect(markdown).toContain("- experiment-report-sonnet.json is not JSON");
    expect(markdown).toContain("| 7 | fail | a report is not readable JSON |");
    const script = fileURLToPath(new URL("./aggregate.mjs", import.meta.url));
    const run = spawnSync(process.execPath, [script, "--run", directory], { encoding: "utf8" });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain(`PLAYTEST_AGGREGATE_WRITTEN ${join(directory, "aggregate.md")} problems=1`);
    const usage = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(usage.status).toBe(2);
    expect(usage.stderr).toContain("usage:");
  });
});
