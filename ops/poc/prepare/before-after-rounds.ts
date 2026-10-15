import { AUTHORSHIP_CLAIM } from "../../../packages/artifact/src/index";
import { canonicalHash } from "./canonical";
import type { GitHubAdmissionCandidate } from "./github-admission";
import { deepFreeze } from "./model-validation";
import { BEFORE_AFTER_CANDIDATE_IDS, LINEAGE_SOURCE_KEYS, mentionsRepository, type ExperimentFixture } from "./model";
import type { CrawlProfile } from "./profile";
import { attributionFor, fill, orderedPool, roundIdFor, sha256, type GeneratedRounds } from "./round-helpers";

export class BeforeAfterRoundsError extends Error {
  public constructor() {
    super("BEFORE_AFTER_ROUNDS_REJECTED");
    this.name = "BeforeAfterRoundsError";
  }
}

export interface BeforeAfterRoundsOptions {
  readonly profile: CrawlProfile;
  readonly candidates: readonly GitHubAdmissionCandidate[];
}

const fail = (): never => { throw new BeforeAfterRoundsError(); };
const PULL_REQUEST_SUFFIX = /\s*\((?:#\d+(?:,\s*)?)+\)$/u;
const UNSAFE_SUBJECT = /https?:|www\.|@|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+|\bco-authored-by\b|\bsigned-off-by\b/iu;

/**
 * The commit subject a hint may quote: its first line without a trailing pull-request number, within the
 * length limit, naming no address, handle, or the repository itself, and claiming nothing about authorship.
 * Undefined when no such subject exists.
 */
export const beforeAfterSubject = (message: string, repository: string, maximumLength: number): string | undefined => {
  const subject = (message.split(/\r?\n/u)[0] ?? "").replace(PULL_REQUEST_SUFFIX, "").trim();
  // A subject that claims anything about authorship would fail the parser after the whole run's spend (#32).
  if (subject.length < 8 || subject.length > maximumLength || UNSAFE_SUBJECT.test(subject) || AUTHORSHIP_CLAIM.test(subject)
    || mentionsRepository(subject, repository) || /[“”]/u.test(subject)) return undefined;
  return subject;
};

const later = (index: number): 0 | 1 => (index % 2 === 0 ? 0 : 1);

const fixtureFor = (candidate: GitHubAdmissionCandidate, laterPane: 0 | 1, profile: CrawlProfile): ExperimentFixture => {
  if (candidate.admissionDecision !== "AUTOMATED_POC_ADMISSION_ONLY") fail();
  const source = deepFreeze(structuredClone(candidate.source)) as unknown as Readonly<Record<string, unknown>>;
  if (Object.keys(source).sort().join("|") !== [...LINEAGE_SOURCE_KEYS].sort().join("|")) fail();
  const { lineage } = candidate;
  const repository = String(source.repository);
  const subject = beforeAfterSubject(lineage.commitMessage, repository, profile.screening.subjectMaxLength) ?? fail();
  if (sha256(lineage.afterExcerpt) !== source.excerptHash || sha256(lineage.beforeExcerpt) !== source.parentExcerptHash) fail();
  const template = profile.templates.beforeAfter;
  const roundId = roundIdFor("before-after", source);
  const texts = laterPane === 0 ? [lineage.afterExcerpt, lineage.beforeExcerpt] : [lineage.beforeExcerpt, lineage.afterExcerpt];
  const panes = Object.freeze(texts.map((text, index) => Object.freeze({ label: index === 0 ? "A" : "B", text })));
  const candidates = Object.freeze([
    Object.freeze({ id: BEFORE_AFTER_CANDIDATE_IDS[0], label: template.laterA, detail: null }),
    Object.freeze({ id: BEFORE_AFTER_CANDIDATE_IDS[1], label: template.laterB, detail: null }),
  ]);
  const clues = Object.freeze([
    fill(template.subjectClue, { subject: `“${subject}”` }),
    fill(template.linesClue, { removed: String(source.linesRemoved), added: String(source.linesAdded) }),
  ]);
  const [laterLabel, earlierLabel] = laterPane === 0 ? ["A", "B"] : ["B", "A"];
  return Object.freeze({
    kind: "BEFORE_AFTER",
    roundId,
    roundVersion: canonicalHash({ source, panes, candidates, clues, prompt: template.prompt }),
    panes,
    prompt: template.prompt,
    candidates,
    clues,
    correctCandidateId: BEFORE_AFTER_CANDIDATE_IDS[laterPane],
    evidence: fill(template.evidence, { commit: String(source.commit).slice(0, 7), earlier: earlierLabel!, later: laterLabel! }),
    explanation: template.explanation,
    attribution: attributionFor(source),
    helpfulSignals: Object.freeze([`The commit message “${subject}” describes what version ${laterLabel} does differently.`]),
    misleadingSignals: Object.freeze(["A refactor can make code longer as well as shorter."]),
    source,
  });
};

/**
 * Half the pool shows the later version as A and half as B. The split follows the private child-blob hash,
 * which a player cannot compute from what the round shows, so pane order carries no signal.
 */
export const generateBeforeAfterRounds = (options: BeforeAfterRoundsOptions): GeneratedRounds => {
  const { profile } = options;
  if (options.candidates.length !== profile.selection.beforeAfterPool) fail();
  const ordered = [...options.candidates].sort((left, right) =>
    sha256(String(left.source.childBlob)) < sha256(String(right.source.childBlob)) ? -1 : 1);
  const fixtures = ordered.map((candidate, index) => fixtureFor(candidate, later(index), profile));
  if (new Set(fixtures.map(({ source }) => source.crawlSnapshotId)).size !== 1) fail();
  for (const key of profile.deduplication) {
    const values = fixtures.map(({ source }) => String(source[key]));
    if (new Set(values).size !== values.length) fail();
  }
  return orderedPool(fixtures);
};
