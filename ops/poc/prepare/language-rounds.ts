import { canonicalHash } from "./canonical";
import { deepFreeze, validUtcTimestamp } from "./model-validation";
import { languageCandidateId, type ExperimentFixture } from "./model";
import { LANGUAGE_PAIRS, RARE_LANGUAGES } from "../../../packages/artifact/src/index";
import { firstMarker, markerSignals, tellsApart } from "./language-markers";
import { STACK_LANGUAGES, mentionsExtension, mentionsLabel, poolSizes, type CrawlProfile, type StackLanguage } from "./profile";
import { attributionFor, fill, orderedPool, roundIdFor, sha256, shuffled, sourceRecord, type GeneratedRounds } from "./round-helpers";
import type { RevalidatedStackCandidate } from "./stack-revalidation";

type Candidate = RevalidatedStackCandidate & Readonly<Record<string, unknown>>;
type ClassifiedCandidate = Readonly<{ candidate: Candidate; language: StackLanguage }>;

export class LanguageRoundsError extends Error {
  public constructor(code = "LANGUAGE_ROUNDS_REJECTED") {
    super(code);
    this.name = "LanguageRoundsError";
  }
}

export interface LanguageRoundsOptions {
  readonly profile: CrawlProfile;
  readonly candidates: readonly RevalidatedStackCandidate[];
}

export const STACK_CANDIDATE_KEYS = [
  "discoverySource", "repository", "repositoryUrl", "authorName", "authorLogin",
  "authorBasis", "authorSourceUrl", "path", "blob", "rawContentHash", "excerptHash",
  "licenseName", "licenseSpdx", "licenseFileUrl", "commit", "commitUrl", "blobUrl",
  "profileVersion", "crawlSnapshotId", "excerpt", "stackRelease", "stackRevision",
  "configuration", "stableRowId", "swhBlobId", "swhContentId", "swhDirectoryId",
  "swhSnapshotId", "swhRevisionId", "stackRepository", "stackPath", "detectedLicenses",
  "detectedLanguage", "generated", "vendor", "sourceEncoding", "byteLength", "visitDate",
  "revisionDate", "committerDate", "starEventsCount", "forkEventsCount",
] as const;
const fail = (): never => { throw new LanguageRoundsError(); };
const text = (value: unknown): string =>
  typeof value === "string" && value.trim() === value && value.length > 0 ? value : fail();
const codeText = (value: unknown): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fail();
const gitId = (value: unknown): string => /^[0-9a-f]{40}$/u.test(text(value)) ? value as string : fail();
const sha256Id = (value: unknown): string => /^[0-9a-f]{64}$/u.test(text(value)) ? value as string : fail();
const encodedPath = (value: string): string => value.split("/").map(encodeURIComponent).join("/");

const exactShape = (candidate: Candidate): void => {
  const actual = Object.keys(candidate).sort();
  const expected = [...STACK_CANDIDATE_KEYS].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail();
};

const languageFor = (profile: CrawlProfile, candidate: Candidate): StackLanguage => {
  const language = candidate.configuration;
  if (!(STACK_LANGUAGES as readonly unknown[]).includes(language) || candidate.detectedLanguage !== language) fail();
  const configured = profile.stack.configurations.find(({ configuration }) => configuration === language) ?? fail();
  const path = text(candidate.path);
  const matching = profile.stack.configurations.flatMap(({ extensions }) =>
    extensions.filter((extension) => path.endsWith(extension)));
  if (matching.length !== 1 || !configured.extensions.includes(matching[0]!)) fail();
  return language as StackLanguage;
};

