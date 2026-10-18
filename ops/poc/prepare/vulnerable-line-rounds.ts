import { canonicalHash } from "./canonical";
import { linesBalanced, pairedDecoys } from "./fix-rounds";
import { deepFreeze } from "./model-validation";
import {
  VULNERABLE_LINE_SOURCE_KEYS, fixCandidateId, fixLineLabel, fixPairHint, namesAdvisory, vulnerableLineHint, type AdvisoryEcosystem,
  type ExperimentFixture,
} from "../../../packages/artifact/src/index";
import { FIX_OPTIONS, type CrawlProfile, type StackLanguage } from "./profile";
import { attributionFor, fill, orderedPool, roundIdFor, sha256, type GeneratedRounds } from "./round-helpers";

export class VulnerableLineRoundsError extends Error {
  public constructor(code = "VULNERABLE_LINE_ROUNDS_REJECTED") {
    super(code);
    this.name = "VulnerableLineRoundsError";
  }
}

/** A reviewed advisory's confirmed one-line fix chosen for a round (#59), with its window, bound to the run's snapshot. */
export interface VulnerableLineCandidate {
  /** The advisory (`GHSA-…`), the ecosystem whose listing named it, its package there, and the CWE its hint names. */
  readonly advisory: string;
  readonly ecosystem: AdvisoryEcosystem;
  readonly packageName: string;
  readonly cwe: string;
  readonly repository: string;
  readonly language: StackLanguage;
  /** The fix's parent, whose file the round shows. */
  readonly commit: string;
  readonly fixCommit: string;
  readonly path: string;
  /** The file at `commit`. */
  readonly blob: string;
  readonly fixBlob: string;
  readonly rawContentHash: string;
  readonly licenseName: string;
  readonly licenseSpdx: string;
  readonly licenseFileUrl: string;
  readonly authorName: string;
  readonly authorLogin: string | null;
  readonly buggyLine: string;
  readonly fixedLine: string;
  readonly changedLine: number;
  readonly windowStart: number;
  /** The changed line and three others, counted from the window's first line. */
  readonly answer: number;
  readonly decoys: readonly number[];
  readonly excerpt: string;
  readonly excerptHash: string;
  readonly crawlSnapshotId: string;
}

const fail = (code?: string): never => { throw new VulnerableLineRoundsError(code); };
const encodedPath = (value: string): string => value.split("/").map(encodeURIComponent).join("/");

const sourceFor = (candidate: VulnerableLineCandidate, profile: CrawlProfile): Readonly<Record<string, unknown>> => {
  const root = `https://github.com/${candidate.repository}`;
  const source: Record<string, unknown> = {
    discoverySource: "GITHUB_ADVISORY", repository: candidate.repository, repositoryUrl: root,
    authorName: candidate.authorName, authorLogin: candidate.authorLogin, authorBasis: "FIX_COMMIT",
    authorSourceUrl: `${root}/commit/${candidate.fixCommit}`, path: candidate.path, blob: candidate.blob,
    rawContentHash: candidate.rawContentHash, excerptHash: candidate.excerptHash, licenseName: candidate.licenseName,
    licenseSpdx: candidate.licenseSpdx, licenseFileUrl: candidate.licenseFileUrl, commit: candidate.commit,
    commitUrl: `${root}/commit/${candidate.commit}`, blobUrl: `${root}/blob/${candidate.commit}/${encodedPath(candidate.path)}`,
    profileVersion: profile.profileVersion, crawlSnapshotId: candidate.crawlSnapshotId, fixCommit: candidate.fixCommit,
    fixBlob: candidate.fixBlob, advisory: candidate.advisory, ecosystem: candidate.ecosystem, packageName: candidate.packageName,
    cwe: candidate.cwe, language: candidate.language, changedLine: candidate.changedLine, windowStart: candidate.windowStart,
  };
  if (Object.keys(source).sort().join("|") !== [...VULNERABLE_LINE_SOURCE_KEYS].sort().join("|")) fail();
  return deepFreeze(source);
};

