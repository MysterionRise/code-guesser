import { containsProtected, text, texts, type JsonRecord } from "./validation";
import { fail } from "./errors";

/**
 * "Spot the vulnerable line" (#59): the file a reviewed GitHub advisory's fix commit changed by one line, as it stood
 * before the fix. A round offers four lines of it, as a fix round does; the truth is the line the fix replaced. These
 * rules are shared by the generator and the parser.
 */

/** The ecosystems a deck lists reviewed advisories from. Composer is left out: PHP has no source-file rule here. */
export const ADVISORY_ECOSYSTEMS = Object.freeze(["pip", "npm", "go", "maven", "rubygems", "rust"] as const);
export type AdvisoryEcosystem = typeof ADVISORY_ECOSYSTEMS[number];
/** A GitHub advisory id: `GHSA-` and three groups of four from GitHub's alphabet. */
export const GHSA_ID = /^GHSA(?:-[23456789cfghjmpqrvwx]{4}){3}$/u;
export const CWE_ID = /^CWE-[1-9][0-9]{0,4}$/u;
/** An advisory or CVE id anywhere in a text: no text shown before the answer holds one. */
const ADVISORY_ID_TEXT = /GHSA-[0-9a-z]{4}-|CVE-\d{4}-\d{4,}/iu;

/** What the snapshot records of a deck's advisories: the ecosystems listed, and each CWE a round may name with its hint. */
export interface AdvisorySnapshot {
  readonly ecosystems: ReadonlySet<string>;
  readonly cwes: ReadonlyMap<string, string>;
}

/** The first hint of a vulnerable-line round: the weakness the advisory files the flaw under, never where it is. */
export const vulnerableLineHint = (cwe: string, hint: string): string => `The advisory files it under ${cwe}: ${hint}`;

/**
 * Whether text shown before the answer gives the advisory away: an advisory or CVE id, or the package the advisory
 * was filed under, as a whole token in any case.
 */
export const namesAdvisory = (value: string, packageName: string): boolean =>
  ADVISORY_ID_TEXT.test(value) || containsProtected(value.toLocaleLowerCase("en-US"), packageName.toLocaleLowerCase("en-US"));

/** `{ ecosystems, published, cwes }`: the ecosystems in profile order, the date windows listed, and the CWE hints in id order. */
export const parseAdvisorySnapshot = (value: unknown, read: (entry: unknown, keys: readonly string[]) => JsonRecord): AdvisorySnapshot => {
  const advisories = read(value, ["ecosystems", "published", "cwes"]);
  const ecosystems = texts(advisories.ecosystems);
  if (ecosystems.length === 0 || new Set(ecosystems).size !== ecosystems.length
    || ecosystems.some((ecosystem) => !(ADVISORY_ECOSYSTEMS as readonly string[]).includes(ecosystem))) fail();
  if (texts(advisories.published).length === 0) fail();
  const cwes = (Array.isArray(advisories.cwes) ? advisories.cwes : fail()).map((entry: unknown) => {
    const cwe = read(entry, ["id", "hint"]);
    return [CWE_ID.test(text(cwe.id)) ? text(cwe.id) : fail(), text(cwe.hint)] as const;
  });
  if (cwes.length === 0 || cwes.some(([id], index) => index > 0 && Number(id.slice(4)) <= Number(cwes[index - 1]![0].slice(4)))) fail();
  return Object.freeze({ ecosystems: new Set(ecosystems), cwes: new Map(cwes) });
};
