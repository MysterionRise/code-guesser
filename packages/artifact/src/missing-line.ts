import { GAP_MARKER, STACK_LANGUAGES, profileAtLeast, type CandidateRecord, type Pane, type ProfileVersion } from "./domain";
import { fail } from "./errors";
import { rawHash, type JsonRecord } from "./validation";

/**
 * "Missing line" (#57): one line of real code is hidden and the player picks, from four lines of the same file, the
 * one that fills the gap. The truth is the file itself. These rules are shared by the generator and the parser.
 */

/** An option's id: its own code, hashed. */
export const missingLineCandidateId = (label: string): string => `local-experiment.missing-line.${rawHash(label).slice(0, 16)}.v1`;

/** What a line of code does, as the first hint names it; a hint narrows the options without picking one. */
export type LineKind = "RETURN" | "LOOP" | "CONDITION" | "ASSIGN" | "CALL" | "OTHER";

export const MISSING_LINE_KIND_HINTS: Readonly<Record<LineKind, string>> = Object.freeze({
  RETURN: "The missing line returns from the function.",
  LOOP: "The missing line starts a loop.",
  CONDITION: "The missing line tests a condition.",
  ASSIGN: "The missing line gives a name a value.",
  CALL: "The missing line calls something and keeps no result.",
  OTHER: "The missing line neither assigns, returns, loops, tests, nor just calls.",
});

/** What a line does, read from its first word and its first operator; a reading, not a parse. */
export const lineKind = (line: string): LineKind => {
  const text = line.trim();
  if (/^(?:return|yield)\b/u.test(text)) return "RETURN";
  if (/^(?:for|while|do)\b/u.test(text)) return "LOOP";
  if (/^(?:if|elif|else\s+if|switch|case|match)\b/u.test(text)) return "CONDITION";
  // An assignment: a target, then `=` or an augmented `+=`, never `==`, `<=`, `>=`, `!=`, or `=>`.
  if (/^[^=(]*?(?:[+\-*/%&|^]|\/\/|\*\*|<<|>>)?=(?![=>])/u.test(text) && !/^[^=]*[<>!]=/u.test(text)) return "ASSIGN";
  if (/^[A-Za-z_][\w.]*(?:\[[^\]]*\])*\s*\(/u.test(text)) return "CALL";
  return "OTHER";
};

/** The second hint: the answer and one other option, in text order, each in curly quotes. */
export const missingLinePairHint = (first: string, second: string): string => {
  const [low, high] = [first, second].sort();
  return `It is either “${low}” or “${high}”.`;
};
const PAIR_HINT = /^It is either “(.+)” or “(.+)”\.$/u;

/** The orders a code-blind solver might rank four lines by: their text, and their length. */
export const MISSING_LINE_ORDERS: readonly ((labels: readonly string[]) => readonly string[])[] = Object.freeze([
  (labels: readonly string[]) => [...labels].sort(),
  (labels: readonly string[]) => [...labels].sort((left, right) => left.length - right.length || (left < right ? -1 : left > right ? 1 : 0)),
]);

/** A line an option may show: one trimmed line of code, with no curly quote the pair hint uses. */
const optionLabel = (label: string): string =>
  label.length > 0 && label.length <= 160 && label === label.trim() && !/[\r\n“”]/u.test(label) && label !== GAP_MARKER ? label : fail();

/**
 * The pane is a window of the file with exactly one line replaced by the gap marker, at the place its source names;
 * the options are four distinct lines, none of them visible in the pane; the first hint names what the answer does,
 * and at least one other option does the same; the second names the answer and one other option, from v7 on one that
 * does the same (#200): paired with a line the first hint rules out, the answer was the only line both hints allow.
 */
export const validateMissingLine = ({ panes, candidates, clues, correctCandidateId, source }: Readonly<{
  panes: readonly Pane[]; candidates: readonly CandidateRecord[]; clues: readonly string[]; correctCandidateId: string; source: JsonRecord;
}>): void => {
  const labels = candidates.map(({ id, label }) => id === missingLineCandidateId(optionLabel(label)) ? label : fail());
  if (new Set(labels).size !== labels.length) fail();
  const answer = candidates.find(({ id }) => id === correctCandidateId)?.label ?? fail();
  const code = panes[0]!.text;
  const lines = code.split("\n");
  const gaps = lines.flatMap((line, index) => line.trim() === GAP_MARKER ? [index + 1] : []);
  const gap = Number(source.gapLine) - Number(source.windowStart) + 1;
  if (gaps.length !== 1 || gaps[0] !== gap || source.excerptHash !== rawHash(code)
    || !(STACK_LANGUAGES as readonly unknown[]).includes(source.language)) fail();
  const shown = new Set(lines.map((line) => line.trim()));
  if (labels.some((label) => shown.has(label))) fail();
  const kind = lineKind(answer);
  if (clues[0] !== MISSING_LINE_KIND_HINTS[kind] || !labels.some((label) => label !== answer && lineKind(label) === kind)) fail();
  const pair = PAIR_HINT.exec(clues[1] ?? "") ?? fail();
  const named = [pair[1]!, pair[2]!];
  if (named[0]! >= named[1]! || !named.includes(answer) || named.some((label) => !labels.includes(label))) fail();
  if (profileAtLeast(source.profileVersion as ProfileVersion, "local-real-rounds.v7")
    && lineKind(named.find((label) => label !== answer)!) !== kind) fail();
};

/**
 * The deck's balance: in text order and in length order, every rank holds the answer about equally often (within
 * one round of an equal share), so no fixed pick or extreme finds it more often than chance.
 */
export const missingLineDeckRule = (fixtures: readonly Readonly<{ candidates: readonly CandidateRecord[]; correctCandidateId: string }>[]): void => {
  for (const order of MISSING_LINE_ORDERS) {
    const ranks = [0, 0, 0, 0];
    for (const fixture of fixtures) {
      const answer = fixture.candidates.find(({ id }) => id === fixture.correctCandidateId)!.label;
      ranks[order(fixture.candidates.map(({ label }) => label)).indexOf(answer)]! += 1;
    }
    if (Math.max(...ranks) - Math.min(...ranks) > 2) fail();
  }
};