const fixtureFor = (candidate: VulnerableLineCandidate, paired: number, profile: CrawlProfile): ExperimentFixture => {
  const deck = profile.curated!["vulnerable-line"]!;
  const template = deck.templates;
  const lines = candidate.excerpt.split("\n");
  const options = [candidate.answer, ...candidate.decoys].sort((left, right) => left - right);
  const hint = deck.cwes.find(({ id }) => id === candidate.cwe)?.hint ?? fail();
  if (sha256(candidate.excerpt) !== candidate.excerptHash || candidate.decoys.length !== FIX_OPTIONS - 1
    || new Set(options).size !== FIX_OPTIONS || options.some((line) => !Number.isInteger(line) || line < 1 || line > lines.length)
    || candidate.changedLine - candidate.windowStart + 1 !== candidate.answer
    || lines[candidate.answer - 1]!.trim() !== candidate.buggyLine.trim() || !candidate.decoys.includes(paired)) fail();
  const source = sourceFor(candidate, profile);
  const roundId = roundIdFor("vulnerable-line", source);
  const clues = Object.freeze([vulnerableLineHint(candidate.cwe, hint), fixPairHint(candidate.answer, paired)]);
  if ([candidate.excerpt, template.prompt, ...clues].some((part) => namesAdvisory(part, candidate.packageName))) fail("VULNERABLE_LINE_ADVISORY_SHOWN");
  const candidates = Object.freeze(options.map((line) => Object.freeze({ id: fixCandidateId(line), label: fixLineLabel(line), detail: null })));
  const panes = Object.freeze([Object.freeze({ label: null, text: candidate.excerpt })]);
  return Object.freeze({
    kind: "VULNERABLE_LINE",
    roundId,
    roundVersion: canonicalHash({ source, panes, candidates, clues, prompt: template.prompt }),
    panes,
    prompt: template.prompt,
    candidates,
    clues,
    correctCandidateId: fixCandidateId(candidate.answer),
    evidence: fill(template.evidence, {
      advisory: candidate.advisory, cwe: candidate.cwe, repository: candidate.repository, line: String(candidate.answer),
    }),
    explanation: template.explanation,
    attribution: attributionFor(source),
    helpfulSignals: Object.freeze([
      `Line ${candidate.answer} read “${candidate.buggyLine.trim()}”; the fix made it “${candidate.fixedLine.trim()}”.`,
      `The advisory was filed for the ${candidate.ecosystem} package ${candidate.packageName}.`,
    ]),
    misleadingSignals: Object.freeze(["Code that handles outside input often looks risky in more than one place."]),
    source,
  });
};

/**
 * One vulnerable-line round per candidate, balanced as the fix deck is (#59): each round offers four lines of its
 * window in line order; no position, centrality, line feature, or longer half of the second hint's pair is a better
 * guess than chance; each round is its own advisory, commit, and repository; and no text shown before the answer
 * holds an advisory or CVE id or the advisory's package.
 */
export const generateVulnerableLineRounds = (options: Readonly<{ profile: CrawlProfile; candidates: readonly unknown[] }>): GeneratedRounds => {
  const { profile } = options;
  const deck = profile.curated?.["vulnerable-line"] ?? fail();
  const candidates = options.candidates as readonly VulnerableLineCandidate[];
  if (candidates.length !== deck.rounds || new Set(candidates.map(({ crawlSnapshotId }) => crawlSnapshotId)).size !== 1) fail();
  const paired = pairedDecoys(candidates, candidates.map((candidate) => roundIdFor("vulnerable-line", sourceFor(candidate, profile))));
  if (!linesBalanced(candidates, paired)) fail("VULNERABLE_LINE_RANK_UNBALANCED");
  for (const key of ["advisory", "repository", "commit", "fixCommit", "excerptHash"] as const) {
    if (new Set(candidates.map((candidate) => key === "repository" ? candidate[key].toLowerCase() : candidate[key])).size !== candidates.length) fail();
  }
  return orderedPool(candidates.map((candidate, index) => fixtureFor(candidate, paired[index]!, profile)));
};
