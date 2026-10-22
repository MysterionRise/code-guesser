import type { ArmComparison, Interval } from "./statistics";
import type { FactorReport, Interaction, Report } from "./report";

/**
 * The report as Markdown: its window and the changes inside it, the plan, then whether it may be read, then each
 * factor and the interactions.
 */

const percent = (value: number | null): string => value === null ? "—" : `${(value * 100).toFixed(1)}%`;
const points = (value: number): string => `${value >= 0 ? "+" : "−"}${Math.abs(value * 100).toFixed(1)}`;
const interval = ({ low, high }: Interval): string => `[${(low * 100).toFixed(1)}, ${(high * 100).toFixed(1)}]`;
const number = (value: number | null, digits = 2): string => value === null ? "—" : value.toFixed(digits);
const share = (value: number | null): string => value === null ? "—" : value.toFixed(2);
const dollars = (value: number | null): string => value === null ? "—" : `$${value.toFixed(4)}`;
const count = (value: number): string => value.toLocaleString("en-US");

const rate = (comparison: ArmComparison): string =>
  comparison.trials === 0 ? "—" : `${percent(comparison.rate.mean)} ${interval(comparison.rate)}`;
const versus = (comparison: ArmComparison): string =>
  comparison.difference === null ? "control" : comparison.trials === 0 ? "—" : `${points(comparison.difference.mean)} pts ${interval(comparison.difference)}`;

