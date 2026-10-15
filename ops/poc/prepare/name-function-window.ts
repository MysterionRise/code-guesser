import { NAME_FUNCTION_ORDERS, codeSpells, nameShape, nameWords } from "../../../packages/artifact/src/index";
import { canonicalHash } from "./canonical";
import { maskNames } from "./function-windows";
import type { StackLanguage } from "./profile";

/**
 * "Name the function" panes (#73): one function of a file with its commentary removed, its name masked, and three
 * other functions of the same file to offer beside it. A choice records the answer's rank in every order a code-blind
 * solver might rank the four names by, so the deck can balance them across its pool.
 */
export interface NameChoice {
  /** The function's declaration line in the file without commentary, counted from one. */
  readonly functionLine: number;
  /** The pane: the function, dedented, with its name masked. */
  readonly excerpt: string;
  readonly answer: string;
  /** Three other functions the file declares, none of them spelled in the pane. */
  readonly decoys: readonly string[];
  /** The answer's rank among the four in text order and in length order. */
  readonly ranks: readonly number[];
  /** What each extreme solver scores on this round (`nameExtremeScores`). */
  readonly extremes: readonly number[];
}

/** The orders choices are balanced in, the parser's two; neither may lean. */
export const NAME_ORDERS = 2;
export const nameSlack = (_rounds: number): readonly number[] => Object.freeze([0, 0]);

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/gu;
/** The words a pane's identifiers use, folded, the masked name aside. */
const paneWords = (pane: string): ReadonlySet<string> => new Set((pane.match(IDENTIFIER) ?? [])
  .flatMap((identifier) => nameWords(identifier)).map((word) => word.toLocaleLowerCase("en-US")).filter((word) => word !== "mystery"));
/** How many of a name's words of three letters or more the pane uses. */
const sharedWords = (name: string, words: ReadonlySet<string>): number =>
  new Set(nameWords(name).map((word) => word.toLocaleLowerCase("en-US")).filter((word) => word.length >= 3 && words.has(word))).size;

/**
 * Name features a code-blind solver might pick the most or the least of: words shared with the pane (a good name
 * often says what its body does), and words in the name. They often tie, and a solver splits a tie.
 */
const NAME_FEATURES: readonly ((name: string, words: ReadonlySet<string>) => number)[] = Object.freeze([
  sharedWords, (name: string) => nameWords(name).length,
]);

/**
 * What each extreme solver scores on one round: for every feature, picking the name with the most of it, then the
 * name with the least; one when the answer alone is that name, a share when it ties, nothing otherwise.
 */
export const nameExtremeScores = (answer: string, options: readonly string[], pane: string): readonly number[] => {
  const words = paneWords(pane);
  return [1, -1].flatMap((direction) => NAME_FEATURES.map((measure) => {
    const values = options.map((option) => direction * measure(option, words));
    const top = Math.max(...values);
    return values[options.indexOf(answer)] === top ? 1 / values.filter((value) => value === top).length : 0;
  }));
};
/** The most each extreme solver may score over a deck: an equal share plus a tenth of the deck. */
export const nameExtremeLimits = (rounds: number): readonly number[] =>
  [1, -1].flatMap(() => NAME_FEATURES.map(() => Math.ceil(rounds / 4) + Math.floor(rounds / 10)));

/** A function declared in a file: its name, its first line, and the index after its last, counted from zero. */
export interface DeclaredFunction {
  readonly name: string;
  readonly start: number;
  readonly end: number;
  /** Whether it implements a name an interface or a parent fixed (`@Override`), so the author did not choose it. */
  readonly inherited: boolean;
}

/**
 * Names nobody chooses: entry points, conventions an interface fixes (Java's `Object` and `Iterator`, Go's
 * `sort.Interface`, `heap.Interface`, `Stringer`, and `error`), and test hooks.
 */
const CONVENTIONAL = new Set([
  "main", "init", "toString", "equals", "hashCode", "compareTo", "compare", "clone", "iterator", "hasNext", "next", "remove",
  "run", "call", "apply", "accept", "test", "get", "set", "size", "isEmpty", "close", "String", "Error", "Len", "Less",
  "Swap", "Push", "Pop", "setUp", "tearDown",
]);

const JAVA_NOT_TYPES = new Set([
  "public", "private", "protected", "static", "final", "synchronized", "abstract", "native", "default", "strictfp",
  "return", "new", "else", "throw", "case", "if", "for", "while", "switch", "catch", "try", "do", "assert", "yield",
  "record", "class", "interface", "enum", "}", "{", "=", "->",
]);

