import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { generateBeforeAfterRounds } from "../before-after-rounds";
import { canonicalBytes, canonicalHash } from "../canonical";
import type { ComposeOptions } from "../compose";
import type { GitHubAdmissionCandidate } from "../github-admission";
import { generateLanguageRounds } from "../language-rounds";
import { STACK_LANGUAGES, parseCrawlProfile, type CrawlProfile, type StackLanguage } from "../profile";
import { generateProjectRounds, type ProjectRoundInput, type RepositoryOption } from "../project-rounds";
import type { RevalidatedStackCandidate } from "../stack-revalidation";

export const sha1 = (seed: string): string => createHash("sha1").update(seed).digest("hex");
export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export const loadV3Profile = (): CrawlProfile => parseCrawlProfile(JSON.parse(
  readFileSync(new URL("../../profiles/local-real-rounds.v3.json", import.meta.url), "utf8"),
));

export const RESPONSE_HASHES = Object.freeze([sha256("response-a"), sha256("response-b"), sha256("response-c")]);
export const snapshotIdFor = (profile: CrawlProfile, hashes: readonly string[] = RESPONSE_HASHES): string =>
  canonicalHash({ profileHash: canonicalHash(profile), acceptedResponseHashes: hashes });

export interface CommitCandidateInput {
  readonly profile: CrawlProfile;
  readonly snapshotId: string;
  readonly index: number;
  readonly queryId?: string;
  readonly message?: string;
  readonly repository?: string;
}

/** One admitted commit whose lineage and source agree exactly, as lineage and admission produce them. */
export const commitCandidate = (input: CommitCandidateInput): GitHubAdmissionCandidate => {
  const { profile, snapshotId, index } = input;
  const repository = input.repository ?? `acme${index}/widget-${index}`;
  const repositoryUrl = `https://github.com/${repository}`;
  const commit = sha1(`commit-${repository}-${index}`);
  const path = `src/compute_${index}.ts`;
  const blob = sha1(`blob-${repository}-${index}`);
  const beforeExcerpt = `export function compute${index}(values: number[]): number {\n  let total = 0;\n  for (const value of values) {\n    total += value * ${index + 2};\n  }\n  return total;\n}`;
  const afterExcerpt = `export function compute${index}(values: number[]): number {\n  return values.reduce((total, value) => total + value * ${index + 2}, 0);\n}`;
  const commitUrl = `${repositoryUrl}/commit/${commit}`;
  const rawContentHash = sha256(`raw-${repository}-${index}`);
  const queryId = input.queryId ?? profile.github.queries[index % profile.github.queries.length]!.id;
  const queryIndex = profile.github.queries.findIndex(({ id }) => id === queryId);
  if (queryIndex < 0) throw new Error(`unknown query ${queryId}`);
  const lineage = {
    queryId, queryIndex, committerDate: "2026-09-01T10:00:00.000Z",
    repository, repositoryUrl, commit, commitUrl, path, blob, subject: `Refactor compute helper ${index}`,
    commitMessage: input.message ?? `Refactor compute helper ${index}`,
    childCommit: commit, childTree: sha1(`tree-${index}`), parentCommit: sha1(`parent-${index}`),
    parentTree: sha1(`parent-tree-${index}`), parentPath: path, childPath: path,
    parentMode: "100644" as const, childMode: "100644" as const, parentBlob: sha1(`parent-blob-${index}`), childBlob: blob,
    parentRawContentHash: sha256(`parent-raw-${index}`), childRawContentHash: rawContentHash,
    beforeExcerpt, afterExcerpt, excerpt: afterExcerpt, excerptHash: sha256(afterExcerpt), parentExcerptHash: sha256(beforeExcerpt),
    linesRemoved: 5, linesAdded: 1,
  };
  const source = {
    discoverySource: "GITHUB_COMMIT_SEARCH" as const, repository, repositoryUrl,
    authorName: `Author Number${index}`, authorLogin: `author-number-${index}`, authorBasis: "SELECTED_COMMIT" as const,
    authorSourceUrl: commitUrl, path, blob, rawContentHash, excerptHash: lineage.excerptHash,
    licenseName: "MIT License", licenseSpdx: "MIT", licenseFileUrl: `${repositoryUrl}/blob/${commit}/LICENSE`,
    commit, commitUrl, blobUrl: `${repositoryUrl}/blob/${commit}/${path}`,
    profileVersion: profile.profileVersion, crawlSnapshotId: snapshotId,
    queryId, childCommit: commit, childTree: lineage.childTree, parentCommit: lineage.parentCommit,
    parentTree: lineage.parentTree, parentPath: path, childPath: path, parentMode: "100644" as const,
    childMode: "100644" as const, parentBlob: lineage.parentBlob, childBlob: blob,
    parentRawContentHash: lineage.parentRawContentHash, childRawContentHash: rawContentHash,
    parentExcerptHash: lineage.parentExcerptHash, linesRemoved: 5, linesAdded: 1,
  };
  return { admissionDecision: "AUTOMATED_POC_ADMISSION_ONLY", lineage, source } as unknown as GitHubAdmissionCandidate;
};

