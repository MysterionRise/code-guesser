/**
 * `pnpm experiment:report` (#108): reads the experiment's event store with no network and prints the report as
 * Markdown; `--json=<path>` also writes it as JSON.
 *
 *   pnpm experiment:report [--dir=<store>] [--source=real|agent|synthetic] [--from=YYYY-MM-DD] [--to=YYYY-MM-DD]
 *     [--price-in=<USD per million tokens>] [--price-out=<USD per million tokens>] [--json=<path>]
 *
 * The store defaults to `EXPERIMENT_EVENTS_DIR`, the source to real games, and the report's day to today (UTC).
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { SOURCES, dayOf, isDay, type EventSource } from "../../apps/game/src/experiment/events";
import { buildReport, layerDecksFrom, readStore } from "./report";
import { renderReport } from "./render";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const LAYERS = resolve(ROOT, "apps/game/src/demo/generated/question-layers.json");
const USAGE = "usage: pnpm experiment:report [--dir=<store>] [--source=real|agent|synthetic] [--from=YYYY-MM-DD] [--to=YYYY-MM-DD] [--price-in=<USD/M>] [--price-out=<USD/M>] [--json=<path>]";
const FLAGS = new Set(["dir", "source", "from", "to", "price-in", "price-out", "json"]);

const fail = (code: string): never => {
  process.stderr.write(`${code}\n${USAGE}\n`);
  process.exit(1);
};

const options = new Map<string, string>();
for (const argument of process.argv.slice(2)) {
  const match = /^--([a-z-]+)=(.+)$/u.exec(argument);
  if (match === null || !FLAGS.has(match[1]!) || options.has(match[1]!)) fail("EXPERIMENT_REPORT_ARGUMENTS");
  options.set(match![1]!, match![2]!);
}

const directory = options.get("dir") ?? process.env.EXPERIMENT_EVENTS_DIR ?? "";
if (directory.length === 0) fail("EXPERIMENT_REPORT_NO_STORE");
const source = options.get("source") ?? "real";
if (!(SOURCES as readonly string[]).includes(source)) fail("EXPERIMENT_REPORT_ARGUMENTS");
const to = options.get("to") ?? dayOf(Date.now());
const from = options.get("from");
if (!isDay(to) || (from !== undefined && (!isDay(from) || from > to))) fail("EXPERIMENT_REPORT_ARGUMENTS");
const price = (flag: string): number | undefined => {
  const value = options.get(flag);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fail("EXPERIMENT_REPORT_ARGUMENTS");
};
const input = price("price-in");
const output = price("price-out");
if ((input === undefined) !== (output === undefined)) fail("EXPERIMENT_REPORT_ARGUMENTS");

const report = buildReport({
  read: readStore(resolve(directory), source as EventSource, from, to),
  source: source as EventSource,
  to,
  layerDecks: layerDecksFrom(LAYERS),
  prices: input === undefined || output === undefined ? null : { input, output },
});
process.stdout.write(`${renderReport(report)}\n`);
const json = options.get("json");
if (json !== undefined) writeFileSync(resolve(json), `${JSON.stringify(report, null, 2)}\n`, "utf8");
