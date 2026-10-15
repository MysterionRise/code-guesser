import { GAP_MARKER, MISSING_LINE_ORDERS, lineKind } from "../../../packages/artifact/src/index";
import { canonicalHash } from "./canonical";
import { optionLine } from "./fix-window";

/**
 * "Missing line" windows (#57): a stretch of a file with its commentary removed, one line of it hidden, and three
 * lines from elsewhere in the same file to offer beside it. A choice records the answer's rank in every order a
 * code-blind solver might rank the four lines by, so the deck can balance them across its pool.
 */
export interface GapChoice {
  /** The file line, without commentary, that the pane begins with, counted from one. */
  readonly windowStart: number;
  /** The hidden line, counted the same way. */
  readonly gapLine: number;
  /** The pane: the window with the hidden line replaced by the gap marker at its own indentation. */
  readonly excerpt: string;
  readonly answer: string;
  /** Three other lines of the file, none of them shown in the pane. */
  readonly decoys: readonly string[];
  /** The answer's rank among the four in text order, length order, and how many names each shares with the pane. */
  readonly ranks: readonly number[];
}

/** The orders choices are balanced in: the parser's two, then shared names with the pane, most first. */
export const GAP_ORDERS = 3;

/**
 * How far each order may lean: text and length not at all (the parser checks them), shared names with the pane by
 * two rounds, since the answer belongs where it sits and often shares the most. On a pool of 24 that holds picking
 * the line with the most shared names to at most a third; the leakage test checks it.
 */
export const gapSlack = (_rounds: number): readonly number[] => Object.freeze([0, 0, 2]);

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/gu;
const KEYWORDS = new Set(("and as assert async await break class continue def del elif else except False finally for from global if import in "
  + "is lambda None nonlocal not or pass raise return True try while with yield self len range int str list dict set tuple print").split(" "));

/** The names a line uses, keywords and common built-ins aside. */
const namesIn = (line: string): ReadonlySet<string> => new Set((line.match(IDENTIFIER) ?? []).filter((name) => !KEYWORDS.has(name)));

/** Whether a line's brackets close: a line that opens a block it never shuts can't stand in for one that does. */
export const balancedBrackets = (line: string): boolean => {
  const stack: string[] = [];
  const pairs: Readonly<Record<string, string>> = { ")": "(", "]": "[", "}": "{" };
  for (const character of line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/gu, "")) {
    if ("([{".includes(character)) stack.push(character);
    else if (character in pairs && stack.pop() !== pairs[character]) return false;
  }
  return stack.length === 0;
};

const indentOf = (line: string): string => /^[ \t]*/u.exec(line)![0];

/**
 * Which lines start a statement: those outside any bracket an earlier line opened, so a parameter or an argument on
 * a line of its own (`goal_x: int,`) is never a gap or a decoy. Strings are skipped; triple-quoted text is gone with
 * the commentary.
 */
export const statementStarts = (lines: readonly string[]): readonly boolean[] => {
  let depth = 0;
  return lines.map((line) => {
    const starts = depth === 0;
    for (const character of line.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/gu, "")) {
      if ("([{".includes(character)) depth += 1;
      else if (")]}".includes(character)) depth = Math.max(0, depth - 1);
    }
    return starts;
  });
};

const ordered = (seed: string, values: readonly number[]): readonly number[] =>
  [...values].sort((left, right) => {
    const a = canonicalHash({ seed, value: left });
    const b = canonicalHash({ seed, value: right });
    return a < b ? -1 : a > b ? 1 : 0;
  });

/** Every way to choose `count` of `items`, in order. */
const combinations = <Item>(items: readonly Item[], count: number): readonly (readonly Item[])[] =>
  count === 0 ? [[]] : items.flatMap((item, index) => combinations(items.slice(index + 1), count - 1).map((rest) => [item, ...rest]));

/** Decoys are drawn from the first few eligible lines of the file, in `seed` order. */
const DECOY_CHOICES = 6;

/**
 * The answer's rank among four lines by how many names each shares with the pane, most first. A tie counts against
 * the answer (it ranks ahead of the lines it ties with), so balancing the ranks bounds what picking the line with the
 * most shared names scores even when it splits ties.
 */
