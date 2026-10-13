import type { ParsedFixture } from "../src/index";

/**
 * Solvers that never read the code as code: each sees what a player sees before answering (the options, their
 * details, the hints) and at most skims the pane for words, lengths, or symbols. Accuracy is the expected share of
 * rounds answered correctly, with ties split evenly.
 */
export const TOLERANCE = 0.1;

export const optionKey = (fixture: ParsedFixture): string => fixture.candidates.map(({ label }) => label).sort().join("|");
export const answerOf = (fixture: ParsedFixture): string => fixture.candidates.find(({ id }) => id === fixture.correctCandidateId)!.label;
export const chance = (fixture: ParsedFixture): number => 1 / fixture.candidates.length;

/** Expected accuracy of a solver that scores each option and picks the best, splitting ties evenly. */
export const accuracy = (fixtures: readonly ParsedFixture[], score: (fixture: ParsedFixture, label: string, index: number) => number): number =>
  fixtures.reduce((total, fixture, index) => {
    const scores = fixture.candidates.map(({ label }) => score(fixture, label, index));
    const best = Math.max(...scores);
    const winners = fixture.candidates.filter((_, position) => scores[position] === best);
    return total + (winners.some(({ label }) => label === answerOf(fixture)) ? 1 / winners.length : 0);
  }, 0) / fixtures.length;

/** Leave one out: how often each option was the answer in every other round showing the same options. */
export const sameOptionsSolver = (fixtures: readonly ParsedFixture[]) => (fixture: ParsedFixture, label: string, index: number): number =>
  fixtures.filter((other, position) => position !== index && optionKey(other) === optionKey(fixture) && answerOf(other) === label).length;

/** How often each option appears anywhere in the pool. */
export const frequencySolver = (fixtures: readonly ParsedFixture[]) => (_fixture: ParsedFixture, label: string): number =>
  fixtures.filter((other) => other.candidates.some((candidate) => candidate.label === label)).length;
/** The reverse: an option seen in many rounds may be a decoy the pool reuses. */
export const raritySolver = (fixtures: readonly ParsedFixture[]) => (fixture: ParsedFixture, label: string): number =>
  -frequencySolver(fixtures)(fixture, label);

/** The option that sorts first by label, a stand-in for any fixed preference among the labels. */
export const alphabeticalSolver = (fixture: ParsedFixture, label: string): number =>
  -[...fixture.candidates.map(({ label: other }) => other)].sort().indexOf(label);

/** A pane's lines. */
export const paneLines = (fixture: ParsedFixture): readonly string[] => fixture.panes[0]!.text.split("\n");

/**
 * Algorithm decks: how many words of an option's label, or their rough stems (`heapsort` → `heap`, `counting` →
 * `count`), a skim of the code finds anywhere. Picking the most finds an answer whose name leaked; picking the fewest
 * finds one whose decoys' words were left in view.
 */
