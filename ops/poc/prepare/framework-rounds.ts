import {
  FRAMEWORK_SOURCE_KEYS, frameworkCandidateId, frameworkMarkerHint, showsFrameworkSymbol, spellsFramework,
} from "../../../packages/artifact/src/index";
import { canonicalHash } from "./canonical";
import type { ExperimentFixture } from "./model";
import { deepFreeze } from "./model-validation";
import type { CrawlProfile, FrameworkEntry, FrameworkFamily } from "./profile";
import { attributionFor, fill, orderedPool, roundIdFor, sha256, type GeneratedRounds } from "./round-helpers";

export class FrameworkRoundsError extends Error {
  public constructor(code = "FRAMEWORK_ROUNDS_REJECTED") {
    super(code);
    this.name = "FrameworkRoundsError";
  }
}

/** A curated file chosen for a framework round, with its masked window, bound to the run's snapshot. */
export interface FrameworkCandidate {
  readonly familyId: string;
  readonly framework: string;
  readonly repository: string;
  readonly commit: string;
  readonly path: string;
  readonly blob: string;
  readonly rawContentHash: string;
  readonly licenseName: string;
  readonly licenseSpdx: string;
  readonly licenseFileUrl: string;
  readonly authorName: string;
  readonly authorLogin: string | null;
  readonly authorCommit: string;
  readonly windowStart: number;
  readonly excerpt: string;
  readonly excerptHash: string;
  /** The idiom of its framework the second hint quotes: the window's most telling one. */
  readonly marker: string;
  readonly crawlSnapshotId: string;
}

const fail = (code?: string): never => { throw new FrameworkRoundsError(code); };
const encodedPath = (value: string): string => value.split("/").map(encodeURIComponent).join("/");

const sourceFor = (candidate: FrameworkCandidate, profile: CrawlProfile): Readonly<Record<string, unknown>> => {
  const root = `https://github.com/${candidate.repository}`;
  const source: Record<string, unknown> = {
    discoverySource: "CURATED_GITHUB", repository: candidate.repository, repositoryUrl: root,
    authorName: candidate.authorName, authorLogin: candidate.authorLogin, authorBasis: "PATH_HISTORY",
    authorSourceUrl: `${root}/commit/${candidate.authorCommit}`, path: candidate.path, blob: candidate.blob,
    rawContentHash: candidate.rawContentHash, excerptHash: candidate.excerptHash, licenseName: candidate.licenseName,
    licenseSpdx: candidate.licenseSpdx, licenseFileUrl: candidate.licenseFileUrl, commit: candidate.commit,
    commitUrl: `${root}/commit/${candidate.commit}`, blobUrl: `${root}/blob/${candidate.commit}/${encodedPath(candidate.path)}`,
    profileVersion: profile.profileVersion, crawlSnapshotId: candidate.crawlSnapshotId, authorCommit: candidate.authorCommit,
    framework: candidate.framework, windowStart: candidate.windowStart,
  };
  if (Object.keys(source).sort().join("|") !== [...FRAMEWORK_SOURCE_KEYS].sort().join("|")) fail();
  return deepFreeze(source);
};

const fixtureFor = (
  candidate: FrameworkCandidate,
  family: FrameworkFamily,
  entry: FrameworkEntry,
  every: readonly FrameworkEntry[],
  profile: CrawlProfile,
): ExperimentFixture => {
  const template = profile.curated!.framework!.templates;
  if (sha256(candidate.excerpt) !== candidate.excerptHash || !(candidate.marker.includes("`") || candidate.excerpt.includes(candidate.marker))) fail();
  const clues = Object.freeze([entry.idea, frameworkMarkerHint(candidate.marker)]);
  // No framework of the deck may be spelled by the code, the prompt, or a hint, nor shown by its symbol in the code:
  // a name would answer the round, or rule an option out.
  for (const part of [candidate.excerpt, template.prompt, ...clues]) {
    if (every.some((framework) => spellsFramework(part, framework))) fail("FRAMEWORK_NAME_SHOWN");
  }
  if (every.some((framework) => showsFrameworkSymbol(candidate.excerpt, framework))) fail("FRAMEWORK_NAME_SHOWN");
  const source = sourceFor(candidate, profile);
  const roundId = roundIdFor("framework", source);
  // Options in text order; the game shuffles four-option rounds at every deal.
  const candidates = Object.freeze([...family.frameworks].sort((left, right) => left.label < right.label ? -1 : 1)
    .map(({ id, label }) => Object.freeze({ id: frameworkCandidateId(id), label, detail: null })));
  const panes = Object.freeze([Object.freeze({ label: null, text: candidate.excerpt })]);
  const quoted = candidate.marker.includes("`") ? candidate.marker : `\`${candidate.marker}\``;
  return Object.freeze({
    kind: "FRAMEWORK",
    roundId,
    roundVersion: canonicalHash({ source, panes, candidates, clues, prompt: template.prompt }),
    panes,
    prompt: template.prompt,
    candidates,
    clues,
    correctCandidateId: frameworkCandidateId(entry.id),
    evidence: fill(template.evidence, { path: candidate.path, repository: candidate.repository, name: entry.label }),
    explanation: template.explanation,
    attribution: attributionFor(source),
    helpfulSignals: Object.freeze([`${quoted} is typical ${entry.label}.`]),
    misleadingSignals: Object.freeze([family.note]),
    source,
  });
};

/**
 * One framework round per candidate. Each round offers its family's four frameworks, and each family's rounds answer
 * each of its frameworks equally often, so no option set, place, or frequency points to an answer.
 */
export const generateFrameworkRounds = (options: Readonly<{ profile: CrawlProfile; candidates: readonly unknown[] }>): GeneratedRounds => {
  const { profile } = options;
  const deck = profile.curated?.framework ?? fail();
  const candidates = options.candidates as readonly FrameworkCandidate[];
  if (candidates.length !== deck.rounds || new Set(candidates.map(({ crawlSnapshotId }) => crawlSnapshotId)).size !== 1) fail();
  const every = deck.families.flatMap(({ frameworks }) => frameworks);
  const fixtures = candidates.map((candidate) => {
    const family = deck.families.find(({ id }) => id === candidate.familyId) ?? fail();
    const entry = family.frameworks.find(({ id }) => id === candidate.framework) ?? fail();
    return fixtureFor(candidate, family, entry, every, profile);
  });
  for (const familyId of new Set(candidates.map(({ familyId }) => familyId))) {
    const family = deck.families.find(({ id }) => id === familyId)!;
    const answered = candidates.filter((candidate) => candidate.familyId === familyId);
    if (family.frameworks.some(({ id }) => answered.filter(({ framework }) => framework === id).length !== deck.roundsPerFramework)) {
      fail("FRAMEWORK_FAMILY_UNBALANCED");
    }
  }
  for (const key of ["path", "blob", "rawContentHash", "excerptHash"] as const) {
    if (new Set(candidates.map((candidate) => candidate[key])).size !== candidates.length) fail();
  }
  return orderedPool(fixtures);
};
