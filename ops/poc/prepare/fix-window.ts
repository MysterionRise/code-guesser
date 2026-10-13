import { canonicalHash } from "./canonical";
import { FIX_CHANGE_HINTS, fixRanks } from "./model";

/** Which of the fix hints describes a change. */
export type ChangeKind = keyof typeof FIX_CHANGE_HINTS;

const TOKEN = /[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?[A-Za-z]*|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|&&|\|\||[=!<>]=|<<|>>|->|::|\S/gu;
const LITERAL = /^(?:[0-9"']|(?:true|false|null|None|True|False|nil)$)/u;
const OPERATOR = /^(?:&&|\|\||[=!<>]=|<<|>>|[-+*/%<>!&|^~?:=])$/u;
const NAME = /^[A-Za-z_]/u;

/** The tokens of `left` that `right` lacks, counting repeats. */
const without = (left: readonly string[], right: readonly string[]): readonly string[] => {
  const remaining = [...right];
  return left.filter((token) => {
    const index = remaining.indexOf(token);
    if (index < 0) return true;
    remaining.splice(index, 1);
    return false;
  });
};

/** What kind of change turned `before` into `after`, decided by the tokens one has and the other lacks. */
export const changeKind = (before: string, after: string): ChangeKind => {
  const left = before.match(TOKEN) ?? [];
  const right = after.match(TOKEN) ?? [];
  const removed = without(left, right);
  const added = without(right, left);
  const changed = [...removed, ...added];
  if (changed.length === 0) return "STRUCTURE";
  if (changed.every((token) => OPERATOR.test(token))) return "OPERATOR";
  if (changed.every((token) => LITERAL.test(token))) return "LITERAL";
  if (removed.length === added.length && changed.every((token) => NAME.test(token) && !LITERAL.test(token))) return "NAME";
  return "STRUCTURE";
};

/** A line worth offering: code with some substance, not a blank, a brace, a comment, an import, or an annotation. */
export const optionLine = (line: string): boolean => {
  const trimmed = line.trim();
  if (/^(?:\/\/|\/\*|\*|#|"""|''')/u.test(trimmed) || /^(?:import|package|from)\s/u.test(trimmed)) return false;
  if (/^@[\w.]+(?:\(.*\))?$/u.test(trimmed)) return false;
  return trimmed.replace(/[\s{}()[\];,.:]/gu, "").length >= 6;
};

/** A window of a file before its fix, and the four lines a round offers, counted from the window's first line. */
export interface FixWindow {
  readonly excerpt: string;
  /** The file line the window begins with, counted from one. */
  readonly windowStart: number;
  /** The changed line, counted from the window's first line. */
  readonly answer: number;
  /** Three other lines of the window, in line order. */
  readonly decoys: readonly number[];
  /** The answer's rank among the four options by position, by distance from the middle, and by length. */
  readonly ranks: readonly number[];
}

const order = (seed: string, values: readonly number[]): readonly number[] =>
  [...values].sort((left, right) => {
    const a = canonicalHash({ seed, value: left });
    const b = canonicalHash({ seed, value: right });
    return a < b ? -1 : a > b ? 1 : 0;
  });

/** Every way to choose `count` of `items`, in order. */
const combinations = <Item>(items: readonly Item[], count: number): readonly (readonly Item[])[] =>
  count === 0 ? [[]] : items.flatMap((item, index) => combinations(items.slice(index + 1), count - 1).map((rest) => [item, ...rest]));

/** Decoys are drawn from the first few eligible lines on each side, in `seed` order. */
const DECOY_CHOICES = 6;

/**
 * Every window of `size` lines a round could show: each start that holds the changed line, and each way to place
 * three decoys so the changed line takes some rank (from zero) among four options there. Decoys are option lines
 * whose length is within half of the changed line's (or eight characters, for a short line), never its text, drawn
 * from the first few eligible lines above and below in `seed` order. A window never starts or ends on a blank
 * line. Empty when no window fits.
 */
export const fixWindows = (text: string, changedLine: number, seed: string, size: number): readonly FixWindow[] => {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n").map((line) => line.trimEnd());
  const index = changedLine - 1;
  if (index < 0 || index >= lines.length || lines.length < size) return Object.freeze([]);
  const target = lines[index]!.trim();
  const fits = (line: number): boolean => line !== index && optionLine(lines[line]!) && lines[line]!.trim() !== target
    && Math.abs(lines[line]!.trim().length - target.length) <= Math.max(target.length / 2, 8);
  const first = Math.max(0, index - size + 1);
  const last = Math.min(index, lines.length - size);
  const windows: FixWindow[] = [];
  for (let start = first; start <= last; start += 1) {
    const above = order(`${seed}:above`, Array.from({ length: index - start }, (_, offset) => start + offset).filter(fits));
    const below = order(`${seed}:below`, Array.from({ length: start + size - index - 1 }, (_, offset) => index + 1 + offset).filter(fits));
    const pane = lines.slice(start, start + size);
    // A pane that opens or closes on a blank line looks cut off, and trimming it anywhere would shift every line.
    if (pane[0]!.trim().length === 0 || pane.at(-1)!.trim().length === 0) continue;
    const answer = index - start + 1;
    for (let rank = 0; rank < 4; rank += 1) {
      for (const upper of combinations(above.slice(0, DECOY_CHOICES), rank)) {
        for (const lower of combinations(below.slice(0, DECOY_CHOICES), 3 - rank)) {
          const decoys = [...upper, ...lower].map((line) => line - start + 1).sort((left, right) => left - right);
          windows.push(Object.freeze({ excerpt: pane.join("\n"), windowStart: start + 1, answer, decoys: Object.freeze(decoys),
            ranks: fixRanks(answer, [answer, ...decoys], pane) }));
        }
      }
    }
  }
  return Object.freeze(windows);
};
