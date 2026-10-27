import { sharedOptionWords, type ParsedFixture } from "../src/index";

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
  // A quote on a line of its own just under a `def` or `class` line opens a docstring rather than closing one, as a
  // window that ends inside a docstring shows.
  const opens = pane.slice(0, Math.max(first, 0)).filter((line) => line.trim().length > 0).at(-1)?.trimEnd().endsWith(":") ?? false;
  let inside = quotes.reduce((sum, count) => sum + count, 0) % 2 === 1 && first >= 0 && /^\s*(?:"""|''')\s*$/u.test(pane[first]!) && !opens;
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
 * code and English words aside (`sharedOptionWords`, which v6 project rounds hold at none, #77). It reads a round as
 * its own version's rule does: from v7 on, words split at a case change count whole too, and so do scripts (#200).
 */
export const paneOverlapSolver = (fixture: ParsedFixture, label: string): number => sharedOptionWords(fixture.panes[0]!.text, label,
  fixture.candidates.find((candidate) => candidate.label === label)!.detail, fixture.source.profileVersion).length;

/**
 * Missing-line and name-the-function decks: a player who buys both hints and picks, of the two options the second
 * names, the one that fits what the first says (a line's kind, a name's count of words), ties split. From v7 on both
 * options of the pair fit (#200), so this is a coin toss.
 */
export const bothHintsSolver = (fits: (label: string, hint: string) => boolean) => (fixture: ParsedFixture, label: string): number => {
  const pair = /^It is either “(.+)” or “(.+)”\.$/u.exec(fixture.clues[1]!)!.slice(1);
  return pair.includes(label) ? 1 + (fits(label, fixture.clues[0]!) ? 1 : 0) : 0;
};

/** Pairs of a deck's rounds that repeat one thing, by round id: one idea, one answer (#84, #200). */
export const repeatedRounds = (fixtures: readonly ParsedFixture[], same: (left: ParsedFixture, right: ParsedFixture) => boolean): readonly string[] =>
  fixtures.flatMap((left, index) => fixtures.slice(index + 1).filter((right) => same(left, right)).map((right) => `${left.roundId}~${right.roundId}`));

/** A small deterministic generator, so simulated deals repeat exactly. */
const seededRandom = (seed: number) => () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
};

/** Five distinct rounds drawn uniformly, as the game deals them. */
const deal = (size: number, random: () => number): readonly number[] => {
  const indexes = Array.from({ length: size }, (_, index) => index);
  for (let index = size - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [indexes[index], indexes[other]] = [indexes[other]!, indexes[index]!];
  }
  return indexes.slice(0, 5);
};

/**
 * A player who never reads code (#81): it remembers every reveal, answers a round it has seen from memory, and
 * otherwise rules out the answers already revealed for rounds with the same options, picking evenly among the rest.
 * Its expected accuracy in game `game`, averaged over seeded uniform deals. Ruling out is a strategy only where
 * option sets differ between rounds; before-after shows every round the same two, so it is off there.
 */
export const memoryPlayer = (fixtures: readonly ParsedFixture[], game: number, ruleOut = true, players = 4_000, seed = 7): number => {
  const random = seededRandom(seed);
  let total = 0;
  for (let player = 0; player < players; player += 1) {
    const seen = new Set<number>();
    const revealed = new Map<string, Set<string>>();
    for (let played = 1; played <= game; played += 1) {
      for (const index of deal(fixtures.length, random)) {
        const fixture = fixtures[index]!;
        const answer = answerOf(fixture);
        if (played === game) {
          if (seen.has(index)) total += 1;
          else {
            const ruledOut = ruleOut ? revealed.get(optionKey(fixture)) ?? new Set<string>() : new Set<string>();
            const remaining = fixture.candidates.filter(({ label }) => !ruledOut.has(label));
            const left = remaining.length > 0 ? remaining : fixture.candidates;
            total += left.some(({ label }) => label === answer) ? 1 / left.length : 0;
          }
        }
        seen.add(index);
        revealed.set(optionKey(fixture), new Set([...(revealed.get(optionKey(fixture)) ?? []), answer]));
      }
    }
  }
  return total / (players * 5);
};

/** What remembering reveals alone earns in game `game` on a pool of `size` rounds with no structure to exploit. */
export const replayBaseline = (size: number, options: number, game: number): number => {
  const seenBefore = 1 - (1 - 5 / size) ** (game - 1);
  return seenBefore + (1 - seenBefore) / options;
};

/** Before-after: the pane with more of something reads as the newer version. */
export const paneSizeSolver = (measure: (text: string) => number) => (fixture: ParsedFixture, label: string): number => {
  const index = fixture.candidates.findIndex((candidate) => candidate.label === label);
  return measure(fixture.panes[index]?.text ?? "");
};
/** Before-after: the pane whose longest line the other pane lacks is the longer reads as the newer version. */
export const changedLineSolver = (fixture: ParsedFixture, label: string): number => {
  const index = fixture.candidates.findIndex((candidate) => candidate.label === label);
  const [pane, other] = [fixture.panes[index]?.text ?? "", fixture.panes[1 - index]?.text ?? ""];
  const others = new Set(other.split("\n").map((line) => line.trim()));
  return Math.max(0, ...pane.split("\n").map((line) => line.trim()).filter((line) => !others.has(line)).map((line) => line.length));
};
