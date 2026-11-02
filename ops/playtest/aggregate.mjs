/**
 * Playtest aggregator (run 3, `run-3.md`): joins the players' findings tables, the judges' tables, and the
 * experiment report into one `aggregate.md`.
 *
 *   node ops/playtest/aggregate.mjs --run ops/playtest/tmp/<run>
 *
 * It reads `<run>/*.findings.md` (their `## Games` and `## Scores` tables), `<run>/judge-fun.md` (Table A, Table B,
 * and its Verdict), the Verdict tables of the other judges, and `<run>/experiment-report.json` and
 * `experiment-report-sonnet.json` (the `--json` output of `pnpm experiment:report`), tolerating a missing file, and
 * writes `<run>/aggregate.md`: deck by dimension, arm by dimension, the difficulty table, and the release bar. A
 * malformed table is a line under "Problems", never a crash. No dependencies.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DIMENSIONS = Object.freeze(["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8"]);
export const DECK_ROWS = Object.freeze([
  "project", "language", "before-after", "algorithm", "output", "fix", "missing-line", "name-function", "framework",
  "exercise", "mixed", "daily", "duel",
]);
/** The release bar of `run-3.md`: each line, the judge whose Verdict table answers it, and its wording. */
export const RELEASE_BAR = Object.freeze([
  { line: "1", judge: "judge-fun", text: "No deck, mixed, daily, or duel row below 3 on any fun dimension" },
  { line: "1b", judge: "judge-fun", text: "No arm below 3 on tension or payoff" },
  { line: "2", judge: "judge-copy", text: "No string repeated with nothing new in more than 2 rounds of one game; no jargon on the chooser, verdict, points note, answer line, or completion line" },
  { line: "3", judge: "judge-difficulty", text: "No deck at 80% or more blind after both hints; hint 1 lifts every deck by 10 points or more; algorithm layer-on stage 0 at or under 70%" },
  { line: "4", judge: "judge-ux", text: "Zero P0 defects, every P1 filed; every tampered duel link gets a page" },
  { line: "4-leaks", judge: "judge-explanations", text: "Zero leaks" },
  { line: "5", judge: "judge-ux", text: "No accessibility regression; duel pages and chooser records reachable by keyboard" },
  { line: "6", judge: "lead", text: "Both duels correct on both sides, rematch and firstPlay included (the lead reads duel-pair's Both sides)" },
  { line: "7", judge: "report", text: "The experiment report reads the run with 0 refused lines" },
]);

/** A table row's cells, with `\|` kept as a literal pipe and the outer empty cells dropped. */
const splitRow = (line) => {
  const cells = [];
  let cell = "";
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === "\\" && line[index + 1] === "|") { cell += "|"; index += 1; continue; }
    if (character === "|") { cells.push(cell.trim()); cell = ""; continue; }
    cell += character;
  }
  cells.push(cell.trim());
  if (cells.length > 0 && cells[0] === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
  return cells;
};

const isSeparator = (cells) => cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/u.test(cell));

/** The text under `## <heading>` up to the next `## ` heading, or null when the section is missing. */
export const section = (markdown, heading) => {
  const lines = markdown.split(/\r?\n/u);
  const wanted = `## ${heading}`.toLowerCase();
  const start = lines.findIndex((line) => line.trim().toLowerCase() === wanted);
  if (start < 0) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^## /u.test(lines[index])) { end = index; break; }
  }
  return lines.slice(start + 1, end).join("\n");
};

/**
 * The first Markdown table in `markdown`: `{header, rows}`, each row keyed by its lower-cased header cell, or
 * `{error}`. A second table in the same text is left alone.
 */
export const parseTable = (markdown) => {
  const lines = markdown.split(/\r?\n/u).map((line) => line.trim()).filter((line) => line.startsWith("|"));
  if (lines.length < 2) return { error: "no table" };
  const header = splitRow(lines[0]).map((name) => name.toLowerCase());
  if (!isSeparator(splitRow(lines[1]))) return { error: "no header separator" };
  const rows = [];
  for (let index = 2; index < lines.length; index += 1) {
    const next = lines[index + 1];
    if (next !== undefined && isSeparator(splitRow(next))) break;
    const cells = splitRow(lines[index]);
    if (cells.length !== header.length) {
      return { error: `a row has ${cells.length} cells where the header has ${header.length}: ${lines[index].slice(0, 60)}` };
    }
    rows.push(Object.fromEntries(header.map((name, cell) => [name, cells[cell]])));
  }
  return { header, rows };
};