const GENERIC_LABEL_WORDS: ReadonlySet<string> = new Set(["sort", "search", "first", "algorithm"]);
export const labelWordSolver = (direction: 1 | -1) => (fixture: ParsedFixture, label: string): number => {
  const code = fixture.panes.map(({ text }) => text).join("\n").toLocaleLowerCase("en-US");
  const words = label.toLocaleLowerCase("en-US").replace(/['’]s\b/gu, "").split(/[^a-z0-9]+/u)
    .filter((word) => word.length > 1 && !GENERIC_LABEL_WORDS.has(word));
  const stem = (word: string) => word.replace(/(?:sort|search|ing|ion|ive|ed|er|es|s)$/u, "");
  return direction * words.filter((word) => code.includes(word) || (stem(word).length >= 3 && code.includes(stem(word)))).length;
};

/** Fix decks: a fix option's line of the pane. */
export const optionLine = (fixture: ParsedFixture, label: string): string => paneLines(fixture)[Number(label.slice("Line ".length)) - 1]!;
const WORD = /[A-Za-z_]\w+/gu;
/** Line features a skim can rank fix options by: length, operators and brackets, indentation, and words used once. */
export const LINE_FEATURES: Readonly<Record<string, (line: string, pane: readonly string[]) => number>> = Object.freeze({
  length: (line: string) => line.trim().length,
  operators: (line: string) => (line.match(/[()[\]=<>!&|+\-*/%]/gu) ?? []).length,
  indentation: (line: string) => /^\s*/u.exec(line)![0].length,
  "words used once": (line: string, pane: readonly string[]) => {
    const counts = new Map<string, number>();
    for (const word of pane.join("\n").match(WORD) ?? []) counts.set(word, (counts.get(word) ?? 0) + 1);
    return (line.match(WORD) ?? []).filter((word) => counts.get(word) === 1).length;
  },
});
/** Picks the option line with the most (`1`) or the least (`-1`) of a feature. */
export const lineFeatureSolver = (feature: string, direction: 1 | -1) => (fixture: ParsedFixture, label: string): number =>
  direction * LINE_FEATURES[feature]!(optionLine(fixture, label), paneLines(fixture));
/**
 * Lines of a pane that read as prose, judged from the pane alone: comment lines, and lines inside a triple-quoted
 * docstring, including one the pane opens inside (an odd count of triple quotes whose first is on a line of its own).
 */
export const proseLines = (pane: readonly string[]): ReadonlySet<number> => {
  const quotes = pane.map((line) => (line.match(/"""|'''/gu) ?? []).length);
  const first = quotes.findIndex((count) => count > 0);
  let inside = quotes.reduce((sum, count) => sum + count, 0) % 2 === 1 && first >= 0 && /^\s*(?:"""|''')\s*$/u.test(pane[first]!);
  const prose = new Set<number>();
  pane.forEach((line, index) => {
    if (inside || /^\s*(?:#|\/\/|\/\*|\*|"""|''')/u.test(line)) prose.add(index + 1);
    if (quotes[index]! % 2 === 1) inside = !inside;
  });
  return prose;
};
/** The two lines the second fix hint names. */
export const hintPair = (fixture: ParsedFixture): readonly number[] =>
  /line (\d+) or line (\d+)/u.exec(fixture.clues[1]!)!.slice(1).map(Number);
/** After the second hint, picks the longer (`1`) or shorter (`-1`) of the two lines it names. */
export const pairLengthSolver = (direction: 1 | -1) => (fixture: ParsedFixture, label: string): number =>
  hintPair(fixture).includes(Number(label.slice("Line ".length))) ? 1000 + direction * optionLine(fixture, label).trim().length : 0;

/**
 * Output decks: whether an option can be read off the call's arguments without the function: a case-blind piece of
 * the arguments, the same letters as a string argument rearranged, or the call's own numbers reordered.
 */
export const transformsArguments = (fixture: ParsedFixture, label: string): boolean => {
  const call = String(fixture.source.call);
  const argumentsText = call.slice(call.indexOf("("));
  const unquoted = label.replace(/^['"]|['"]$/gu, "");
  const strings = [...argumentsText.matchAll(/"([^"]*)"|'([^']*)'/gu)].map((match) => match[1] ?? match[2] ?? "");
  const letters = (value: string) => [...value.replace(/\s/gu, "")].sort().join("");
  const numbers = (value: string) => (value.match(/-?\d+(?:\.\d+)?/gu) ?? []).map(Number).sort((left, right) => left - right).join(",");
  return (unquoted.length > 0 && argumentsText.toLocaleLowerCase("en-US").includes(unquoted.toLocaleLowerCase("en-US")))
    || strings.some((argument) => argument.length > 1 && letters(argument) === letters(unquoted))
    || (numbers(label) !== "" && numbers(label) === numbers(argumentsText));
};

/**
 * Project decks: how many five-letter word stems the pane shares with an option's name and description, common
 * code and English words aside.
 */
const COMMON_WORDS: ReadonlySet<string> = new Set(("the and for with that this from are was were not but you your all any can has have had its "
  + "into out use used one two get set new return returns true false null none nil self var let val const def func fun function class "
  + "struct public private static final void int string bool boolean else elif then end import package module type types err error "
  + "value values data list dict map key keys item items name names file files code index len length test tests our more most some "
  + "only also each when what which who will would should could may might must than them they their there these those here how why "
  + "make made just like about over under after before onto via per").split(" "));
const stems = (text: string): ReadonlySet<string> => new Set(text.replace(/([a-z0-9])([A-Z])/gu, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
  .toLocaleLowerCase("en-US").split(/[^a-z0-9]+/u).filter((word) => word.length >= 3 && !COMMON_WORDS.has(word) && !/^\d+$/u.test(word))
  .map((word) => word.slice(0, 5)));
export const paneOverlapSolver = (fixture: ParsedFixture, label: string): number => {
  const pane = stems(fixture.panes[0]!.text);
  const option = fixture.candidates.find((candidate) => candidate.label === label)!;
  return [...stems(`${label.replace("/", " ")} ${option.detail ?? ""}`)].filter((stem) => pane.has(stem)).length;
};
