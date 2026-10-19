/**
 * Rounds that repeat another round's idea (#84): two output rounds whose functions are named for one thing, and two
 * fix rounds from one file or from files named alike side by side. Shared by the selectors and the parser.
 */

/** Words a name may add without changing what it names. */
const NAME_FILLER: ReadonlySet<string> = new Set(["get", "set", "is", "to", "of", "the", "and", "or", "a", "an", "in", "on", "for",
  "by", "with", "using", "from", "compute", "calculate", "calc", "find", "recursive", "iterative", "le", "ge", "lt", "gt", "num",
  "number"]);
/** A name's words: split at underscores, hyphens, dots, and case changes, lower-cased, filler aside. */
export const ideaWords = (name: string): ReadonlySet<string> => new Set(name.replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
  .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2").toLocaleLowerCase("en-US").split(/[^a-z0-9]+/u)
  .filter((word) => word.length > 0 && !NAME_FILLER.has(word)));
/**
 * Whether two names name one idea: the shorter has two words or more, and each is a word of the other
 * (`count_vowels` and `count_vowels_and_consonants`, `git_push` and `git_push_force`). A one-word name such as
 * `power` says too little to tie it to `next_power_of_two`.
 */
export const sameIdea = (left: string, right: string): boolean => {
  const [shorter, longer] = [ideaWords(left), ideaWords(right)].sort((first, second) => first.size - second.size) as
    [ReadonlySet<string>, ReadonlySet<string>];
  return shorter.size >= 2 && [...shorter].every((word) => longer.has(word));
};
/** A file's directory and its name without the extension. */
const fileParts = (path: string): readonly [string, string] => {
  const slash = path.lastIndexOf("/");
  const name = path.slice(slash + 1);
  return [path.slice(0, Math.max(slash, 0)), name.includes(".") ? name.slice(0, name.lastIndexOf(".")) : name];
};
/**
 * Whether two files of one repository hold one idea: the same file, or files side by side named alike
 * (`rules/git_push.py` and `rules/git_push_force.py`).
 */
export const sameFile = (left: Readonly<{ repository: string; path: string }>, right: Readonly<{ repository: string; path: string }>): boolean => {
  if (left.repository.toLocaleLowerCase("en-US") !== right.repository.toLocaleLowerCase("en-US")) return false;
  const [leftDirectory, leftStem] = fileParts(left.path);
  const [rightDirectory, rightStem] = fileParts(right.path);
  return left.path === right.path || (leftDirectory === rightDirectory && sameIdea(leftStem, rightStem));
};