const overlapRank = (answer: string, options: readonly string[], pane: ReadonlySet<string>): number => {
  const shared = (line: string) => [...namesIn(line)].filter((name) => pane.has(name)).length;
  return options.filter((option) => shared(option) > shared(answer)).length;
};

/**
 * Every gap a round could hide in `plain`, in `seed` order, (a file's text with its commentary removed), each in a window of `size`
 * lines that holds it away from both edges, with each way to offer three decoys. A gap is a line of code with some
 * substance whose brackets close, whose text appears once in the file, and which shares a name with the rest of the
 * pane, so reading can decide it; a decoy is such a line from outside the
 * window, at the gap's indentation, within half its length (or eight characters), never shown in the window; both
 * start a statement, outside any bracket an earlier line opened, and end without a trailing comma; and the
 * set holds at least one other line that does what the gap does, so the first hint never picks the answer.
 */
export const gapChoices = (plain: string, seed: string, size: number): readonly GapChoice[] => {
  const lines = plain.split("\n");
  const counts = new Map<string, number>();
  for (const line of lines) counts.set(line.trim(), (counts.get(line.trim()) ?? 0) + 1);
  const starts = statementStarts(lines);
  const usable = (index: number): boolean => {
    const line = lines[index]!;
    return starts[index]! && optionLine(line) && balancedBrackets(line) && counts.get(line.trim()) === 1 && line.trim() !== GAP_MARKER
      && !/[“”]/u.test(line) && !/,\s*$/u.test(line);
  };
  const choices: GapChoice[] = [];
  for (let gap = 0; gap < lines.length; gap += 1) {
    if (!usable(gap)) continue;
    const start = Math.min(Math.max(0, gap - Math.floor(size / 2)), lines.length - size);
    if (start < 0 || gap - start < 2 || start + size - 1 - gap < 2) continue;
    const window = lines.slice(start, start + size);
    if (window[0]!.trim().length === 0 || window.at(-1)!.trim().length === 0) continue;
    const answer = lines[gap]!.trim();
    const indent = indentOf(lines[gap]!);
    const shown = new Set(window.map((line) => line.trim()));
    const eligible = lines.map((_, index) => index).filter((index) => (index < start || index >= start + size) && usable(index)
      && indentOf(lines[index]!) === indent && !shown.has(lines[index]!.trim())
      && Math.abs(lines[index]!.trim().length - answer.length) <= Math.max(answer.length / 2, 8));
    const excerpt = window.map((line, index) => start + index === gap ? `${indent}${GAP_MARKER}` : line).join("\n");
    const paneNames = new Set(window.flatMap((line, index) => start + index === gap ? [] : [...namesIn(line)]));
    // The hidden line must tie into what the pane shows, so reading the code can decide it.
    if (![...namesIn(answer)].some((name) => paneNames.has(name))) continue;
    // Decoys that share the most names with the pane come first, so the answer's own overlap stops standing out.
    const shared = (index: number): number => [...namesIn(lines[index]!)].filter((name) => paneNames.has(name)).length;
    const seeded = ordered(`${seed}:${gap}`, eligible);
    const pool = [...seeded].sort((left, right) => shared(right) - shared(left) || seeded.indexOf(left) - seeded.indexOf(right))
      .slice(0, DECOY_CHOICES);
    for (const picked of combinations(pool, 3)) {
      const decoys = picked.map((index) => lines[index]!.trim());
      if (!decoys.some((decoy) => lineKind(decoy) === lineKind(answer))) continue;
      const options = [answer, ...decoys];
      const ranks = [...MISSING_LINE_ORDERS.map((order) => order(options).indexOf(answer)), overlapRank(answer, options, paneNames)];
      choices.push(Object.freeze({ windowStart: start + 1, gapLine: gap + 1, excerpt, answer, decoys: Object.freeze(decoys), ranks: Object.freeze(ranks) }));
    }
  }
  // In seed order, not file order, so a cap on how many a file offers still samples all its gaps.
  const keyed = choices.map((choice) => ({ choice, key: canonicalHash({ seed, gap: choice.gapLine, decoys: choice.decoys }) }));
  return Object.freeze(keyed.sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0).map(({ choice }) => choice));
};
