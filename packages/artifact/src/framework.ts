import type { CandidateRecord, Pane, ParsedSource } from "./domain";
import { fail } from "./errors";
import {
  MEMBER_ID, familyDeckRule, familyOptions, parseFamilyMembers, showsMemberSymbol, spellsMember, type FamilyMember,
} from "./family";
import { rawHash } from "./validation";

/**
 * "Which framework?" (#62): a window of one TodoMVC example, the same to-do app built with a different framework in
 * each, so only the framework's idioms tell them apart. Every framework's name is masked as `mystery`, and a round
 * offers one whole family of four frameworks. These rules are shared by the generator and the parser.
 */

export const frameworkCandidateId = (id: string): string =>
  MEMBER_ID.test(id) ? `local-experiment.framework.${id}.v1` : fail();

/**
 * A framework a framework round may offer: its family, the names code may spell it by, and the identifiers that name it
 * only when whole (`can`), all masked in every round.
 */
export type CuratedFramework = FamilyMember;

/** Whether text spells a framework (`LitElement`, `todos-jquery`), in code and prose alike. */
export const spellsFramework = spellsMember;
/** Whether code shows a framework's symbol as a whole identifier. */
export const showsFrameworkSymbol = showsMemberSymbol;
/** The deck's balance: within each family, every framework is the answer equally often. */
export const frameworkDeckRule = familyDeckRule;

/** The second hint: one idiom the pane shows, quoted as code unless it is already phrased with its own quotes. */
export const frameworkMarkerHint = (shown: string): string =>
  `Look for ${shown.includes("`") ? shown : `\`${shown}\``} in the code.`;
const MARKER_HINT = /^Look for `([^`]+)` in the code\.$|^Look for (.*`.*) in the code\.$/u;

/** The frameworks a snapshot lists, in id order, labels distinct. */
export const parseFrameworks = (value: unknown, read: (entry: unknown) => Readonly<Record<string, unknown>>): ReadonlyMap<string, CuratedFramework> =>
  parseFamilyMembers(value, read, frameworkCandidateId);

/**
 * The options are one whole family of frameworks and the answer is the one whose example the file is in; neither the
 * pane, the prompt, nor a hint spells any framework the snapshot lists, nor does the pane show one's symbol; the
 * second hint quotes an idiom the pane shows.
 */
export const validateFramework = ({ frameworks, panes, prompt, candidates, clues, correctCandidateId, source }: Readonly<{
  frameworks: ReadonlyMap<string, CuratedFramework>; panes: readonly Pane[]; prompt: string; candidates: readonly CandidateRecord[];
  clues: readonly string[]; correctCandidateId: string; source: ParsedSource;
}>): void => {
  const { answer } = familyOptions(frameworks, candidates, correctCandidateId, frameworkCandidateId);
  const code = panes[0]!.text;
  if (answer.id !== source.framework || source.excerptHash !== rawHash(code)) fail();
  for (const part of [code, prompt, ...clues]) {
    if ([...frameworks.values()].some((framework) => spellsFramework(part, framework))) fail();
  }
  if ([...frameworks.values()].some((framework) => showsFrameworkSymbol(code, framework))) fail();
  const hint = MARKER_HINT.exec(clues[1] ?? "") ?? fail();
  if (hint[1] !== undefined && !code.includes(hint[1])) fail();
};