const table = (header: readonly string[], rows: readonly (readonly string[])[]): string =>
  [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");

const factorSection = (factor: FactorReport): string => {
  const scope = factor.decks === "all" ? "" : ` Only games on decks with question layers count: ${factor.decks.length === 0 ? "none" : factor.decks.join(", ")}.`;
  const primary = table(["Level", "Completed", "Deal-again [95%]", "P(best)", "vs control [95%]", "P(> control)"], factor.levels.map(({ level, completed, target, primary: comparison }) => [
    level === factor.control ? `${level} (control)` : level,
    `${count(completed)} / ${count(target)}`,
    rate(comparison),
    comparison.trials === 0 ? "—" : share(comparison.pBest),
    versus(comparison),
    comparison.pAboveControl === null || comparison.trials === 0 ? "—" : share(comparison.pAboveControl),
  ]));
  const secondary = table(
    ["Level", "Games", "Completion", "Accuracy vs control", "Hints/round", "Median round (s)", "Chat turns/game", "Fallbacks/round", "p95 model (s)", "Cost/game"],
    factor.levels.map(({ level, accuracy, secondary: metrics }) => [
      level,
      count(metrics.games),
      percent(metrics.completion),
      `${percent(metrics.accuracy)}${accuracy.difference === null || accuracy.trials === 0 ? "" : ` (${points(accuracy.difference.mean)} pts)`}`,
      number(metrics.hintsPerRound),
      number(metrics.medianRoundSeconds, 1),
      number(metrics.chatTurnsPerGame),
      number(metrics.fallbacksPerRound),
      number(metrics.p95ModelSeconds, 1),
      dollars(metrics.costPerGame),
    ]),
  );
  const guardrail = factor.guardrail.length === 0
    ? "Guardrail: no level's accuracy is clearly above control's."
    : `**Guardrail: accuracy above control for ${factor.guardrail.join(", ")}.** A rise in accuracy may be a leak (#102); switch the level off with \`EXPERIMENT_DISABLED=${factor.guardrail.map((level) => `${factor.factor}:${level}`).join(",")}\` (#106) and investigate.`;
  return [`## ${factor.factor[0]!.toUpperCase()}${factor.factor.slice(1)}`, "", `Target: ${count(factor.target)} completed games per level.${scope}`, "", primary, "", secondary, "", guardrail].join("\n");
};

const interactionSection = ({ factors: [rows, columns], cells }: Interaction): string => {
  const columnLevels = [...new Set(cells.map(({ columns: column }) => column))];
  const rowLevels = [...new Set(cells.map(({ rows: row }) => row))];
  return [`### ${rows} × ${columns}`, "", table([rows, ...columnLevels], rowLevels.map((row) => [row, ...columnLevels.map((column) => {
    const cell = cells.find((candidate) => candidate.rows === row && candidate.columns === column)!;
    return cell.completed === 0 ? "—" : `${percent(cell.dealtAgain / cell.completed)} (${count(cell.completed)})`;
  })]))].join("\n");
};

/**
 * The player-visible changes dated inside the window (#169), and, when they split it, the periods to read one at a
 * time. A change's text is the log's own, with any `|` escaped so the table holds.
 */
const changesSection = ({ changes, periods }: Report): string => {
  const list = changes.length === 0
    ? "No player-visible change is dated inside this window (`ops/experiment/changes.json`)."
    : table(["Date", "Change", "Factors", "PR"], changes.map(({ date, change, factors, pr }) =>
      [date, change.replace(/\|/gu, "\\|"), factors.join(", "), pr === undefined ? "—" : `#${pr}`]));
  const split = periods.length < 2 ? [] : ["", `These changes split the window into ${periods.length} periods, and every table below mixes them. `
    + `Read one at a time: ${periods.map(({ from, to }) => `\`--period=${from}..${to}\``).join(", ")}.`];
  return ["## Changes", "", list, ...split].join("\n");
};

export const renderReport = (report: Report): string => {
  const window = report.from === null ? `no games up to ${report.to}` : `${report.from} to ${report.to}`;
  const notes = [
    report.period === null ? ""
      : `Period: ${report.period.from} to ${report.period.to}, one stretch between player-visible changes. Only its days are read, and the stopping rule counts its days from the period's first game.`,
    report.refused > 0 ? `${count(report.refused)} stored lines failed the event schema and were left out.` : "",
    report.rolledUp > 0 ? `${count(report.rolledUp)} daily totals older than the raw retention carry no games and are left out.` : "",
  ].filter(Boolean);
  const readiness = report.readiness.ready
    ? `**The result may be read now** (${report.readiness.short.length === 0 ? "every level reached its target" : `day ${report.readiness.day} of ${report.plan.maximumDays}`}).`
    : `**Not yet: read the result when every level reaches its target or on day ${report.plan.maximumDays}.** ${report.readiness.day === null ? "No games yet." : `Day ${report.readiness.day}.`} Short of target: ${report.readiness.short.join(", ")}.`;
  return [
    "# CodeGuessr experiment report",
    "",
    `Source: ${report.source} · ${window} · ${count(report.games)} games, ${count(report.viewed)} viewed, ${count(report.completed)} completed.`,
    ...(notes.length > 0 ? ["", ...notes] : []),
    "",
    changesSection(report),
    "",
    "## Pre-registered plan",
    "",
    "- Primary metric: the deal-again rate, the share of completed games whose player dealt new rounds or chose another deck.",
    "- Secondary: completion (the share of viewed games, those whose page reported itself shown, that reached their fifth round, so a crawler's or a link preview's deal never counts), hints per round, median time per round, chat turns per game, fallbacks per round, p95 model latency, and model cost per game.",
    "- Guardrail: accuracy per level against control; a clear rise may be a leak, and that level is switched off.",
    `- Each factor's levels are compared with its control: Beta posteriors under a uniform prior, 95% intervals, and P(best). Targets detect a ${report.plan.lift * 100}-point rise over ${report.plan.base * 100}% with power ${report.plan.power}, at α ${report.plan.alpha} split over the factor's comparisons with control: ${Object.entries(report.plan.targets).map(([factor, target]) => `${factor} ${count(target)}`).join(", ")} completed games per level.`,
    `- Read the result when every level reaches its target, or after ${report.plan.maximumDays} days, whichever comes first.`,
    "- Playtest and synthetic events are reported only on their own (`--source`), never mixed with real games.",
    "- The game keeps changing after launch. Each player-visible change is dated in `ops/experiment/changes.json` and starts a new period; a comparison holds within one period, and `--period` reads one.",
    "",
    readiness,
    "",
    ...report.factors.flatMap((factor) => [factorSection(factor), ""]),
    "## Interactions",
    "",
    "Deal-again rate (completed games) for each pair of factors. These are descriptive only: the plan makes no claim about them.",
    "",
    ...report.interactions.flatMap((pair) => [interactionSection(pair), ""]),
  ].join("\n");
};