const tableOf = (markdown, heading, who, problems) => {
  const body = section(markdown, heading);
  if (body === null) { problems.push(`${who}: no "## ${heading}" section`); return []; }
  const table = parseTable(body);
  if (table.error !== undefined) { problems.push(`${who}: ${heading}: ${table.error}`); return []; }
  return table.rows;
};

/** A player's findings file: its persona, model, Games rows, Scores rows, and any problem with them. */
export const parseFindings = (markdown, name) => {
  const problems = [];
  const persona = /^# (\S+) findings/mu.exec(markdown)?.[1] ?? name;
  const model = /Model:\s*([a-z0-9-]+(?:\.[0-9]+)*)/iu.exec(markdown)?.[1]?.toLowerCase() ?? "unknown";
  if (model === "unknown") problems.push(`${persona}: no "Model:" line`);
  return {
    persona,
    model,
    games: tableOf(markdown, "Games", persona, problems),
    scores: tableOf(markdown, "Scores", persona, problems),
    problems,
  };
};

/** A judge's file: Table A, Table B when it has one, its Verdict rows, and any problem with them. */
export const parseJudge = (markdown, name) => {
  const problems = [];
  const tableA = tableOf(markdown, "Table A", name, problems);
  const tableB = section(markdown, "Table B") === null ? [] : tableOf(markdown, "Table B", name, problems);
  const verdict = tableOf(markdown, "Verdict", name, problems);
  return { name, tableA, tableB, verdict, problems };
};

/** The leading number of a score cell such as "4 (learner.findings.md)", or null for "–" and prose. */
export const scoreOf = (cell) => {
  const match = /^\s*(\d(?:\.\d+)?)\b/u.exec(cell ?? "");
  return match === null ? null : Number(match[1]);
};

const mean = (values) => values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
const show = (value, digits = 1) => value === null ? "–" : value.toFixed(digits);
const percent = (value) => value === null ? "–" : `${(value * 100).toFixed(0)}%`;

/** One row per factor level of an experiment report's JSON (`pnpm experiment:report --json`). */
export const armRows = (report) => {
  if (report === null || typeof report !== "object" || !Array.isArray(report.factors)) return [];
  return report.factors.flatMap((factor) => (Array.isArray(factor.levels) ? factor.levels : []).map((level) => {
    const metrics = level.secondary ?? {};
    const number = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
    return {
      arm: `${factor.factor}:${level.level}`,
      games: number(metrics.games) ?? 0,
      completion: number(metrics.completion),
      hintsPerRound: number(metrics.hintsPerRound),
      medianRoundSeconds: number(metrics.medianRoundSeconds),
      fallbacksPerRound: number(metrics.fallbacksPerRound),
      costPerGame: number(metrics.costPerGame),
    };
  }));
};

