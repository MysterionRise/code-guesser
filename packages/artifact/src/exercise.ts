import { labelWords, showsLabelStem } from "./artifact";
import { STACK_LANGUAGES, type CandidateRecord, type Pane, type ParsedSource } from "./domain";
import { fail } from "./errors";
import { MEMBER_ID, familyOptions, parseFamilyMembers, showsMemberSymbol, spellsMember, type FamilyMember } from "./family";
import { rawHash } from "./validation";

/**
 * "Which exercise?" (#58): the reference solution to an Exercism practice exercise, one track's, with every option's
 * names and label stems masked as `mystery`. A round offers one whole family of four exercises; the truth is the
 * exercise directory the solution sits in. These rules are shared by the generator and the parser.
 */

export const exerciseCandidateId = (id: string): string =>
  MEMBER_ID.test(id) ? `local-experiment.exercise.${id}.v1` : fail();

/** The exercises a snapshot lists, in id order, labels distinct. */
export const parseExercises = (value: unknown, read: (entry: unknown) => Readonly<Record<string, unknown>>): ReadonlyMap<string, FamilyMember> =>
  parseFamilyMembers(value, read, exerciseCandidateId);

/**
 * Whether prose names an exercise: its label or names, or one of its label's distinctive words as a word (`squares`
 * would point to "Difference of squares", `cipher` to every cipher).
 */
export const copyNamesExercise = (value: string, exercise: Readonly<{ label: string; names: readonly string[] }>): boolean =>
  spellsMember(value, exercise) || labelWords(exercise.label).some((word) => new RegExp(`(?<![a-z])${word}(?![a-z])`, "iu").test(value));

/** Whether code names an exercise: its label or names, a symbol, or a label stem anywhere in an identifier. */
export const codeNamesExercise = (code: string, exercise: Readonly<{ label: string; names: readonly string[]; symbols: readonly string[] }>): boolean =>
  spellsMember(code, exercise) || showsMemberSymbol(code, exercise) || showsLabelStem(code, exercise.label);

/**
 * The options are one whole family of exercises and the answer is the one whose directory the file is in; the pane
 * names no option, nor does the prompt or a hint.
 */
export const validateExercise = ({ exercises, panes, prompt, candidates, clues, correctCandidateId, source }: Readonly<{
  exercises: ReadonlyMap<string, FamilyMember>; panes: readonly Pane[]; prompt: string; candidates: readonly CandidateRecord[];
  clues: readonly string[]; correctCandidateId: string; source: ParsedSource;
}>): void => {
  const { options, answer } = familyOptions(exercises, candidates, correctCandidateId, exerciseCandidateId);
  const code = panes[0]!.text;
  if (answer.id !== source.exercise || source.excerptHash !== rawHash(code)
    || !(STACK_LANGUAGES as readonly unknown[]).includes(source.language)
    || !source.path.includes(`/${answer.id}/`)) fail();
  if (options.some((option) => codeNamesExercise(code, option) || [prompt, ...clues].some((part) => copyNamesExercise(part, option)))) fail();
};
