import { MASKED_NAME, STACK_LANGUAGES, type CandidateRecord, type Pane } from "./domain";
import { fail } from "./errors";
import { MISSING_LINE_ORDERS } from "./missing-line";
import { rawHash, type JsonRecord } from "./validation";

/**
 * "Name the function" (#73): one function of a real file, its name masked as `mystery`, and four names declared in
 * that file to pick from. The truth is the declared name. These rules are shared by the generator and the parser.
 */

/** An option's id: its own name, hashed. */
export const nameFunctionCandidateId = (label: string): string => `local-experiment.name-function.${rawHash(label).slice(0, 16)}.v1`;

/** A name's words: `binarySearch` is binary, Search; `is_prime` is is, prime; `HTTPGet` is HTTP, Get. */
export const nameWords = (name: string): readonly string[] => name.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+|[0-9]+/gu) ?? [];

const fold = (value: string): string => value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/gu, "");

/** How many words a name joins, as the first hint names it; a hint narrows the options without picking one. */
export type NameShape = "ONE" | "TWO" | "MORE";

export const nameShape = (name: string): NameShape => {
  const words = nameWords(name).length;
  return words <= 1 ? "ONE" : words === 2 ? "TWO" : "MORE";
};

export const NAME_SHAPE_HINTS: Readonly<Record<NameShape, string>> = Object.freeze({
  ONE: "The name is a single word.",
  TWO: "The name joins two words.",
  MORE: "The name joins three words or more.",
});

/** The second hint: the answer and one other option, in text order, each in curly quotes. */
export const nameFunctionPairHint = (first: string, second: string): string => {
  const [low, high] = [first, second].sort();
  return `It is either “${low}” or “${high}”.`;
};
const PAIR_HINT = /^It is either “(.+)” or “(.+)”\.$/u;

/** The orders a code-blind solver might rank four names by: their text, and their length. */
export const NAME_FUNCTION_ORDERS = MISSING_LINE_ORDERS;

/**
 * Whether code spells `name`: as an identifier, or as a run of an identifier's words (`merge` in `mergeHalves`,
 * `binary_search` in `binarySearchRange`), in strings and calls alike.
 */
export const codeSpells = (code: string, name: string): boolean => {
  const target = fold(name);
  return (code.match(/[A-Za-z_][A-Za-z0-9_]*/gu) ?? []).some((identifier) => {
    if (identifier === name) return true;
    const words = nameWords(identifier).map(fold);
    for (let start = 0; start < words.length; start += 1) {
      let joined = "";
      for (let end = start; end < words.length && joined.length < target.length; end += 1) {
        joined += words[end]!;
        if (joined === target) return true;
      }
    }
    return false;
  });
};

const optionLabel = (label: string): string => /^[A-Za-z_][A-Za-z0-9_]{1,63}$/u.test(label) ? label : fail();

/**
 * The pane is one function whose declaration, on its first line, shows the masked name, always the whole identifier
 * `mystery` in lower case (Go's exported names would otherwise stand apart); the options are four names distinct even
 * ignoring case and underscores, the answer is the name the source records, and the pane spells none of them; the first hint names how many words the answer
 * joins, and at least one other option joins as many; the second names the answer and one other option.
 */
export const validateNameFunction = ({ panes, candidates, clues, correctCandidateId, source }: Readonly<{
  panes: readonly Pane[]; candidates: readonly CandidateRecord[]; clues: readonly string[]; correctCandidateId: string; source: JsonRecord;
}>): void => {
  const labels = candidates.map(({ id, label }) => id === nameFunctionCandidateId(optionLabel(label)) ? label : fail());
  // Distinct even ignoring case and underscores: `inOrderSort` beside `inorderSort`, or Go's `Merge` beside `merge`,
  // would be a coin toss no reading decides.
  if (new Set(labels.map(fold)).size !== labels.length) fail();
  const answer = candidates.find(({ id }) => id === correctCandidateId)?.label ?? fail();
  const code = panes[0]!.text;
  if (answer !== source.functionName || source.excerptHash !== rawHash(code)
    || !(STACK_LANGUAGES as readonly unknown[]).includes(source.language)) fail();
  // Only the function's own name is masked: an identifier such as `VectorMystery` would say the answer is part of
  // another name.
  const identifiers = (text: string): readonly string[] => text.match(/[A-Za-z_][A-Za-z0-9_]*/gu) ?? [];
  const masked = identifiers(code).filter((identifier) => fold(identifier).includes(MASKED_NAME));
  if (!identifiers(code.split("\n")[0]!).includes(MASKED_NAME)
    || masked.some((identifier) => identifier !== MASKED_NAME) || labels.some((label) => codeSpells(code, label))) fail();
  const shape = nameShape(answer);
  if (clues[0] !== NAME_SHAPE_HINTS[shape] || !labels.some((label) => label !== answer && nameShape(label) === shape)) fail();
  const pair = PAIR_HINT.exec(clues[1] ?? "") ?? fail();
  const named = [pair[1]!, pair[2]!];
  if (named[0]! >= named[1]! || !named.includes(answer) || named.some((label) => !labels.includes(label))) fail();
};

/**
 * The deck's balance: in text order and in length order, every rank holds the answer about equally often (within
 * two rounds), so no fixed pick or extreme finds it more often than chance.
 */
export const nameFunctionDeckRule = (fixtures: readonly Readonly<{ candidates: readonly CandidateRecord[]; correctCandidateId: string }>[]): void => {
  for (const order of NAME_FUNCTION_ORDERS) {
    const ranks = [0, 0, 0, 0];
    for (const fixture of fixtures) {
      const answer = fixture.candidates.find(({ id }) => id === fixture.correctCandidateId)!.label;
      ranks[order(fixture.candidates.map(({ label }) => label)).indexOf(answer)]! += 1;
    }
    if (Math.max(...ranks) - Math.min(...ranks) > 2) fail();
  }
};
