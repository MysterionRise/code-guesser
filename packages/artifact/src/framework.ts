import type { CandidateRecord, Pane, ParsedSource } from "./domain";
import { fail } from "./errors";
import { codeSpells } from "./name-function";
import { rawHash, text, texts } from "./validation";

/**
 * "Which framework?" (#62): a window of one TodoMVC example, the same to-do app built with a different framework in
 * each, so only the framework's idioms tell them apart. Every framework's name is masked as `mystery`, and a round
 * offers one whole family of four frameworks. These rules are shared by the generator and the parser.
 */

/** A framework's id: lower-case words joined by hyphens, such as `angularjs`. */
const FRAMEWORK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export const frameworkCandidateId = (id: string): string =>
  FRAMEWORK_ID.test(id) ? `local-experiment.framework.${id}.v1` : fail();

/**
 * A framework a framework round may offer: its family, the names code may spell it by, and the identifiers that name it
 * only when whole (`can`), all masked in every round.
 */
export interface CuratedFramework {
  readonly id: string;
  readonly label: string;
  readonly family: string;
  readonly names: readonly string[];
  readonly symbols: readonly string[];
}

/**
 * Whether text spells a framework: its label or one of its names, as an identifier or a run of an identifier's words
 * (`LitElement`, `todos-jquery`), in code and prose alike.
 */
export const spellsFramework = (value: string, framework: Readonly<{ label: string; names: readonly string[] }>): boolean =>
  [framework.label, ...framework.names].some((name) => codeSpells(value, name));

/** The second hint: one idiom the pane shows, quoted as code unless it is already phrased with its own quotes. */
export const frameworkMarkerHint = (shown: string): string =>
  `Look for ${shown.includes("`") ? shown : `\`${shown}\``} in the code.`;
const MARKER_HINT = /^Look for `([^`]+)` in the code\.$|^Look for (.*`.*) in the code\.$/u;

/** The frameworks a snapshot lists, in id order, labels and names distinct. */
export const parseFrameworks = (value: unknown, read: (entry: unknown) => Readonly<Record<string, unknown>>): ReadonlyMap<string, CuratedFramework> => {
  const frameworks = (Array.isArray(value) ? value : fail()).map((entry: unknown): CuratedFramework => {
    const framework = read(entry);
    const id = text(framework.id);
    frameworkCandidateId(id);
    const names = texts(framework.names);
    const symbols = Array.isArray(framework.symbols) ? framework.symbols.map(text) : fail();
    if (names.some((name) => !/^[A-Za-z][A-Za-z0-9]{1,31}$/u.test(name)) || symbols.some((symbol) => !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(symbol))) fail();
    return Object.freeze({ id, label: text(framework.label), family: text(framework.family), names, symbols: Object.freeze(symbols) });
  });
  if (frameworks.length === 0 || frameworks.some(({ id }, index) => index > 0 && id <= frameworks[index - 1]!.id)
    || new Set(frameworks.map(({ label }) => label)).size !== frameworks.length) fail();
  return new Map(frameworks.map((framework) => [framework.id, framework]));
};

/** Whether code shows a framework's symbol as a whole identifier. */
export const showsFrameworkSymbol = (code: string, framework: Readonly<{ symbols: readonly string[] }>): boolean =>
  (code.match(/[A-Za-z_][A-Za-z0-9_]*/gu) ?? []).some((identifier) => framework.symbols.includes(identifier));

/**
 * The options are one whole family of frameworks and the answer is the one whose example the file is in; neither the
 * pane, the prompt, nor a hint spells any framework the snapshot lists, nor does the pane show one's symbol; the
 * second hint quotes an idiom the pane shows.
 */
export const validateFramework = ({ frameworks, panes, prompt, candidates, clues, correctCandidateId, source }: Readonly<{
  frameworks: ReadonlyMap<string, CuratedFramework>; panes: readonly Pane[]; prompt: string; candidates: readonly CandidateRecord[];
  clues: readonly string[]; correctCandidateId: string; source: ParsedSource;
}>): void => {
  const options = candidates.map(({ id, label }) => {
    const framework = [...frameworks.values()].find((known) => frameworkCandidateId(known.id) === id) ?? fail();
    if (framework.label !== label) fail();
    return framework;
  });
  const family = options[0]!.family;
  const members = [...frameworks.values()].filter((framework) => framework.family === family);
  if (options.some((framework) => framework.family !== family) || members.length !== options.length) fail();
  const answer = options.find(({ id }) => frameworkCandidateId(id) === correctCandidateId) ?? fail();
  const code = panes[0]!.text;
  if (answer.id !== source.framework || source.excerptHash !== rawHash(code)) fail();
  for (const part of [code, prompt, ...clues]) {
    if ([...frameworks.values()].some((framework) => spellsFramework(part, framework))) fail();
  }
  if ([...frameworks.values()].some((framework) => showsFrameworkSymbol(code, framework))) fail();
  const hint = MARKER_HINT.exec(clues[1] ?? "") ?? fail();
  if (hint[1] !== undefined && !code.includes(hint[1])) fail();
};

/**
 * The deck's balance: within each family, every framework is the answer equally often, so neither an option's place,
 * its wording, nor how often it is offered points to the answer.
 */
export const frameworkDeckRule = (fixtures: readonly Readonly<{ candidates: readonly CandidateRecord[]; correctCandidateId: string }>[]): void => {
  const families = new Map<string, Map<string, number>>();
  for (const { candidates, correctCandidateId } of fixtures) {
    const key = candidates.map(({ id }) => id).sort().join("|");
    const answered = families.get(key) ?? new Map(candidates.map(({ id }) => [id, 0]));
    answered.set(correctCandidateId, answered.get(correctCandidateId)! + 1);
    families.set(key, answered);
  }
  for (const answered of families.values()) {
    if (new Set(answered.values()).size !== 1) fail();
  }
};