const table = (header, rows) =>
  [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");

const deckOfGame = (row) => (row.deck ?? "").toLowerCase().trim();
const gamesForRow = (deck, findings) => findings.flatMap(({ persona, games }) =>
  games.filter((row) => deck === "duel" ? persona === "duel-pair" : deckOfGame(row) === deck && persona !== "duel-pair"));

const letterShare = (rows) => {
  const counts = { K: 0, R: 0, G: 0 };
  for (const row of rows) for (const letter of (row["k/r/g"] ?? "").toUpperCase()) if (letter in counts) counts[letter] += 1;
  const total = counts.K + counts.R + counts.G;
  return total === 0 ? "–" : `K ${percent(counts.K / total)} · R ${percent(counts.R / total)} · G ${percent(counts.G / total)}`;
};

const dimensionKey = (cell) => /^(F[1-8])\b/u.exec((cell ?? "").toUpperCase())?.[1] ?? null;

/**
 * The aggregate as Markdown: deck by dimension (the judge's score, then the players' mean in brackets, then the
 * games, the K/R/G share, and the mean fun), the players' own scores, arm by dimension beside the report, the
 * difficulty table, the release bar, and every problem met on the way.
 */
export const aggregate = ({ findings, judges, reports, run = "" }) => {
  const problems = [...findings.flatMap(({ problems: list }) => list), ...judges.flatMap(({ problems: list }) => list)];
  const judge = (name) => judges.find((candidate) => candidate.name === name) ?? null;
  const fun = judge("judge-fun");
  const rowKey = (row) => (row.row ?? row.deck ?? Object.values(row)[0] ?? "").toLowerCase().trim();

  const deckRows = DECK_ROWS.map((deck) => {
    const judged = fun?.tableA.find((row) => rowKey(row) === deck) ?? null;
    const games = gamesForRow(deck, findings);
    const cells = DIMENSIONS.map((dimension) => show(judged === null ? null : scoreOf(judged[dimension.toLowerCase()]), 0));
    return [deck, ...cells, String(games.length), letterShare(games),
      show(mean(games.map((row) => scoreOf(row.fun)).filter((value) => value !== null))),
      show(mean(games.map((row) => scoreOf(row["fun-if-blind"])).filter((value) => value !== null)))];
  });

  const playerRows = findings.filter(({ scores }) => scores.length > 0).map(({ persona, model, scores }) =>
    [persona, model, ...DIMENSIONS.map((dimension) => {
      const row = scores.find((candidate) => dimensionKey(candidate.dimension) === dimension);
      return show(row === undefined ? null : scoreOf(row.score), 0);
    })]);
  const playerMeans = DIMENSIONS.map((dimension) => show(mean(findings.flatMap(({ scores }) => scores
    .filter((row) => dimensionKey(row.dimension) === dimension).map((row) => scoreOf(row.score)).filter((value) => value !== null)))));

  const arms = [...armRows(reports.haiku), ...armRows(reports.sonnet).filter(({ arm }) => arm.startsWith("design:")).map((row) => ({ ...row, arm: `${row.arm} (sonnet)` }))];
  const armNames = [...new Set([...(fun?.tableB ?? []).map(rowKey), ...arms.map(({ arm }) => arm.toLowerCase())])];
  const armTable = armNames.map((arm) => {
    const judged = fun?.tableB.find((row) => rowKey(row) === arm) ?? null;
    const report = arms.find((row) => row.arm.toLowerCase() === arm) ?? null;
    return [arm, ...["F2", "F3", "F4", "F6"].map((dimension) => show(judged === null ? null : scoreOf(judged[dimension.toLowerCase()]), 0)),
      report === null ? "–" : String(report.games), percent(report?.completion ?? null), show(report?.hintsPerRound ?? null, 2),
      show(report?.medianRoundSeconds ?? null), show(report?.fallbacksPerRound ?? null, 2),
      report?.costPerGame === null || report?.costPerGame === undefined ? "–" : `$${report.costPerGame.toFixed(4)}`];
  });

  const difficulty = judge("judge-difficulty");
  const difficultyHeader = difficulty !== null && difficulty.tableA.length > 0 ? Object.keys(difficulty.tableA[0]) : null;

  const bar = RELEASE_BAR.map(({ line, judge: who, text }) => {
    if (who === "report") {
      const read = [reports.haiku, reports.sonnet].filter((report) => report !== null);
      if (read.length === 0) return [line, "unjudged", "no experiment-report.json", text];
      if (read.some((report) => typeof report !== "object" || !Number.isFinite(report.refused))) return [line, "fail", "a report is not readable JSON", text];
      const refused = read.reduce((total, report) => total + report.refused, 0);
      return [line, refused === 0 ? "pass" : "fail", `${refused} refused line${refused === 1 ? "" : "s"} over ${read.length} report${read.length === 1 ? "" : "s"}`, text];
    }
    if (who === "lead") return [line, "unjudged", "read duel-pair.findings.md, Both sides", text];
    const row = judge(who)?.verdict.find((candidate) => (candidate.line ?? "").toLowerCase().trim() === line) ?? null;
    if (row === null) return [line, "unjudged", `${who}: no Verdict row ${line}`, text];
    const result = /fail/iu.test(row.result ?? "") ? "fail" : /pass/iu.test(row.result ?? "") ? "pass" : "unjudged";
    return [line, result, (row.detail ?? "").replace(/\|/gu, "\\|"), text];
  });

  return [
    `# Aggregate${run === "" ? "" : `: ${run}`}`,
    "",
    `Players: ${findings.length === 0 ? "none" : findings.map(({ persona, model }) => `${persona} (${model})`).join(", ")}. `
      + `Judges: ${judges.length === 0 ? "none" : judges.map(({ name }) => name).join(", ")}. `
      + `Reports: ${["haiku", "sonnet"].filter((key) => reports[key] !== null).join(", ") || "none"}.`,
    "",
    "## Deck by dimension",
    "",
    "The judge's score per dimension (judge-fun, Table A), then the players' games on that row, their K/R/G share, and their mean fun and fun-if-blind.",
    "",
    table(["row", ...DIMENSIONS, "games", "K/R/G", "fun", "fun-if-blind"], deckRows),
    "",
    "## Players' own scores",
    "",
    table(["persona", "model", ...DIMENSIONS], [...playerRows, ["mean", "", ...playerMeans]]),
    "",
    "## Arm by dimension",
    "",
    "judge-fun's Table B beside the experiment report's secondary metrics for the same arm.",
    "",
    table(["arm", "F2", "F3", "F4", "F6", "games", "completion", "hints/round", "median s/round", "fallbacks/round", "cost/game"], armTable),
    "",
    "## Difficulty",
    "",
    difficultyHeader === null ? "No judge-difficulty Table A." : table(difficultyHeader, difficulty.tableA.map((row) => difficultyHeader.map((key) => (row[key] ?? "").replace(/\|/gu, "\\|")))),
    "",
    "## Release bar",
    "",
    table(["line", "result", "detail", "requirement"], bar),
    "",
    "## Problems",
    "",
    problems.length === 0 ? "None." : problems.map((problem) => `- ${problem}`).join("\n"),
    "",
  ].join("\n");
};

const readJson = (path) => {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return { refused: NaN, parseError: true }; }
};

