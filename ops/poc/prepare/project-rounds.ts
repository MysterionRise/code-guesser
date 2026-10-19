import { canonicalHash } from "./canonical";
import { exactStackBindings } from "./language-rounds";
import { deepFreeze } from "./model-validation";
import { namesRepository, profileAtLeast, projectCandidateId, sharedOptionWords, type ExperimentFixture } from "./model";
import { poolSizes, type CrawlProfile } from "./profile";
import { approximately, attributionFor, fill, orderedPool, roundIdFor, shuffled, sourceRecord, type GeneratedRounds } from "./round-helpers";
import type { RevalidatedStackCandidate } from "./stack-revalidation";

export class ProjectRoundsError extends Error {
  public constructor(code = "PROJECT_ROUNDS_REJECTED") {
    super(code);
    this.name = "ProjectRoundsError";
  }
}

/** A repository offered as an option, with its public description when it has one. */
export interface RepositoryOption {
  readonly repository: string;
  readonly description: string | null;
}

/** One project round: a file from a popular repository, that repository's description, and three distractors. */
export interface ProjectRoundInput {
  readonly candidate: RevalidatedStackCandidate;
  readonly description: string | null;
  readonly distractors: readonly RepositoryOption[];
}

export interface ProjectRoundsOptions {
  readonly profile: CrawlProfile;
  readonly rounds: readonly ProjectRoundInput[];
}

const fail = (code?: string): never => { throw new ProjectRoundsError(code); };
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const DISTRACTORS = 3;
const MAXIMUM_DETAIL_LENGTH = 160;

/** A description as a candidate shows it: one line, trimmed, and short. */
export const optionDetail = (description: string | null): string | null => {
  if (description === null) return null;
  const line = description.replace(/\s+/gu, " ").trim();
  if (line.length === 0) return null;
  return line.length <= MAXIMUM_DETAIL_LENGTH ? line : `${line.slice(0, MAXIMUM_DETAIL_LENGTH - 1).trimEnd()}…`;
};

const fileName = (path: string): string => path.split("/").at(-1) ?? fail();

/**
 * Whether the deck's own wording names a repository: its prompt and hint templates, placeholders left out.
 * The popularity hint says "GitHub star events", so a repository owned by `github` could never be offered.
 */
export const namedByTemplates = (profile: CrawlProfile, repository: string): boolean => {
  const { prompt, fileClue, popularityClue } = profile.templates.project;
  return namesRepository([prompt, fileClue, popularityClue].join("\n").replace(/\{[a-z]+\}/gu, " "), repository);
};

/**
 * A project round may be offered with these options only when neither its code nor its file name names any
 * of them; the selection stage checks this before it spends a request on a distractor.
 */
export const projectRoundAllowed = (excerpt: string, path: string, repositories: readonly string[]): boolean =>
  // A file at the repository root would make its name, the first hint, its whole protected path.
  path.includes("/") && repositories.every((repository) => !namesRepository(excerpt, repository) && !namesRepository(fileName(path), repository));

const fixtureFor = (input: ProjectRoundInput, profile: CrawlProfile): ExperimentFixture => {
  const candidate = input.candidate as RevalidatedStackCandidate & Readonly<Record<string, unknown>>;
  exactStackBindings(profile, candidate);
  const repository = String(candidate.repository);
  const path = String(candidate.path);
  const options = [{ repository, description: input.description }, ...input.distractors];
  if (input.distractors.length !== DISTRACTORS || options.some((option) => !REPOSITORY.test(option.repository))
    || new Set(options.map((option) => option.repository.toLocaleLowerCase("en-US"))).size !== options.length
    || !projectRoundAllowed(candidate.excerpt, path, options.map((option) => option.repository))
    || options.some((option) => namedByTemplates(profile, option.repository))) fail();
  const template = profile.templates.project;
  const source = deepFreeze(sourceRecord(candidate, ["excerpt"]));
  const roundId = roundIdFor("project", source);
  const candidates = shuffled(roundId, options, (option) => option.repository).map((option) => Object.freeze({
    id: projectCandidateId(option.repository), label: option.repository, detail: optionDetail(option.description),
  }));
  // From v6 on, the code shares no distinctive word with any option as shown, its description included (#77).
  if (profileAtLeast(profile.profileVersion, "local-real-rounds.v6")
    && candidates.some(({ label, detail }) => sharedOptionWords(candidate.excerpt, label, detail).length > 0)) fail("PROJECT_WORDS_SHOWN");
  const panes = Object.freeze([Object.freeze({ label: null, text: candidate.excerpt })]);
  const clues = Object.freeze([
    fill(template.fileClue, { file: fileName(path) }),
    fill(template.popularityClue, { stars: approximately(Number(candidate.starEventsCount)) }),
  ]);
  const language = String(candidate.configuration);
  return Object.freeze({
    kind: "PROJECT",
    roundId,
    roundVersion: canonicalHash({ source, panes, candidates, clues, prompt: template.prompt }),
    panes,
    prompt: template.prompt,
    candidates: Object.freeze(candidates),
    clues,
    correctCandidateId: projectCandidateId(repository),
    evidence: fill(template.evidence, { path, repository }),
    explanation: template.explanation,
    attribution: attributionFor(source),
    helpfulSignals: Object.freeze([`The folders on the way to ${fileName(path)} show where ${repository} keeps this code.`]),
    misleadingSignals: Object.freeze([`All four options are popular ${language} projects.`]),
    source,
  });
};

export const generateProjectRounds = (options: ProjectRoundsOptions): GeneratedRounds => {
  const { profile } = options;
  if (options.rounds.length !== poolSizes(profile).project) fail();
  const fixtures = options.rounds.map((round) => fixtureFor(round, profile));
  if (new Set(fixtures.map(({ source }) => source.crawlSnapshotId)).size !== 1) fail();
  for (const key of profile.deduplication) {
    const values = fixtures.map(({ source }) => String(source[key]));
    if (new Set(values).size !== values.length) fail();
  }
  return orderedPool(fixtures);
};
