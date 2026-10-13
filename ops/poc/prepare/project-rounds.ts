import { canonicalHash } from "./canonical";
import type { GitHubAdmissionCandidate } from "./github-admission";
import { PROJECT_SOURCE_KEYS, type ExperimentFixture } from "./model";
import type { CrawlProfile } from "./profile";
import {
  attributionFor,
  fill,
  generatedDeck,
  sha256,
  shuffled,
  type GeneratedRounds,
} from "./round-projection";

export class ProjectRoundsError extends Error {
  public constructor() {
    super("PROJECT_ROUNDS_REJECTED");
    this.name = "ProjectRoundsError";
  }
}

export interface ProjectRoundsOptions {
  readonly profile: CrawlProfile;
  readonly candidates: readonly GitHubAdmissionCandidate[];
  /** Repositories returned by the run's `ordinary` queries, in discovery order. */
  readonly distractorPool: readonly string[];
}

const fail = (): never => { throw new ProjectRoundsError(); };
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/** Case-insensitive whole-word mention of a repository's owner or name, or the full `owner/name`. */
export const mentionsRepository = (haystack: string, repository: string): boolean => {
  const [owner, name] = repository.split("/") as [string, string];
  return [repository, owner, name].some((value) =>
    new RegExp(`(^|[^A-Za-z0-9_])${escape(value)}([^A-Za-z0-9_]|$)`, "iu").test(haystack));
};

const extensionOf = (path: string): string => {
  const base = path.split("/").at(-1) ?? fail();
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) fail();
  return base.slice(dot);
};

export const projectCandidateId = (repository: string): string =>
  `local-experiment.project.${sha256(repository).slice(0, 16)}.v2`;

/**
 * FR-032: an excerpt is usable for a project round only when it mentions none of the round's
 * candidates. The answer's own owner and name are checked first by the orchestrator.
 */
export const projectExcerptAllowed = (excerpt: string, repository: string): boolean =>
  !mentionsRepository(excerpt, repository);

const distractorsFor = (
  roundId: string,
  answer: string,
  excerpt: string,
  pool: readonly string[],
  count: number,
): readonly string[] => {
  const eligible = [...new Set(pool)].filter((repository) =>
    repository !== answer && REPOSITORY.test(repository) && !mentionsRepository(excerpt, repository));
  const chosen = shuffled(roundId, eligible, (repository) => repository).slice(0, count);
  if (chosen.length !== count) fail();
  return chosen;
};

const fixtureFor = (
  candidate: GitHubAdmissionCandidate,
  profile: CrawlProfile,
  pool: readonly string[],
): ExperimentFixture => {
  if (candidate.admissionDecision !== "AUTOMATED_POC_ADMISSION_ONLY") fail();
  const source = candidate.source as unknown as Readonly<Record<string, unknown>>;
  const keys = Object.keys(source).sort();
  if (keys.join("|") !== [...PROJECT_SOURCE_KEYS].sort().join("|")) fail();
  const repository = String(source.repository);
  const excerpt = candidate.lineage.excerpt;
  if (!REPOSITORY.test(repository) || sha256(excerpt) !== source.excerptHash) fail();
  if (!projectExcerptAllowed(excerpt, repository)) fail();
  const query = profile.github.queries.find(({ id }) => id === source.queryId) ?? fail();
  if (query.role !== "ordinary") fail();
  const template = profile.templates.project;
  const roundId = `local-project-${canonicalHash({
    kind: "project", repository, commit: source.commit, path: source.path, blob: source.blob,
  }).slice(0, 24)}`;
  const distractors = distractorsFor(roundId, repository, excerpt, pool, profile.selection.projectCandidates - 1);
  const candidates = shuffled(roundId, [repository, ...distractors], (value) => value)
    .map((label) => Object.freeze({ id: projectCandidateId(label), label }));
  const owner = repository.split("/")[0]!;
  const extensionClue = fill(template.extensionClue, { extension: extensionOf(String(source.path)) });
  const ownerClue = fill(template.ownerClue, { owner });
  if ([template.prompt, extensionClue].some((value) =>
    candidates.some(({ label }) => mentionsRepository(value, label)))) fail();
  const evidence = fill(template.evidence, { repository });
  const roundVersion = canonicalHash({ source, excerpt, template, candidates });
  return Object.freeze({
    kind: "PROJECT",
    roundId,
    roundVersion,
    excerpt,
    prompt: template.prompt,
    candidates: Object.freeze(candidates),
    clues: Object.freeze([extensionClue, ownerClue]),
    correctCandidateId: projectCandidateId(repository),
    evidence,
    explanation: template.explanation,
    attribution: attributionFor(source),
    helpfulSignals: Object.freeze([ownerClue]),
    misleadingSignals: Object.freeze([extensionClue]),
    source,
  });
};

export const generateProjectRounds = (options: ProjectRoundsOptions): GeneratedRounds => {
  if (options.candidates.length !== options.profile.selection.projectRounds) fail();
  const repositories = options.candidates.map(({ source }) => source.repository);
  if (new Set(repositories).size !== repositories.length) fail();
  const fixtures = options.candidates.map((candidate) => fixtureFor(candidate, options.profile, options.distractorPool));
  return generatedDeck(fixtures, options.profile, { deck: "project", candidates: options.profile.selection.projectCandidates });
};
