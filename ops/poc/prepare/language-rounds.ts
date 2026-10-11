import { canonicalHash } from "./canonical";
import { deepFreeze, validUtcTimestamp } from "./model-validation";
import { languageCandidateId, type ExperimentFixture } from "./model";
import { STACK_LANGUAGES, mentionsExtension, mentionsLabel, type CrawlProfile, type StackLanguage } from "./profile";
import { attributionFor, fill, orderedPool, roundIdFor, sha256, shuffled, sourceRecord, type GeneratedRounds } from "./round-helpers";
import type { RevalidatedStackCandidate } from "./stack-revalidation";

type Candidate = RevalidatedStackCandidate & Readonly<Record<string, unknown>>;
type ClassifiedCandidate = Readonly<{ candidate: Candidate; language: StackLanguage }>;

export class LanguageRoundsError extends Error {
  public constructor() {
    super("LANGUAGE_ROUNDS_REJECTED");
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
  if (STACK_LANGUAGES.some((label) => mentionsLabel(excerpt, label))) fail();
  if (profile.stack.configurations.some(({ extensions }) => extensions.some((extension) => mentionsExtension(excerpt, extension)))) fail();
};

const classify = (profile: CrawlProfile, candidate: RevalidatedStackCandidate): ClassifiedCandidate => {
  const value = candidate as Candidate;
  exactStackBindings(profile, value);
  const language = languageFor(profile, value);
  rejectStackSpoilers(profile, value);
  return Object.freeze({ candidate: value, language });
};

export const validateLanguageCandidate = (options: Readonly<{
  profile: CrawlProfile;
  candidate: RevalidatedStackCandidate;
}>): RevalidatedStackCandidate => classify(options.profile, options.candidate).candidate;

/** Syntax typical of each language, most telling first; a hint names the first one the excerpt contains. */
const SYNTAX: Readonly<Record<StackLanguage, readonly string[]>> = Object.freeze({
  Python: ["elif", "self.", "lambda", "def ", "None", "await "],
  TypeScript: ["interface ", "readonly ", ": string", ": number", "=> ", "export ", "const "],
  Go: [":=", "err != nil", "func ", "chan ", "defer ", "struct {"],
  Rust: ["let mut ", "&self", "fn ", "impl ", "Option<", "::", "match "],
  Ruby: ["elsif", "do |", "attr_", "def ", "nil", "end"],
});
const UNTELLING_SYNTAX = "the way names are declared";

const blockStyle = (excerpt: string): Readonly<{ clue: string; braces: boolean }> => {
  const lines = excerpt.split("\n");
  if (lines.some((line, index) => /:\s*(?:#.*)?$/u.test(line) && /^\s+\S/u.test(lines[index + 1] ?? "")
    && (lines[index + 1]!.length - lines[index + 1]!.trimStart().length) > (line.length - line.trimStart().length))) {
    return { clue: "Blocks open with a colon and are set by indentation.", braces: false };
  }
  if (lines.some((line) => line.trim() === "end")) return { clue: "Blocks close with a line that says end.", braces: false };
  if (excerpt.includes("{")) return { clue: "Blocks are wrapped in braces.", braces: true };
  return { clue: "Look at how each block starts and ends.", braces: false };
};

/** Two answer-free hints drawn from this excerpt: its block structure, then a piece of telling syntax. */
const cluesFor = (profile: CrawlProfile, excerpt: string, language: StackLanguage) => {
  const block = blockStyle(excerpt);
  const found = SYNTAX[language].find((syntax) => excerpt.includes(syntax));
  const syntax = found === undefined ? UNTELLING_SYNTAX : `\`${found.trim()}\``;
  const clues = [block.clue, fill(profile.templates.language.syntaxClue, { syntax })];
  if (clues.some((clue) => STACK_LANGUAGES.some((label) => mentionsLabel(clue, label)))) fail();
  return Object.freeze({ clues: Object.freeze(clues), syntax: found?.trim(), braces: block.braces });
};

const BRACE_LANGUAGES = new Set<StackLanguage>(["TypeScript", "Go", "Rust"]);
const HASH_COMMENT_LANGUAGES = new Set<StackLanguage>(["Python", "Ruby"]);

/** What the reveal teaches: the syntax that settles it, and a feature the excerpt shares with a wrong option. */
const signalsFor = (excerpt: string, language: StackLanguage, options: readonly StackLanguage[], hints: ReturnType<typeof cluesFor>) => {
  const helpful = hints.syntax === undefined
    ? [`The file's extension and The Stack v2 both record ${language}.`]
    : [`\`${hints.syntax}\` is typical ${language} syntax.`];
  const others = options.filter((option) => option !== language);
  const brace = others.find((option) => BRACE_LANGUAGES.has(option));
  const hash = others.find((option) => HASH_COMMENT_LANGUAGES.has(option));
  const misleading = hints.braces && brace !== undefined
    ? `${brace} wraps blocks in braces too.`
    : /^\s*#/mu.test(excerpt) && hash !== undefined
      ? `${hash} starts comments with # too.`
      : "A short excerpt can read like several languages.";
  return Object.freeze({ helpful: Object.freeze(helpful), misleading: Object.freeze([misleading]) });
};

/**
 * Each round offers its answer and three of the other four languages the deck can hold, so the options never
 * name the answer. The language each round leaves out follows a balanced design: the languages are put in a
 * private order (keyed by blob identities no player sees), and a language's r-th round leaves out the language
 * r + 1 places further along. Rounds that share an answer leave out different languages, and every language is
 * left out equally often, so neither an option set nor how often an option appears points to the answer.
 */
const optionSets = (classified: readonly ClassifiedCandidate[]): ReadonlyMap<ClassifiedCandidate, readonly StackLanguage[]> => {
  const seed = sha256(classified.map(({ candidate }) => String(candidate.blob)).sort().join("|"));
  const order = [...STACK_LANGUAGES].sort((left, right) => sha256(`${seed}:${left}`) < sha256(`${seed}:${right}`) ? -1 : 1);
  const sets = new Map<ClassifiedCandidate, readonly StackLanguage[]>();
  for (const language of STACK_LANGUAGES) {
    const position = order.indexOf(language);
    const rounds = classified.filter((entry) => entry.language === language)
      .sort((left, right) => sha256(String(left.candidate.blob)) < sha256(String(right.candidate.blob)) ? -1 : 1);
    rounds.forEach((entry, index) => {
      const excluded = order[(position + (index % (order.length - 1)) + 1) % order.length]!;
      sets.set(entry, Object.freeze(STACK_LANGUAGES.filter((option) => option !== excluded)));
    });
  }
  return sets;
};

const fixtureFor = (classified: ClassifiedCandidate, options: readonly StackLanguage[], profile: CrawlProfile): ExperimentFixture => {
  const { candidate, language } = classified;
  const template = profile.templates.language;
  const source = deepFreeze(sourceRecord(candidate, ["excerpt"]));
  const roundId = roundIdFor("language", source);
  const candidates = shuffled(roundId, options, (label) => label)
    .map((label) => Object.freeze({ id: languageCandidateId(label), label, detail: null }));
  const panes = Object.freeze([Object.freeze({ label: null, text: candidate.excerpt })]);
  const hints = cluesFor(profile, candidate.excerpt, language);
  const signals = signalsFor(candidate.excerpt, language, options, hints);
  return Object.freeze({
    kind: "LANGUAGE",
    roundId,
    roundVersion: canonicalHash({ source, panes, candidates, clues: hints.clues, prompt: template.prompt }),
    panes,
    prompt: template.prompt,
    candidates: Object.freeze(candidates),
    clues: hints.clues,
    correctCandidateId: languageCandidateId(language),
    evidence: fill(template.evidence, { path: String(candidate.path), language }),
    explanation: template.explanation,
    attribution: attributionFor(source),
    helpfulSignals: signals.helpful,
    misleadingSignals: signals.misleading,
    source,
  });
};

export const generateLanguageRounds = (options: LanguageRoundsOptions): GeneratedRounds => {
  const { profile } = options;
  if (options.candidates.length !== profile.selection.languagePool) fail();
  const classified = options.candidates.map((candidate) => classify(profile, candidate));
  if (new Set(classified.map(({ candidate }) => candidate.crawlSnapshotId)).size !== 1) fail();
  for (const key of profile.deduplication) {
    const values = classified.map(({ candidate }) => text(candidate[key]));
    if (new Set(values).size !== values.length) fail();
  }
  const sets = optionSets(classified);
  return orderedPool(classified.map((entry) => fixtureFor(entry, sets.get(entry)!, profile)));
};
