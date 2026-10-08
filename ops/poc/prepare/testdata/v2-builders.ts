import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { generateAiRounds } from "../ai-rounds";
import { canonicalBytes, canonicalHash } from "../canonical";
import type { ComposeOptions } from "../compose";
import type { GitHubAdmissionCandidate } from "../github-admission";
import { generateLanguageRounds } from "../language-rounds";
import { parseCrawlProfile, type CrawlProfile, type StackLanguage } from "../profile";
import { generateProjectRounds } from "../project-rounds";
import type { RevalidatedStackCandidate } from "../stack-revalidation";

export const sha1 = (seed: string): string => createHash("sha1").update(seed).digest("hex");
export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export const loadV2Profile = (): CrawlProfile => parseCrawlProfile(JSON.parse(
  readFileSync(new URL("../../profiles/local-real-rounds.v2.json", import.meta.url), "utf8"),
));

export const RESPONSE_HASHES = Object.freeze([sha256("response-a"), sha256("response-b"), sha256("response-c")]);
export const snapshotIdFor = (profile: CrawlProfile, hashes: readonly string[] = RESPONSE_HASHES): string =>
  canonicalHash({ profileHash: canonicalHash(profile), acceptedResponseHashes: hashes });

export const COPILOT_TRAILER = "Co-authored-by: Copilot <198982749+Copilot@users.noreply.github.com>";
export const CLAUDE_TRAILER = "Co-Authored-By: Claude <noreply@anthropic.com>";

/** Repositories never mentioned by any builder excerpt, used as project distractors. */
export const DISTRACTOR_POOL = Object.freeze([
  "orbit/engine-a", "orbit/engine-b", "lumen/atlas", "lumen/beacon", "quartz/cinder", "quartz/delta",
  "vector/ember", "vector/fjord",
]);

export interface GitHubCandidateInput {
  readonly profile: CrawlProfile;
  readonly snapshotId: string;
  readonly index: number;
  readonly queryId: string;
  readonly message?: string;
  readonly repository?: string;
  readonly excerpt?: string;
}

/** One admitted GitHub candidate whose lineage and source agree exactly, as admission produces them. */
export const githubCandidate = (input: GitHubCandidateInput): GitHubAdmissionCandidate => {
  const { profile, snapshotId, index } = input;
  const repository = input.repository ?? `acme${index}/widget-${index}`;
  const repositoryUrl = `https://github.com/${repository}`;
  const commit = sha1(`commit-${repository}-${index}`);
  const path = `src/compute_${index}.ts`;
  const blob = sha1(`blob-${repository}-${index}`);
  const excerpt = input.excerpt ?? `export function compute${index}(value: number): number {\n  const total = value * ${index + 2};\n  return total + ${index};\n}`;
  const commitUrl = `${repositoryUrl}/commit/${commit}`;
  const rawContentHash = sha256(`raw-${repository}-${index}`);
  const queryIndex = profile.github.queries.findIndex(({ id }) => id === input.queryId);
  if (queryIndex < 0) throw new Error(`unknown query ${input.queryId}`);
  const lineage = {
    queryId: input.queryId, queryIndex, committerDate: "2026-09-01T10:00:00.000Z",
    repository, repositoryUrl, commit, commitUrl, path, blob,
    commitMessage: input.message ?? `Refactor compute helper ${index}`,
    childCommit: commit, childTree: sha1(`tree-${index}`), parentCommit: sha1(`parent-${index}`),
    parentTree: sha1(`parent-tree-${index}`), parentPath: path, childPath: path,
    parentMode: "100644" as const, childMode: "100644" as const, parentBlob: sha1(`parent-blob-${index}`), childBlob: blob,
    parentRawContentHash: sha256(`parent-raw-${index}`), childRawContentHash: rawContentHash,
    changedLineHash: sha256(`changed-${index}`), excerpt, excerptHash: sha256(excerpt),
    changedFileCount: 1 + (index % 3), commitAdditions: 10 + index, commitDeletions: index,
  };
  const source = {
    discoverySource: "GITHUB_COMMIT_SEARCH" as const, repository, repositoryUrl,
    authorName: `Author Number${index}`, authorLogin: `author-number-${index}`, authorBasis: "SELECTED_COMMIT" as const,
    authorSourceUrl: commitUrl, path, blob, rawContentHash, excerptHash: lineage.excerptHash,
    licenseName: "MIT License", licenseSpdx: "MIT", licenseFileUrl: `${repositoryUrl}/blob/${commit}/LICENSE`,
    commit, commitUrl, blobUrl: `${repositoryUrl}/blob/${commit}/${path}`,
    profileVersion: profile.profileVersion, crawlSnapshotId: snapshotId,
    queryId: input.queryId, childCommit: commit, childTree: lineage.childTree, parentCommit: lineage.parentCommit,
    parentTree: lineage.parentTree, parentPath: path, childPath: path, parentMode: "100644" as const,
    childMode: "100644" as const, parentBlob: lineage.parentBlob, childBlob: blob,
    parentRawContentHash: lineage.parentRawContentHash, childRawContentHash: rawContentHash,
    changedLineHash: lineage.changedLineHash,
  };
  return { admissionDecision: "AUTOMATED_POC_ADMISSION_ONLY", lineage, source } as unknown as GitHubAdmissionCandidate;
};