/** Two code shapes per language, each long enough for a round and free of any language's name. */
const LANGUAGE_FIXTURES: Readonly<Record<StackLanguage, readonly Readonly<{ path: string; excerpt: string }>[]>> = Object.freeze({
  Python: [
    { path: "pkg/compute.py", excerpt: "def compute(value):\n    total = value * 2\n    if total > 10:\n        return total - 1\n    elif total < 0:\n        return 0\n    return total + 1" },
    { path: "pkg/ledger.py", excerpt: "class Ledger:\n    def __init__(self):\n        self.entries = []\n\n    def add(self, amount):\n        self.entries.append(amount)\n        return sum(self.entries)" },
  ],
  TypeScript: [
    { path: "src/compute.ts", excerpt: "export function compute(value: number): number {\n  const total = value * 2;\n  return total > 10 ? total - 1 : total + 1;\n}\n\nexport const half = (value: number): number => value / 2;" },
    { path: "src/ledger.ts", excerpt: "interface Entry {\n  readonly amount: number;\n  readonly note: string;\n}\n\nexport function sumEntries(entries: readonly Entry[]): number {\n  return entries.reduce((total, entry) => total + entry.amount, 0);\n}" },
  ],
  Go: [
    { path: "cmd/compute.go", excerpt: "func compute(value int) int {\n\ttotal := value * 2\n\tif total > 10 {\n\t\treturn total - 1\n\t}\n\treturn total + 1\n}\n\nfunc half(value int) int {\n\treturn value / 2\n}" },
    { path: "internal/ledger.go", excerpt: "type Ledger struct {\n\tentries []int\n}\n\nfunc (l *Ledger) Add(amount int) (int, error) {\n\tif amount < 0 {\n\t\treturn 0, errNegative\n\t}\n\tl.entries = append(l.entries, amount)\n\treturn len(l.entries), nil\n}" },
  ],
  Rust: [
    { path: "src/compute.rs", excerpt: "fn compute(value: i64) -> i64 {\n    let total = value * 2;\n    if total > 10 { total - 1 } else { total + 1 }\n}\n\nfn half(value: i64) -> i64 {\n    value / 2\n}" },
    { path: "src/ledger.rs", excerpt: "pub struct Ledger {\n    entries: Vec<i64>,\n}\n\nimpl Ledger {\n    pub fn add(&mut self, amount: i64) -> usize {\n        let mut count = self.entries.len();\n        self.entries.push(amount);\n        count += 1;\n        count\n    }\n}" },
  ],
  Ruby: [
    { path: "lib/compute.rb", excerpt: "def compute(value)\n  total = value * 2\n  return total - 1 if total > 10\n  total + 1\nend\n\ndef half(value)\n  value / 2\nend" },
    { path: "lib/ledger.rb", excerpt: "class Ledger\n  attr_reader :entries\n\n  def add(amount)\n    @entries ||= []\n    @entries << amount\n    @entries.sum\n  end\nend" },
  ],
});

/** A closing line that makes every variant's code distinct. */
const VARIANT_LINE: Readonly<Record<StackLanguage, (variant: number) => string>> = Object.freeze({
  Python: (variant) => `LIMIT_${variant} = ${variant}`,
  TypeScript: (variant) => `export const LIMIT_${variant} = ${variant};`,
  Go: (variant) => `const limit${variant} = ${variant}`,
  Rust: (variant) => `const LIMIT_${variant}: i64 = ${variant};`,
  Ruby: (variant) => `LIMIT_${variant} = ${variant}`,
});

