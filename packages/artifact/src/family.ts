import type { CandidateRecord } from "./domain";
import { fail } from "./errors";
import { codeSpells } from "./name-function";
import { text, texts } from "./validation";

/**
 * Decks that offer one whole family of four per round, each member the answer equally often across the family's
 * rounds: "Which framework?" (#62) and "Which exercise?" (#58). The snapshot lists every member, and these rules are
 * shared by the generator and the parser.
 */

/** A member's id: lower-case words joined by hyphens, such as `angularjs` or `two-fer`. */
export const MEMBER_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

/**
 * One option of a family deck: its family, the names code may spell it by, and the identifiers that name it only
 * when whole (`can`), all masked in its rounds.
 */
export interface FamilyMember {
  readonly id: string;
  readonly label: string;
  readonly family: string;
  readonly names: readonly string[];
  readonly symbols: readonly string[];
}

/**
 * Whether text spells a member: its label or one of its names, as an identifier or a run of an identifier's words
 * (`LitElement`, `todos-jquery`, `TwoFer`), in code and prose alike.
 */
export const spellsMember = (value: string, member: Readonly<{ label: string; names: readonly string[] }>): boolean =>
  [member.label, ...member.names].some((name) => codeSpells(value, name));

/** Whether code shows a member's symbol as a whole identifier. */
export const showsMemberSymbol = (code: string, member: Readonly<{ symbols: readonly string[] }>): boolean =>
  (code.match(/[A-Za-z_][A-Za-z0-9_]*/gu) ?? []).some((identifier) => member.symbols.includes(identifier));

/** The members a snapshot lists, in id order, labels distinct; `candidateId` refuses an id its deck cannot offer. */
export const parseFamilyMembers = (
  value: unknown,
  read: (entry: unknown) => Readonly<Record<string, unknown>>,
  candidateId: (id: string) => string,
): ReadonlyMap<string, FamilyMember> => {
  const members = (Array.isArray(value) ? value : fail()).map((entry: unknown): FamilyMember => {
    const member = read(entry);
    const id = text(member.id);
    candidateId(id);
    const names = texts(member.names);
    const symbols = Array.isArray(member.symbols) ? member.symbols.map(text) : fail();
    if (names.some((name) => !/^[A-Za-z][A-Za-z0-9]{1,31}$/u.test(name)) || symbols.some((symbol) => !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(symbol))) fail();
    return Object.freeze({ id, label: text(member.label), family: text(member.family), names, symbols: Object.freeze(symbols) });
  });
  if (members.length === 0 || members.some(({ id }, index) => index > 0 && id <= members[index - 1]!.id)
    || new Set(members.map(({ label }) => label)).size !== members.length) fail();
  return new Map(members.map((member) => [member.id, member]));
};

/** The options are one whole family the snapshot lists, each under its own id; returns the options and the answer. */
export const familyOptions = (
  members: ReadonlyMap<string, FamilyMember>,
  candidates: readonly CandidateRecord[],
  correctCandidateId: string,
  candidateId: (id: string) => string,
): Readonly<{ options: readonly FamilyMember[]; answer: FamilyMember }> => {
  const options = candidates.map(({ id, label }) => {
    const member = [...members.values()].find((known) => candidateId(known.id) === id) ?? fail();
    if (member.label !== label) fail();
    return member;
  });
  const family = options[0]!.family;
  const all = [...members.values()].filter((member) => member.family === family);
  if (options.some((member) => member.family !== family) || all.length !== options.length) fail();
  const answer = options.find(({ id }) => candidateId(id) === correctCandidateId) ?? fail();
  return Object.freeze({ options: Object.freeze(options), answer });
};

/**
 * A family deck's balance: within each family, every member is the answer equally often, so neither an option's place,
 * its wording, nor how often it is offered points to the answer.
 */
export const familyDeckRule = (fixtures: readonly Readonly<{ candidates: readonly CandidateRecord[]; correctCandidateId: string }>[]): void => {
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
