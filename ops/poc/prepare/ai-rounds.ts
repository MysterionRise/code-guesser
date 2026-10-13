import { aiCreditFor, commitSubject, safeSubject } from "./ai-credit";
import { canonicalHash } from "./canonical";
import type { GitHubAdmissionCandidate } from "./github-admission";
import { AI_CANDIDATE_IDS, PROJECT_SOURCE_KEYS, type ExperimentFixture } from "./model";
import type { CrawlProfile } from "./profile";
import {
  attributionFor,
  fill,
  generatedDeck,
  plural,
  sha256,
  type GeneratedRounds,
} from "./round-projection";

export class AiRoundsError extends Error {
  public constructor() {
    super("AI_ROUNDS_REJECTED");
    this.name = "AiRoundsError";
  }
}

export interface AiRoundsOptions {
  readonly profile: CrawlProfile;
  readonly candidates: readonly GitHubAdmissionCandidate[];
}

const fail = (): never => { throw new AiRoundsError(); };

const candidatesFor = (profile: CrawlProfile) => Object.freeze([
  Object.freeze({ id: AI_CANDIDATE_IDS[0], label: profile.templates.ai.recordedCandidate }),
  Object.freeze({ id: AI_CANDIDATE_IDS[1], label: profile.templates.ai.absentCandidate }),
]);

const count = (value: unknown): number =>
  Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : fail();

/**
 * FR-024 as replaced by revision 12. The answer is the commit record's AI credit (FR-034), checked
 * against the discovering query's role; the no answer never claims the code was written without AI.
 */
const fixtureFor = (candidate: GitHubAdmissionCandidate, profile: CrawlProfile): ExperimentFixture => {
  if (candidate.admissionDecision !== "AUTOMATED_POC_ADMISSION_ONLY") fail();
  const admitted = candidate.source as unknown as Readonly<Record<string, unknown>>;
  if (Object.keys(admitted).sort().join("|") !== [...PROJECT_SOURCE_KEYS].sort().join("|")) fail();
  const { lineage } = candidate;
  const excerpt = lineage.excerpt;
  if (sha256(excerpt) !== admitted.excerptHash) fail();
  const query = profile.github.queries.find(({ id }) => id === admitted.queryId) ?? fail();
  const credit = aiCreditFor(lineage.commitMessage, profile.aiCredits);
  if (credit.recorded !== (query.role === "ai-credit")) fail();
  const files = count(lineage.changedFileCount);
  if (files < 1) fail();
  const additions = count(lineage.commitAdditions);
  const deletions = count(lineage.commitDeletions);
  const template = profile.templates.ai;
  const repository = String(admitted.repository);
  const [owner, name] = repository.split("/") as [string, string];
  const subject = safeSubject(commitSubject(lineage.commitMessage), profile, {
    owner, name, authorName: String(admitted.authorName),
    authorLogin: admitted.authorLogin === null ? null : String(admitted.authorLogin),
  });
  const fileClue = fill(template.fileClue, { files: plural(files, "file", "files") });
  const secondClue = subject !== undefined
    ? fill(template.subjectClue, { subject })
    : fill(template.linesClue, { added: plural(additions, "line", "lines"), removed: plural(deletions, "line", "lines") });
  const evidence = credit.recorded
    ? fill(template.recordedEvidence, { assistant: credit.assistant ?? fail() })
    : template.absentEvidence;
  const source = Object.freeze({
    ...admitted,
    aiCreditRecorded: credit.recorded,
    aiAssistant: credit.assistant,
    changedFileCount: files,
    commitAdditions: additions,
    commitDeletions: deletions,
  });
  const roundId = `local-ai-${canonicalHash({
    kind: "ai-credit", repository, commit: admitted.commit, path: admitted.path, blob: admitted.blob,
  }).slice(0, 24)}`;
  const candidates = candidatesFor(profile);
  return Object.freeze({
    kind: "AI_CREDIT",
    roundId,
    roundVersion: canonicalHash({ source, excerpt, template, candidates, clues: [fileClue, secondClue] }),
    excerpt,
    prompt: template.prompt,
    candidates,
    clues: Object.freeze([fileClue, secondClue]),
    correctCandidateId: credit.recorded ? AI_CANDIDATE_IDS[0] : AI_CANDIDATE_IDS[1],
    evidence,
    explanation: template.explanation,
    attribution: attributionFor(source),
    helpfulSignals: Object.freeze([evidence]),
    misleadingSignals: Object.freeze([secondClue]),
    source,
  });
};

export const generateAiRounds = (options: AiRoundsOptions): GeneratedRounds => {
  const { profile } = options;
  if (options.candidates.length !== profile.selection.aiRounds) fail();
  const fixtures = options.candidates.map((candidate) => fixtureFor(candidate, profile));
  const recorded = fixtures.filter(({ source }) => source.aiCreditRecorded === true).length;
  if (recorded < profile.selection.aiMinimumPerOutcome
    || fixtures.length - recorded < profile.selection.aiMinimumPerOutcome) fail();
  const repositories = fixtures.map(({ source }) => source.repository);
  if (new Set(repositories).size !== repositories.length) fail();
  return generatedDeck(fixtures, profile, { deck: "ai", credits: profile.aiCredits });
};