/** The revalidated candidate is exactly the shape revalidation produces, bound to this run's snapshot. */
export const exactStackBindings = (profile: CrawlProfile, candidate: Candidate): void => {
  exactShape(candidate);
  if (candidate.discoverySource !== "STACK_V2" || candidate.authorBasis !== "SELECTED_COMMIT"
    || candidate.stackRelease !== profile.stack.release || candidate.stackRevision !== profile.stack.revision
    || candidate.profileVersion !== profile.profileVersion || candidate.generated !== false
    || candidate.vendor !== false || candidate.sourceEncoding !== "UTF-8") fail();
  const repository = text(candidate.repository);
  const path = text(candidate.path);
  const commit = gitId(candidate.commit);
  const blob = gitId(candidate.blob);
  const root = `https://github.com/${repository}`;
  if (candidate.repositoryUrl !== root || candidate.stackRepository !== repository
    || candidate.stackPath !== path || candidate.swhRevisionId !== commit
    || candidate.swhContentId !== blob || candidate.commitUrl !== `${root}/commit/${commit}`
    || candidate.authorSourceUrl !== candidate.commitUrl
    || candidate.blobUrl !== `${root}/blob/${commit}/${encodedPath(path)}`
    || !text(candidate.licenseFileUrl).startsWith(`${root}/blob/${commit}/`)) fail();
  for (const value of [candidate.swhBlobId, candidate.swhDirectoryId, candidate.swhSnapshotId]) gitId(value);
  for (const value of [candidate.rawContentHash, candidate.crawlSnapshotId, candidate.stableRowId]) sha256Id(value);
  const excerpt = codeText(candidate.excerpt);
  const excerptBytes = Buffer.byteLength(excerpt);
  if (sha256Id(candidate.excerptHash) !== sha256(excerpt)
    || !Number.isSafeInteger(candidate.byteLength) || (candidate.byteLength as number) < excerptBytes
    || excerptBytes < profile.screening.minimumExcerptBytes || excerptBytes > profile.screening.excerptBytes
    || excerpt.split("\n").length > profile.screening.excerptLines) fail();
  for (const count of [candidate.starEventsCount, candidate.forkEventsCount]) {
    if (!Number.isSafeInteger(count) || (count as number) < 0) fail();
  }
  text(candidate.authorName);
  if (candidate.authorLogin !== null) text(candidate.authorLogin);
  const licenses = Array.isArray(candidate.detectedLicenses) ? candidate.detectedLicenses.map(text) : fail();
  if (licenses.length === 0 || new Set(licenses).size !== licenses.length
    || !licenses.includes(text(candidate.licenseSpdx)) || !profile.licenses.includes(candidate.licenseSpdx as string)) fail();
  text(candidate.licenseName);
  for (const value of [candidate.visitDate, candidate.revisionDate, candidate.committerDate]) {
    if (!validUtcTimestamp(value)) fail();
  }
};

const containsWord = (haystack: string, needle: string): boolean => {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_])${escaped}([^A-Za-z0-9_]|$)`, "iu").test(haystack);
};

/** How the rarer languages' names are spelled in code: their own name, and the ASCII forms of F#. */
const RARE_SPELLINGS: Readonly<Partial<Record<StackLanguage, readonly string[]>>> = Object.freeze(Object.fromEntries(
  [...RARE_LANGUAGES].map((language) => [language, language === "F#" ? ["F#", "fsharp"] : [language]])));
const spelledIn = (text: string, word: string): boolean =>
  new RegExp(`(?<![A-Za-z0-9_])${word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![A-Za-z0-9_])`, "iu").test(text);

/** No option's name, no extension, and no source identity may appear in the code a language round shows. */
export const rejectStackSpoilers = (profile: CrawlProfile, candidate: Candidate): void => {
  const excerpt = codeText(candidate.excerpt);
  const structuralValues = [
    candidate.repository, candidate.repositoryUrl, candidate.authorSourceUrl, candidate.path,
    candidate.commit, candidate.commitUrl, candidate.blob, candidate.blobUrl,
    candidate.licenseFileUrl, candidate.stableRowId,
    candidate.swhBlobId, candidate.swhContentId, candidate.swhDirectoryId,
    candidate.swhSnapshotId, candidate.swhRevisionId,
  ].filter((value): value is string => typeof value === "string" && value.length > 0);
  const lowered = excerpt.toLocaleLowerCase("en-US");
  if (structuralValues.some((value) => lowered.includes(value.toLocaleLowerCase("en-US")))) fail();
  const protectedWords = [candidate.authorName, candidate.authorLogin, candidate.licenseName, candidate.licenseSpdx]
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  if (protectedWords.some((value) => containsWord(excerpt, value))) fail();
  // The configured languages are the options; a name the profile doesn't read (`Julia` in a Python string) isn't one.
  if (profile.stack.configurations.some(({ language }) => mentionsLabel(excerpt, language))) fail();
  // A rarer language's name in any case (`clojure.core`, `elixir`) gives it away too; the first twelve keep the check above.
  if (profile.stack.configurations.some(({ language }) => RARE_LANGUAGES.has(language)
    && RARE_SPELLINGS[language]!.some((spelling) => spelledIn(excerpt, spelling)))) fail();
  if (profile.stack.configurations.some(({ extensions }) => extensions.some((extension) => mentionsExtension(excerpt, extension)))) fail();
};

const classify = (profile: CrawlProfile, candidate: RevalidatedStackCandidate): ClassifiedCandidate => {
  const value = candidate as Candidate;
  exactStackBindings(profile, value);
  const language = languageFor(profile, value);
  rejectStackSpoilers(profile, value);
  // Every round offers the look-alike too, so the code must show what sets its language apart.
  if (!tellsApart(value.excerpt, language)) throw new LanguageRoundsError("LANGUAGE_PAIR_AMBIGUOUS");
  return Object.freeze({ candidate: value, language });
};

export const validateLanguageCandidate = (options: Readonly<{
  profile: CrawlProfile;
  candidate: RevalidatedStackCandidate;
}>): RevalidatedStackCandidate => classify(options.profile, options.candidate).candidate;

/**
 * How the excerpt's blocks are built, checked in the style its language uses: a C++ `public:` label ends in a
 * colon before an indented line, yet its blocks are braces. Code whose own style does not show gets a neutral hint.
 */
const endsWithEnd = (lines: readonly string[]): string | undefined =>
  lines.some((line) => line.trim() === "end") ? "Blocks close with a line that says end." : undefined;
/**
 * The rarer languages' block styles (v1.0). Each pair shares its style, so the first hint narrows to the answer's pair
 * without settling it; maps in braces (`%{}`, `#{}`, `{:a 1}`) never read as braced blocks.
 */