/** One revalidated Stack candidate, as revalidation produces it. */
export const stackCandidate = (
  profile: CrawlProfile,
  snapshotId: string,
  language: StackLanguage,
  variant: number,
  overrides: Readonly<Record<string, unknown>> = {},
): RevalidatedStackCandidate => {
  const repository = (overrides.repository as string | undefined) ?? `stackorg${variant}/${language.toLowerCase()}-tools`;
  const root = `https://github.com/${repository}`;
  const commit = sha1(`stack-commit-${repository}-${language}-${variant}`);
  const blob = sha1(`stack-blob-${repository}-${language}-${variant}`);
  const fixture = LANGUAGE_FIXTURES[language][variant % 2]!;
  const path = fixture.path;
  const excerpt = `${fixture.excerpt}\n${VARIANT_LINE[language](variant)}`;
  const value = {
    discoverySource: "STACK_V2", repository, repositoryUrl: root, authorName: `Stack Author ${language} ${variant}`,
    authorLogin: null, authorBasis: "SELECTED_COMMIT", authorSourceUrl: `${root}/commit/${commit}`, path, blob,
    rawContentHash: sha256(`stack-raw-${repository}-${language}-${variant}`), excerptHash: sha256(excerpt), licenseName: "MIT License",
    licenseSpdx: "MIT", licenseFileUrl: `${root}/blob/${commit}/LICENSE`, commit, commitUrl: `${root}/commit/${commit}`,
    blobUrl: `${root}/blob/${commit}/${path}`, profileVersion: profile.profileVersion, crawlSnapshotId: snapshotId,
    excerpt, stackRelease: profile.stack.release, stackRevision: profile.stack.revision,
    configuration: language, stableRowId: sha256(`row-${repository}-${language}-${variant}`), swhBlobId: sha1(`swh-blob-${repository}-${language}-${variant}`),
    swhContentId: blob, swhDirectoryId: sha1(`swh-dir-${language}-${variant}`), swhSnapshotId: sha1(`swh-snap-${language}-${variant}`),
    swhRevisionId: commit, stackRepository: repository, stackPath: path, detectedLicenses: ["MIT"],
    detectedLanguage: language, generated: false, vendor: false, sourceEncoding: "UTF-8", byteLength: 2048,
    visitDate: "2026-01-03T00:00:00Z", revisionDate: "2026-01-02T00:00:00Z", committerDate: "2026-01-01T00:00:00Z",
    starEventsCount: 5000 + variant * 100, forkEventsCount: 300,
    ...overrides,
  };
  return value as unknown as RevalidatedStackCandidate;
};

/** Popular repositories per language; each language's rounds offer its two answers and two decoys. */
const PROJECT_OPTIONS: Readonly<Record<StackLanguage, readonly string[]>> = Object.freeze({
  Python: ["orbitlabs/quasar", "orbitlabs/nimbus", "fernworks/tundra", "fernworks/lagoon"],
  TypeScript: ["helix-dev/prism", "helix-dev/vortex", "sablecraft/ember", "sablecraft/zenith"],
  Go: ["kestrel-io/harbor", "kestrel-io/quarry", "mantle/drift", "mantle/sprocket"],
  Rust: ["corvid/anvil", "corvid/forge", "lattice-rs/marrow", "lattice-rs/pylon"],
  Ruby: ["garnet/tram", "garnet/ferry", "opal-works/kiln", "opal-works/loom"],
});

export const projectRoundInputs = (profile: CrawlProfile, snapshotId: string): readonly ProjectRoundInput[] =>
  STACK_LANGUAGES.flatMap((language) => {
    const options: RepositoryOption[] = PROJECT_OPTIONS[language].map((repository) => ({ repository, description: `A popular ${repository.split("/")[1]} toolkit.` }));
    return [0, 1].map((variant) => {
      const own = options[variant]!;
      return {
        candidate: stackCandidate(profile, snapshotId, language, variant + 10, { repository: own.repository }),
        description: own.description,
        distractors: options.filter((option) => option.repository !== own.repository),
      };
    });
  });

export interface DeckCandidates {
  readonly project: readonly ProjectRoundInput[];
  readonly language: readonly RevalidatedStackCandidate[];
  readonly beforeAfter: readonly GitHubAdmissionCandidate[];
}

/** Ten rounds per deck for one snapshot: two project and two language rounds per language, ten commits. */
export const deckCandidates = (profile: CrawlProfile, snapshotId: string): DeckCandidates => ({
  project: projectRoundInputs(profile, snapshotId),
  language: STACK_LANGUAGES.flatMap((language) => [0, 1].map((variant) => stackCandidate(profile, snapshotId, language, variant))),
  beforeAfter: Array.from({ length: 10 }, (_, index) => commitCandidate({ profile, snapshotId, index })),
});

export const composeInput = (
  profile: CrawlProfile = loadV3Profile(),
  hashes: readonly string[] = RESPONSE_HASHES,
): ComposeOptions & Readonly<{ candidates: DeckCandidates }> => {
  const snapshotId = snapshotIdFor(profile, hashes);
  const candidates = deckCandidates(profile, snapshotId);
  return {
    profile,
    canonicalProfileBytes: canonicalBytes(profile),
    acceptedResponseHashes: hashes,
    decks: {
      project: generateProjectRounds({ profile, rounds: candidates.project }),
      language: generateLanguageRounds({ profile, candidates: candidates.language }),
      "before-after": generateBeforeAfterRounds({ profile, candidates: candidates.beforeAfter }),
    },
    candidates,
  };
};