const LANGUAGE_FIXTURES: Readonly<Record<StackLanguage, Readonly<{ path: string; excerpt: string }>>> = Object.freeze({
  Python: { path: "pkg/compute.py", excerpt: "def compute(value):\n    total = value * 2\n    if total > 10:\n        return total - 1\n    return total + 1" },
  TypeScript: { path: "src/compute.ts", excerpt: "export function compute(value: number): number {\n  const total = value * 2;\n  return total > 10 ? total - 1 : total + 1;\n}" },
  Go: { path: "cmd/compute.go", excerpt: "func compute(value int) int {\n\ttotal := value * 2\n\tif total > 10 {\n\t\treturn total - 1\n\t}\n\treturn total + 1\n}" },
  Rust: { path: "src/compute.rs", excerpt: "fn compute(value: i64) -> i64 {\n    let total = value * 2;\n    if total > 10 { total - 1 } else { total + 1 }\n}" },
  Ruby: { path: "lib/compute.rb", excerpt: "def compute(value)\n  total = value * 2\n  return total - 1 if total > 10\n  total + 1\nend" },
});

/** One revalidated Stack candidate, as revalidation produces it, for the given language. */
export const stackCandidate = (
  profile: CrawlProfile,
  snapshotId: string,
  language: StackLanguage,
  overrides: Readonly<Record<string, unknown>> = {},
): RevalidatedStackCandidate => {
  const repository = `stackorg/${language.toLowerCase()}-tools`;
  const root = `https://github.com/${repository}`;
  const commit = sha1(`stack-commit-${language}`);
  const blob = sha1(`stack-blob-${language}`);
  const { path, excerpt } = LANGUAGE_FIXTURES[language];
  const value = {
    discoverySource: "STACK_V2", repository, repositoryUrl: root, authorName: `Stack Author ${language}`,
    authorLogin: null, authorBasis: "SELECTED_COMMIT", authorSourceUrl: `${root}/commit/${commit}`, path, blob,
    rawContentHash: sha256(`stack-raw-${language}`), excerptHash: sha256(excerpt), licenseName: "MIT License",
    licenseSpdx: "MIT", licenseFileUrl: `${root}/blob/${commit}/LICENSE`, commit, commitUrl: `${root}/commit/${commit}`,
    blobUrl: `${root}/blob/${commit}/${path}`, profileVersion: profile.profileVersion, crawlSnapshotId: snapshotId,
    excerpt, stackRelease: "v2.2.0", stackRevision: "e565caa3a78c2423bd374333a472b049eb090e47",
    configuration: language, stableRowId: sha256(`row-${language}`), swhBlobId: sha1(`swh-blob-${language}`),
    swhContentId: blob, swhDirectoryId: sha1(`swh-dir-${language}`), swhSnapshotId: sha1(`swh-snap-${language}`),
    swhRevisionId: commit, stackRepository: repository, stackPath: path, detectedLicenses: ["MIT"],
    detectedLanguage: language, generated: false, vendor: false, sourceEncoding: "UTF-8", byteLength: 512,
    visitDate: "2026-01-03T00:00:00Z", revisionDate: "2026-01-02T00:00:00Z", committerDate: "2026-01-01T00:00:00Z",
    ...overrides,
  };
  return value as unknown as RevalidatedStackCandidate;
};

export interface DeckCandidates {
  readonly project: readonly GitHubAdmissionCandidate[];
  readonly ai: readonly GitHubAdmissionCandidate[];
  readonly language: readonly RevalidatedStackCandidate[];
}

/** Five project, five AI (three credited, two not), and five language candidates for one snapshot. */
export const deckCandidates = (profile: CrawlProfile, snapshotId: string): DeckCandidates => ({
  project: [0, 1, 2, 3, 4].map((index) => githubCandidate({ profile, snapshotId, index, queryId: "ordinary-facebook" })),
  ai: [
    githubCandidate({ profile, snapshotId, index: 10, queryId: "ai-copilot-github", message: `Fix layout spacing\n\n${COPILOT_TRAILER}` }),
    githubCandidate({ profile, snapshotId, index: 11, queryId: "ai-claude-github", message: `Tidy parser state\n\n${CLAUDE_TRAILER}` }),
    githubCandidate({ profile, snapshotId, index: 12, queryId: "ai-copilot-microsoft", message: `Generate fixtures\n\n${COPILOT_TRAILER}` }),
    githubCandidate({ profile, snapshotId, index: 13, queryId: "ordinary-github", message: "Refactor cache keys" }),
    githubCandidate({ profile, snapshotId, index: 14, queryId: "ordinary-vercel", message: "Refactor routing table" }),
  ],
  language: (["Python", "TypeScript", "Go", "Rust", "Ruby"] as const).map((language) => stackCandidate(profile, snapshotId, language)),
});

export const composeInput = (
  profile: CrawlProfile = loadV2Profile(),
  hashes: readonly string[] = RESPONSE_HASHES,
): ComposeOptions & Readonly<{ candidates: DeckCandidates }> => {
  const snapshotId = snapshotIdFor(profile, hashes);
  const candidates = deckCandidates(profile, snapshotId);
  return {
    profile,
    canonicalProfileBytes: canonicalBytes(profile),
    acceptedResponseHashes: hashes,
    project: generateProjectRounds({ profile, candidates: candidates.project, distractorPool: DISTRACTOR_POOL }),
    language: generateLanguageRounds({ profile, candidates: candidates.language }),
    ai: generateAiRounds({ profile, candidates: candidates.ai }),
    candidates,
  };
};