const RARE_BLOCK_STYLES: Readonly<Partial<Record<StackLanguage, (lines: readonly string[]) => string | undefined>>> = Object.freeze({
  Haskell: () => "Blocks are set by indentation, not braces.",
  Elm: () => "Blocks are set by indentation, not braces.",
  Clojure: () => "Every form is wrapped in parentheses.",
  Racket: () => "Every form is wrapped in parentheses.",
  Erlang: (lines: readonly string[]) => lines.some((line) => /\.\s*$/u.test(line)) ? "Clauses end with a full stop." : undefined,
  Prolog: (lines: readonly string[]) => lines.some((line) => /\.\s*$/u.test(line)) ? "Clauses end with a full stop." : undefined,
  Julia: endsWithEnd, MATLAB: endsWithEnd, Elixir: endsWithEnd, Crystal: endsWithEnd,
  Ada: (lines: readonly string[]) => lines.some((line) => /^\s*end\b[^;]*;/iu.test(line)) ? "Blocks close with end and a semicolon." : undefined,
  Pascal: (lines: readonly string[]) => lines.some((line) => /^\s*end\b[^;]*;/iu.test(line)) ? "Blocks close with end and a semicolon." : undefined,
});

const blockStyle = (excerpt: string, language: StackLanguage): string => {
  const lines = excerpt.split("\n");
  if (language === "Python") {
    return lines.some((line, index) => /:\s*(?:#.*)?$/u.test(line) && /^\s+\S/u.test(lines[index + 1] ?? "")
      && (lines[index + 1]!.length - lines[index + 1]!.trimStart().length) > (line.length - line.trimStart().length))
      ? "Blocks open with a colon and are set by indentation." : "Look at how each block starts and ends.";
  }
  if (language === "Ruby") {
    return lines.some((line) => line.trim() === "end") ? "Blocks close with a line that says end." : "Look at how each block starts and ends.";
  }
  const rare = RARE_BLOCK_STYLES[language];
  if (rare !== undefined) return rare(lines) ?? "Look at how each block starts and ends.";
  return excerpt.includes("{") ? "Blocks are wrapped in braces." : "Look at how each block starts and ends.";
};

/** Two answer-free hints drawn from this excerpt: its block structure, then the syntax that sets it apart. */
const cluesFor = (profile: CrawlProfile, excerpt: string, language: StackLanguage): readonly string[] => {
  const found = firstMarker(excerpt, language) ?? fail();
  const syntax = found.shown.includes("`") ? found.shown : `\`${found.shown}\``;
  const clues = [blockStyle(excerpt, language), fill(profile.templates.language.syntaxClue, { syntax })];
  if (clues.some((clue) => profile.stack.configurations.some(({ language: label }) => mentionsLabel(clue, label)))) fail();
  return Object.freeze(clues);
};

/**
 * Each round offers two look-alike pairs: its answer's pair and one more (#81). A pair's four rounds (two languages,
 * two rounds each) take four different second pairs: every pair but itself and the one it skips. The pairs sit in a
 * private cycle (keyed by blob identities no player sees) and each skips the next, so the skips form a derangement
 * and every pair is also the second pair in exactly four rounds. Every language then appears in exactly eight
 * rounds, and an option set appears in at most two rounds, whose answers sit in different pairs: a remembered
 * answer rules out one option of a later round at most, where a set of four rounds used to give its last one away.
 *
 * With more pairs (v1.0) a pair takes the four after the one it skips, so six pairs keep exactly the sets above.
 * Some rarer pairs resemble another pair as a whole (Crystal and Elixir borrowed Ruby's syntax), and a round offering
 * both would be decided by a family likeness, not by reading; the cycle is searched until no pair takes a pair it
 * resembles.
 */
const SECOND_PAIR_OFFSETS = Object.freeze([2, 3, 4, 5]);
const PAIRING_ATTEMPTS = 400;
/** Pairs that read alike as families; a round offers at most one of each. */
const RESEMBLANCES: readonly (readonly [StackLanguage, StackLanguage])[] = Object.freeze([
  ["Elixir", "Python"], ["Julia", "Python"], ["Haskell", "OCaml"], ["Erlang", "Elixir"],
]);
const resembles = (pair: readonly StackLanguage[], other: readonly StackLanguage[]): boolean =>
  RESEMBLANCES.some(([left, right]) => (pair.includes(left) && other.includes(right)) || (pair.includes(right) && other.includes(left)));

const optionSets = (classified: readonly ClassifiedCandidate[], profile: CrawlProfile)
  : ReadonlyMap<ClassifiedCandidate, readonly StackLanguage[]> => {
  const seed = sha256(classified.map(({ candidate }) => String(candidate.blob)).sort().join("|"));
  const byHash = (key: (pair: readonly StackLanguage[]) => string) => (left: readonly StackLanguage[], right: readonly StackLanguage[]) =>
    sha256(key(left)) < sha256(key(right)) ? -1 : 1;
  const configured = profile.stack.configurations.map(({ language }) => language);
  const pairs = LANGUAGE_PAIRS.filter(([first]) => configured.includes(first));
  // Six pairs leave each pair exactly four others for its four rounds; fewer could not.
  if (pairs.length < 6) fail();
  for (let attempt = 0; attempt < PAIRING_ATTEMPTS; attempt += 1) {
    const salt = attempt === 0 ? seed : `${seed}:${attempt}`;
    const cycle = [...pairs].sort(byHash((pair) => `${salt}:${pair.join("|")}`));
    const seconds = cycle.map((_, position) => SECOND_PAIR_OFFSETS.map((offset) => cycle[(position + offset) % cycle.length]!));
    if (cycle.some((pair, position) => seconds[position]!.some((other) => resembles(pair, other)))) continue;
    const sets = new Map<ClassifiedCandidate, readonly StackLanguage[]>();
    cycle.forEach((pair, position) => {
      const others = [...seconds[position]!].sort(byHash((other) => `${seed}:${pair.join("|")}:${other.join("|")}`));
      const rounds = classified.filter((entry) => (pair as readonly string[]).includes(entry.language))
        .sort((left, right) => sha256(String(left.candidate.blob)) < sha256(String(right.candidate.blob)) ? -1 : 1);
      if (rounds.length !== 4 || pair.some((language) => rounds.filter((entry) => entry.language === language).length !== 2)) fail();
      rounds.forEach((round, index) => sets.set(round, Object.freeze([...pair, ...others[index]!])));
    });
    return sets;
  }
  throw new LanguageRoundsError("LANGUAGE_PAIRING_CONFLICT");
};

const fixtureFor = (classified: ClassifiedCandidate, options: readonly StackLanguage[], profile: CrawlProfile): ExperimentFixture => {
  const { candidate, language } = classified;
  const template = profile.templates.language;
  const source = deepFreeze(sourceRecord(candidate, ["excerpt"]));
  const roundId = roundIdFor("language", source);
  const candidates = shuffled(roundId, options, (label) => label)
    .map((label) => Object.freeze({ id: languageCandidateId(label), label, detail: null }));
  const panes = Object.freeze([Object.freeze({ label: null, text: candidate.excerpt })]);
  const clues = cluesFor(profile, candidate.excerpt, language);
  const signals = markerSignals(candidate.excerpt, language);
  return Object.freeze({
    kind: "LANGUAGE",
    roundId,
    roundVersion: canonicalHash({ source, panes, candidates, clues, prompt: template.prompt }),
    panes,
    prompt: template.prompt,
    candidates: Object.freeze(candidates),
    clues,
    correctCandidateId: languageCandidateId(language),
    evidence: fill(template.evidence, { path: String(candidate.path), language }),
    explanation: template.explanation,
    attribution: attributionFor(source),
    helpfulSignals: Object.freeze([signals.helpful]),
    misleadingSignals: Object.freeze([signals.misleading]),
    source,
  });
};

export const generateLanguageRounds = (options: LanguageRoundsOptions): GeneratedRounds => {
  const { profile } = options;
  if (options.candidates.length !== poolSizes(profile).language) fail();
  const classified = options.candidates.map((candidate) => classify(profile, candidate));
  if (new Set(classified.map(({ candidate }) => candidate.crawlSnapshotId)).size !== 1) fail();
  for (const key of profile.deduplication) {
    const values = classified.map(({ candidate }) => text(candidate[key]));
    if (new Set(values).size !== values.length) fail();
  }
  const sets = optionSets(classified, profile);
  return orderedPool(classified.map((entry) => fixtureFor(entry, sets.get(entry)!, profile)));
};
