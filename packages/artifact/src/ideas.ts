import { profileAtLeast, type ProfileVersion } from "./domain";

/**
 * Rounds that repeat another round's idea (#84): two output rounds whose functions are named for one thing, and two
 * fix rounds from one file or from files named alike side by side. Shared by the selectors and the parser.
 */

/** Words a name may add without changing what it names. */
const NAME_FILLER: ReadonlySet<string> = new Set(["get", "set", "is", "to", "of", "the", "and", "or", "a", "an", "in", "on", "for",
  "by", "with", "using", "from", "compute", "calculate", "calc", "find", "recursive", "iterative", "le", "ge", "lt", "gt", "num",
  "number"]);
/** A name's words: split at underscores, hyphens, dots, and case changes, lower-cased. */
const nameWords = (name: string): readonly string[] => name.replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
  .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2").toLocaleLowerCase("en-US").split(/[^a-z0-9]+/u).filter((word) => word.length > 0);
const meaningful = (words: readonly string[]): ReadonlySet<string> => new Set(words.filter((word) => !NAME_FILLER.has(word)));
/** A name's words, filler aside. */
export const ideaWords = (name: string): ReadonlySet<string> => meaningful(nameWords(name));
/** Whether the shorter of two names' words has two or more, each a word of the other. */
const tied = (left: ReadonlySet<string>, right: ReadonlySet<string>): boolean => {
  const [shorter, longer] = [left, right].sort((first, second) => first.size - second.size) as [ReadonlySet<string>, ReadonlySet<string>];
  return shorter.size >= 2 && [...shorter].every((word) => longer.has(word));
};

/** From v7 on (#200), short forms read as the word they stand for; `int` and `decimal` both name a plain integer. */
const IDEA_SYNONYMS: Readonly<Record<string, string>> = Object.freeze({
  bin: "binary", oct: "octal", hex: "hexadecimal", dec: "decimal", int: "decimal", integer: "decimal",
});
/** And a base's number reads as its name: `base_2` is `binary`. */
const BASE_NAMES: Readonly<Record<string, string>> = Object.freeze({ 2: "binary", 8: "octal", 10: "decimal", 16: "hexadecimal" });
/** A name's words with each synonym read as its word: `decimal_to_negative_base_2` reads decimal, to, negative, binary. */
const plainWords = (name: string): readonly string[] => {
  const words = nameWords(name);
  const plain: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const base = words[index] === "base" ? BASE_NAMES[words[index + 1]!] : undefined;
    if (base !== undefined) index += 1;
    plain.push(base ?? IDEA_SYNONYMS[words[index]!] ?? words[index]!);
  }
  return plain;
};
/**
 * A conversion's two sides, what it reads first: `a_to_b` and `b_from_a` both turn a into b. Undefined unless one `to`
 * or `from` splits the name into two sides with words.
 */
const conversion = (words: readonly string[]): readonly [string, string] | undefined => {
  const marks = words.flatMap((word, index) => word === "to" || word === "from" ? [index] : []);
  if (marks.length !== 1) return undefined;
  const side = (part: readonly string[]) => [...meaningful(part)].sort().join(" ");
  const [before, after] = [side(words.slice(0, marks[0])), side(words.slice(marks[0]! + 1))];
  if (before.length === 0 || after.length === 0) return undefined;
  return words[marks[0]!] === "to" ? [before, after] : [after, before];
};

/**
 * Whether two names name one idea: the shorter has two words or more, and each is a word of the other
 * (`count_vowels` and `count_vowels_and_consonants`, `git_push` and `git_push_force`). A one-word name such as
 * `power` says too little to tie it to `next_power_of_two`.
 *
 * From v7 on (#200), synonyms read as one word too. Two conversions are one idea when they join the same two sides,
 * either way round: `decimal_to_negative_base_2` and `decimal_to_negative_binary`, and its inverse
 * `negative_binary_to_int`. A conversion's words alone tie it to nothing new, since `bin_to_decimal` shares every
 * word with `binary_coded_decimal`; two other names are tied by their words as before.
 */
export const sameIdea = (left: string, right: string, version: ProfileVersion): boolean => {
  if (tied(ideaWords(left), ideaWords(right))) return true;
  if (!profileAtLeast(version, "local-real-rounds.v7")) return false;
  const [leftWords, rightWords] = [plainWords(left), plainWords(right)];
  const [one, other] = [conversion(leftWords), conversion(rightWords)];
  if (one === undefined && other === undefined) return tied(meaningful(leftWords), meaningful(rightWords));
  return one !== undefined && other !== undefined
    && ((one[0] === other[0] && one[1] === other[1]) || (one[0] === other[1] && one[1] === other[0]));
};
/** A file's directory and its name without the extension. */
const fileParts = (path: string): readonly [string, string] => {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  return [path.slice(0, Math.max(slash, 0)), name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name];
};
/**
 * Whether two files of one repository hold one idea: the same file, or files side by side named alike
 * (`rules/git_push.py` and `rules/git_push_force.py`). File names keep the v6 reading: the synonyms (#200) are for
 * what an output round's function computes.
 */
export const sameFile = (left: Readonly<{ repository: string; path: string }>, right: Readonly<{ repository: string; path: string }>): boolean => {
  if (left.repository.toLocaleLowerCase("en-US") !== right.repository.toLocaleLowerCase("en-US")) return false;
  const [leftDirectory, leftStem] = fileParts(left.path);
  const [rightDirectory, rightStem] = fileParts(right.path);
  return left.path === right.path || (leftDirectory === rightDirectory && tied(ideaWords(leftStem), ideaWords(rightStem)));
};
