import { canonicalHash } from "./canonical";
import { type ExperimentFixture } from "./model";
import { deepFreeze, validUtcTimestamp } from "./model-validation";
import {
  STACK_LANGUAGES,
  mentionsExtension,
  mentionsLabel,
  type CrawlProfile,
  type LanguageTemplate,
  type StackLanguage,
} from "./profile";
import { attributionFor, fill, generatedDeck, sha256, shuffled, type GeneratedRounds } from "./round-projection";
import type { RevalidatedStackCandidate } from "./stack-revalidation";

type Candidate = RevalidatedStackCandidate & Readonly<Record<string, unknown>>;
type ClassifiedCandidate = Readonly<{ candidate: Candidate; language: StackLanguage; template: LanguageTemplate }>;

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

export type GeneratedLanguageRounds = GeneratedRounds;

const CANDIDATE_KEYS = [
  "discoverySource", "repository", "repositoryUrl", "authorName", "authorLogin",
  "authorBasis", "authorSourceUrl", "path", "blob", "rawContentHash", "excerptHash",
  "licenseName", "licenseSpdx", "licenseFileUrl", "commit", "commitUrl", "blobUrl",
  "profileVersion", "crawlSnapshotId", "excerpt", "stackRelease", "stackRevision",
  "configuration", "stableRowId", "swhBlobId", "swhContentId", "swhDirectoryId",
  "swhSnapshotId", "swhRevisionId", "stackRepository", "stackPath", "detectedLicenses",
  "detectedLanguage", "generated", "vendor", "sourceEncoding", "byteLength", "visitDate",
  "revisionDate", "committerDate",
] as const;
const fail = (): never => { throw new LanguageRoundsError(); };
const text = (value: unknown): string =>
  typeof value === "string" && value.trim() === value && value.length > 0 ? value : fail();
const codeText = (value: unknown): string =>
  typeof value === "string" && value.trim().length > 0 ? value : fail();
const gitId = (value: unknown): string => /^[0-9a-f]{40}$/u.test(text(value)) ? value as string : fail();
const sha256Id = (value: unknown): string => /^[0-9a-f]{64}$/u.test(text(value)) ? value as string : fail();
const encodedPath = (value: string): string => value.split("/").map(encodeURIComponent).join("/");

const SLUGS: Readonly<Record<string, string>> = Object.freeze({
  Python: "python", TypeScript: "typescript", JavaScript: "javascript", Go: "go", Rust: "rust", Java: "java",
  Ruby: "ruby", "C#": "csharp", Kotlin: "kotlin", Swift: "swift", PHP: "php", "C++": "cpp",
});
export const languageCandidateId = (label: string): string =>
  `local-experiment.language.${SLUGS[label] ?? fail()}.v2`;

const exactShape = (candidate: Candidate): void => {
  const actual = Object.keys(candidate).sort();
  const expected = [...CANDIDATE_KEYS].sort();
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
  const stem = path.slice(0, -matching[0]!.length);
  if (profile.stack.configurations.some(({ extensions }) => extensions.some((extension) => stem.endsWith(extension)))) fail();
  return language as StackLanguage;
};

const exactBindings = (profile: CrawlProfile, candidate: Candidate): void => {
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
    || excerpt.split("\n").length > profile.screening.languageExcerptLines) fail();
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

/** FR-025 as replaced: no candidate label or the file's extension; FR-009/FR-023: no source identity. */
const rejectSpoilers = (profile: CrawlProfile, candidate: Candidate, template: LanguageTemplate): void => {
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
  if ([template.language, ...template.distractors].some((label) => mentionsLabel(excerpt, label))) fail();
  const configured = profile.stack.configurations.find(({ language }) => language === template.language) ?? fail();
  if (configured.extensions.some((extension) => mentionsExtension(excerpt, extension))) fail();
};

const classify = (profile: CrawlProfile, candidate: RevalidatedStackCandidate): ClassifiedCandidate => {
  const value = candidate as Candidate;
  exactBindings(profile, value);
  const language = languageFor(profile, value);
  const template = profile.templates.language.languages.find((entry) => entry.language === language) ?? fail();
  rejectSpoilers(profile, value, template);
  return Object.freeze({ candidate: value, language, template });
};

export const validateLanguageCandidate = (options: Readonly<{
  profile: CrawlProfile;
  candidate: RevalidatedStackCandidate;
}>): RevalidatedStackCandidate => classify(options.profile, options.candidate).candidate;

const fixtureFor = (classified: ClassifiedCandidate, profile: CrawlProfile): ExperimentFixture => {
  const { candidate, language, template } = classified;
  const languageTemplate = profile.templates.language;
  const sourceValue = Object.fromEntries(Object.entries(candidate).filter(([key]) => key !== "excerpt"));
  const source = deepFreeze(structuredClone(sourceValue));
  const roundId = `local-language-${canonicalHash({
    kind: "language", repository: candidate.repository, commit: candidate.commit,
    path: candidate.path, blob: candidate.blob,
  }).slice(0, 24)}`;
  const candidates = shuffled(roundId, [language, ...template.distractors], (label) => label)
    .map((label) => Object.freeze({ id: languageCandidateId(label), label }));
  const clues = Object.freeze([...template.clues]);
  const evidence = fill(languageTemplate.evidence, { language });
  return Object.freeze({
    kind: "LANGUAGE",
    roundId,
    roundVersion: canonicalHash({ source, excerpt: candidate.excerpt, template, candidates, prompt: languageTemplate.prompt }),
    excerpt: candidate.excerpt,
    prompt: languageTemplate.prompt,
    candidates: Object.freeze(candidates),
    clues,
    correctCandidateId: languageCandidateId(language),
    evidence,
    explanation: languageTemplate.explanation,
    attribution: attributionFor(source),
    helpfulSignals: Object.freeze([evidence]),
    misleadingSignals: Object.freeze([clues[0]!]),
    source,
  });
};

export const generateLanguageRounds = (options: LanguageRoundsOptions): GeneratedRounds => {
  const { profile } = options;
  if (options.candidates.length !== profile.selection.languageRounds) fail();
  const classified = options.candidates.map((candidate) => classify(profile, candidate));
  if (new Set(classified.map(({ candidate }) => candidate.crawlSnapshotId)).size !== 1) fail();
  if (new Set(classified.map(({ language }) => language)).size !== profile.selection.languageRounds) fail();
  for (const key of profile.deduplication) {
    const values = classified.map(({ candidate }) => text(candidate[key]));
    if (new Set(values).size !== values.length) fail();
  }
  const fixtures = classified.map((entry) => fixtureFor(entry, profile));
  return generatedDeck(fixtures, profile, { deck: "language", languages: STACK_LANGUAGES });
};
