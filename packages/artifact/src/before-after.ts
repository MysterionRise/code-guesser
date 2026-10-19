/**
 * "Before or after?" pane sizes (#75): a refactor usually grows its file, so a player who always picks the bigger pane
 * would win most rounds. These rules, shared by the selector and the parser, keep every size a code-blind player
 * might compare near chance.
 */

/** The sizes compared: characters, lines, and the longest line that differs between the panes. */
export const PANE_MEASURES = Object.freeze(["characters", "lines", "longest changed line"] as const);

const sign = (value: number): number => Math.sign(value);
/** The longest line of a pane, trimmed, that the other pane does not hold. */
const longestChanged = (pane: string, other: string): number => {
  const others = new Set(other.split("\n").map((line) => line.trim()));
  return Math.max(0, ...pane.split("\n").map((line) => line.trim()).filter((line) => !others.has(line)).map((line) => line.length));
};
/** How the later pane compares with the earlier one in each measure: 1 bigger, -1 smaller, 0 as big. */
export const paneGrowth = (earlier: string, later: string): readonly number[] => Object.freeze([
  sign(later.length - earlier.length),
  sign(later.split("\n").length - earlier.split("\n").length),
  sign(longestChanged(later, earlier) - longestChanged(earlier, later)),
]);

/** The most a player may win by always picking the bigger, or always the smaller, pane by lines or longest change. */
export const SIZE_SOLVER_LIMIT = 0.6;
/**
 * Whether these rounds' growth fits a deck of `size` rounds: by characters the later pane is the bigger one in at
 * most half the deck and one, and as big or smaller in at most as many, so a full deck has it bigger in half, give or
 * take one; by lines and by the longest changed line, picking the bigger or the smaller pane, ties split, wins at most
 * 60% of the deck. A selector checks a deck as it fills; the parser checks the whole deck.
 */
export const growthFits = (growth: readonly (readonly number[])[], size: number): boolean => {
  const half = Math.floor(size / 2) + 1;
  const bigger = growth.filter(([characters]) => characters! > 0).length;
  if (bigger > half || growth.length - bigger > half) return false;
  return [1, 2].every((measure) => {
    const count = (value: number) => growth.filter((signs) => signs[measure] === value).length;
    const ties = count(0) / 2;
    return count(1) + ties <= SIZE_SOLVER_LIMIT * size + 1e-9 && count(-1) + ties <= SIZE_SOLVER_LIMIT * size + 1e-9;
  });
};