/** The block a line opens, by brace depth: the index after the line that closes it. */
const braceEnd = (lines: readonly string[], start: number): number | undefined => {
  let depth = 0;
  let opened = false;
  for (let index = start; index < lines.length; index += 1) {
    for (const character of lines[index]!.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`/gu, "")) {
      if (character === "{") { depth += 1; opened = true; }
      if (character === "}") depth -= 1;
      if (!opened && character === ";") return undefined;
    }
    if (opened && depth <= 0) return index + 1;
  }
  return undefined;
};

const javaMethodName = (line: string): string | undefined => {
  const head = /^([^(=;]*)\(/u.exec(line.trim())?.[1];
  if (head === undefined) return undefined;
  const tokens = head.replace(/@\w+(?:\([^)]*\))?/gu, " ").replace(/<(?:[^<>]|<[^<>]*>)*>/gu, " ").trim().split(/\s+/u);
  const [type, name] = [tokens.at(-2), tokens.at(-1)];
  if (type === undefined || name === undefined || !/^[A-Za-z_$][\w$]*$/u.test(name) || JAVA_NOT_TYPES.has(type) || JAVA_NOT_TYPES.has(name)) return undefined;
  return name;
};

const indentOf = (line: string): number => /^[ \t]*/u.exec(line)![0].length;

/** Every function a file declares, in file order, from the file's text with its commentary removed. */
export const declaredFunctions = (plain: string, language: StackLanguage): readonly DeclaredFunction[] => {
  const lines = plain.split("\n");
  const found: DeclaredFunction[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    let name: string | undefined;
    let end: number | undefined;
    if (language === "Python") {
      name = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/u.exec(line)?.[1];
      if (name !== undefined) {
        end = index + 1;
        while (end < lines.length && (lines[end]!.trim().length === 0 || indentOf(lines[end]!) > indentOf(line))) end += 1;
        while (end > index + 1 && lines[end - 1]!.trim().length === 0) end -= 1;
      }
    } else if (language === "Go") {
      name = /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\(/u.exec(line)?.[1];
      if (name !== undefined) end = braceEnd(lines, index);
    } else if (language === "Java") {
      name = javaMethodName(line);
      if (name !== undefined) end = braceEnd(lines, index);
    }
    if (name === undefined || end === undefined) continue;
    const inherited = index > 0 && /^\s*@Override\b/u.test(lines[index - 1]!);
    found.push(Object.freeze({ name, start: index, end, inherited }));
  }
  return Object.freeze(found);
};

/** Whether a function's name is the author's choice: no convention, interface, or test runner fixed it. */
const authored = ({ name, inherited }: DeclaredFunction): boolean =>
  !inherited && !CONVENTIONAL.has(name) && !/^(?:test|Test|Benchmark|Example|Fuzz)/u.test(name) && !/^__\w+__$/u.test(name) && name.length >= 3;

/** A function a round can ask about has a body of two lines or more, so it says enough to be named. */
const MINIMUM_SPAN = 4;

/** The lines with their shared indentation removed. */
const dedented = (lines: readonly string[]): readonly string[] => {
  const shared = Math.min(...lines.filter((line) => line.trim().length > 0).map(indentOf));
  return lines.map((line) => line.slice(Math.min(shared, indentOf(line))));
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

/** Decoys are drawn from the first few eligible names of the file. */
const DECOY_CHOICES = 6;

/**
 * Every round a file could make, in `seed` order: each function the author named (no convention or `@Override`
 * fixed it) of four to `maxLines` lines, dedented and its name masked as `mystery` wherever an identifier spells it,
 * with each way to offer three of the file's other authored names as decoys. The pane never spells a decoy (a call to
 * it would rule it out), names sharing the most words with the pane come first, and the set holds at least one name
 * of as many words as the answer, so the first hint never picks it.
 */
export const nameChoices = (plain: string, language: StackLanguage, seed: string, maxLines: number): readonly NameChoice[] => {
  const lines = plain.split("\n");
  const functions = declaredFunctions(plain, language).filter(authored);
  const names = [...new Set(functions.map(({ name }) => name))];
  const choices: NameChoice[] = [];
  for (const target of functions) {
    const span = target.end - target.start;
    if (span < MINIMUM_SPAN || span > maxLines || functions.filter(({ name }) => name === target.name).length > 1) continue;
    const answer = target.name;
    const masked = maskNames(dedented(lines.slice(target.start, target.end)).join("\n"), { names: [answer], symbols: [answer], stems: [] });
    // Only the name itself is masked: `VectorCrossProduct` shown as `VectorMystery` would tie the answer to another name.
    if (masked.masked.some((identifier) => identifier !== answer) || /mystery/iu.test(lines.slice(target.start, target.end).join("\n"))) continue;
    // Always `mystery`, whatever the name's case, so Go's exported names don't stand apart from the others.
    const excerpt = masked.text.replace(/(?<![A-Za-z0-9_])(?:Mystery|MYSTERY)(?![A-Za-z0-9_])/gu, "mystery");
    if (!/(?<![A-Za-z0-9_])mystery(?![A-Za-z0-9_])/u.test(excerpt.split("\n")[0]!) || codeSpells(excerpt, answer)) continue;
    const words = paneWords(excerpt);
    const folded = (name: string) => name.toLocaleLowerCase("en-US").replaceAll("_", "");
    const eligible = names.map((_, index) => index).filter((index) => folded(names[index]!) !== folded(answer)
      && !codeSpells(excerpt, names[index]!));
    const seeded = ordered(`${seed}:${answer}`, eligible);
    const pool = [...seeded].sort((left, right) => sharedWords(names[right]!, words) - sharedWords(names[left]!, words)
      || seeded.indexOf(left) - seeded.indexOf(right)).slice(0, DECOY_CHOICES);
    for (const picked of combinations(pool, 3)) {
      const decoys = picked.map((index) => names[index]!);
      if (new Set(decoys.map(folded)).size !== 3) continue;
      if (!decoys.some((decoy) => nameShape(decoy) === nameShape(answer))) continue;
      const options = [answer, ...decoys];
      const ranks = NAME_FUNCTION_ORDERS.map((order) => order(options).indexOf(answer));
      choices.push(Object.freeze({ functionLine: target.start + 1, excerpt, answer, decoys: Object.freeze(decoys), ranks: Object.freeze(ranks),
        extremes: nameExtremeScores(answer, options, excerpt) }));
    }
  }
  // In seed order, not file order, so a cap on how many a file offers still samples all its functions.
  const keyed = choices.map((choice) => ({ choice, key: canonicalHash({ seed, answer: choice.answer, decoys: choice.decoys }) }));
  return Object.freeze(keyed.sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0).map(({ choice }) => choice));
};