/** Reads a run folder and writes its `aggregate.md`; returns the Markdown and the problems met. */
export const aggregateRun = (directory) => {
  const names = readdirSync(directory);
  const findings = names.filter((name) => name.endsWith(".findings.md")).sort()
    .map((name) => parseFindings(readFileSync(join(directory, name), "utf8"), name.replace(/\.findings\.md$/u, "")));
  const judges = names.filter((name) => /^judge-[a-z-]+\.md$/u.test(name)).sort()
    .map((name) => parseJudge(readFileSync(join(directory, name), "utf8"), name.replace(/\.md$/u, "")));
  const reports = { haiku: readJson(join(directory, "experiment-report.json")), sonnet: readJson(join(directory, "experiment-report-sonnet.json")) };
  const problems = [];
  for (const [key, report] of Object.entries(reports)) if (report !== null && report.parseError === true) problems.push(`experiment-report${key === "sonnet" ? "-sonnet" : ""}.json is not JSON`);
  const markdown = aggregate({ findings, judges, reports, run: directory }).replace("## Problems\n\nNone.", problems.length === 0 ? "## Problems\n\nNone." : `## Problems\n\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
  writeFileSync(join(directory, "aggregate.md"), markdown, "utf8");
  return { markdown, problems: [...problems, ...findings.flatMap(({ problems: list }) => list), ...judges.flatMap(({ problems: list }) => list)] };
};

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const index = process.argv.indexOf("--run");
  const directory = index > 0 ? process.argv[index + 1] : undefined;
  if (directory === undefined || !existsSync(directory)) {
    process.stderr.write("usage: node ops/playtest/aggregate.mjs --run ops/playtest/tmp/<run>\n");
    process.exit(2);
  }
  const { problems } = aggregateRun(resolve(directory));
  process.stdout.write(`PLAYTEST_AGGREGATE_WRITTEN ${join(resolve(directory), "aggregate.md")} problems=${problems.length}\n`);
}
