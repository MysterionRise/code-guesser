import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { generateAlgorithmRounds, type AlgorithmCandidate } from "../algorithm-rounds";
import { generateBeforeAfterRounds } from "../before-after-rounds";
import { algorithmWindow, labelWords } from "../function-windows";
import { canonicalBytes, canonicalHash } from "../canonical";
import type { ComposeOptions } from "../compose";
import type { GitHubAdmissionCandidate } from "../github-admission";
import { generateLanguageRounds } from "../language-rounds";
import { LANGUAGE_SLUGS } from "../../../../packages/artifact/src/index";
import { STACK_LANGUAGES, parseCrawlProfile, type CrawlProfile, type StackLanguage } from "../profile";
import { generateProjectRounds, type ProjectRoundInput, type RepositoryOption } from "../project-rounds";
import type { RevalidatedStackCandidate } from "../stack-revalidation";

export const sha1 = (seed: string): string => createHash("sha1").update(seed).digest("hex");
export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export const loadDeckProfile = (): CrawlProfile => parseCrawlProfile(JSON.parse(
  readFileSync(new URL("../../profiles/local-real-rounds.v4.json", import.meta.url), "utf8"),
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

/**
 * Two code shapes per language, each long enough for a round, free of any language's name, and showing syntax
 * that sets the language apart from its look-alike.
 */
const LANGUAGE_FIXTURES: Readonly<Record<StackLanguage, readonly Readonly<{ path: string; excerpt: string }>[]>> = Object.freeze({
  Python: [
    { path: "pkg/compute.py", excerpt: "def compute(value):\n    total = value * 2\n    if total > 10:\n        return total - 1\n    elif total < 0:\n        return 0\n    return total + 1" },
    { path: "pkg/ledger.py", excerpt: "class Ledger:\n    def __init__(self):\n        self.entries = []\n\n    def add(self, amount):\n        self.entries.append(amount)\n        return sum(self.entries)" },
  ],
  Ruby: [
    { path: "lib/compute.rb", excerpt: "def compute(value)\n  total = value * 2\n  return total - 1 if total > 10\n  total + 1\nend\n\ndef half(value)\n  value / 2\nend" },
    { path: "lib/ledger.rb", excerpt: "class Ledger\n  attr_reader :entries\n\n  def add(amount)\n    @entries ||= []\n    @entries << amount\n    @entries.sum\n  end\nend" },
  ],
  TypeScript: [
    { path: "src/compute.ts", excerpt: "export function compute(value: number): number {\n  const total = value * 2;\n  return total > 10 ? total - 1 : total + 1;\n}\n\nexport const half = (value: number): number => value / 2;" },
    { path: "src/ledger.ts", excerpt: "interface Entry {\n  readonly amount: number;\n  readonly note: string;\n}\n\nexport function sumEntries(entries: readonly Entry[]): number {\n  return entries.reduce((total, entry) => total + entry.amount, 0);\n}" },
  ],
  JavaScript: [
    { path: "src/compute.js", excerpt: "function compute(value, limit) {\n  var total = value * 2;\n  if (total > limit) {\n    return total - 1;\n  }\n  return total + 1;\n}\n\nmodule.exports = { compute: compute };" },
    { path: "lib/ledger.js", excerpt: "function Ledger() {\n  this.entries = [];\n}\n\nLedger.prototype.add = function (amount) {\n  this.entries.push(amount);\n  return this.entries.length;\n};\n\nexports.Ledger = Ledger;" },
  ],
  Go: [
    { path: "cmd/compute.go", excerpt: "func compute(value int) int {\n\ttotal := value * 2\n\tif total > 10 {\n\t\treturn total - 1\n\t}\n\treturn total + 1\n}\n\nfunc half(value int) int {\n\treturn value / 2\n}" },
    { path: "internal/ledger.go", excerpt: "type Ledger struct {\n\tentries []int\n}\n\nfunc (l *Ledger) Add(amount int) (int, error) {\n\tif amount < 0 {\n\t\treturn 0, errNegative\n\t}\n\tl.entries = append(l.entries, amount)\n\treturn len(l.entries), nil\n}" },
  ],
  Rust: [
    { path: "src/compute.rs", excerpt: "fn compute(value: i64) -> i64 {\n    let total = value * 2;\n    if total > 10 { total - 1 } else { total + 1 }\n}\n\nfn half(value: i64) -> i64 {\n    value / 2\n}" },
    { path: "src/ledger.rs", excerpt: "pub struct Ledger {\n    entries: Vec<i64>,\n}\n\nimpl Ledger {\n    pub fn add(&mut self, amount: i64) -> usize {\n        let mut count = self.entries.len();\n        self.entries.push(amount);\n        count += 1;\n        count\n    }\n}" },
  ],
  Java: [
    { path: "src/main/demo/Ledger.java", excerpt: "public class Ledger {\n    private final List<Integer> entries = new ArrayList<>();\n\n    public int add(int amount) {\n        entries.add(amount);\n        return entries.size();\n    }\n\n    public boolean isEmpty() {\n        return entries.isEmpty();\n    }\n}" },
    { path: "src/main/demo/Compute.java", excerpt: "public final class Compute {\n    @Override\n    public String toString() {\n        return \"compute\";\n    }\n\n    static int compute(int value) {\n        int total = value * 2;\n        return total > 10 ? total - 1 : total + 1;\n    }\n}" },
  ],
  "C#": [
    { path: "src/Demo/Ledger.cs", excerpt: "public class Ledger\n{\n    private readonly List<int> _entries = new List<int>();\n\n    public int Size => _entries.Count;\n\n    public int Add(int amount)\n    {\n        _entries.Add(amount);\n        return _entries.Count;\n    }\n}" },
    { path: "src/Demo/Compute.cs", excerpt: "public static class Compute\n{\n    public static bool IsLarge(int value) => value * 2 > 10;\n\n    public static string Describe(int value)\n    {\n        foreach (var digit in value.ToString())\n        {\n            Console.WriteLine(digit);\n        }\n        return $\"value {value}\";\n    }\n}" },
  ],
  Kotlin: [
    { path: "src/main/demo/Ledger.kt", excerpt: "class Ledger {\n    private val entries = mutableListOf<Int>()\n\n    fun add(amount: Int): Int {\n        entries.add(amount)\n        return entries.size\n    }\n\n    fun describe() = when (entries.size) {\n        0 -> \"empty\"\n        else -> \"${entries.size} entries\"\n    }\n}" },
    { path: "src/main/demo/Compute.kt", excerpt: "data class Point(val x: Int, val y: Int)\n\nfun compute(value: Int?): Int {\n    val total = (value ?: 0) * 2\n    return if (total > 10) total - 1 else total + 1\n}\n\nobject Limits {\n    const val MAX = 10\n}" },
  ],
  Swift: [
    { path: "Sources/Demo/Ledger.swift", excerpt: "struct Ledger {\n    private(set) var entries: [Int] = []\n\n    mutating func add(_ amount: Int) -> Int {\n        entries.append(amount)\n        return entries.count\n    }\n}" },
    { path: "Sources/Demo/Compute.swift", excerpt: "func compute(_ value: Int?) -> Int {\n    guard let value = value else {\n        return 0\n    }\n    let total = value * 2\n    return total > 10 ? total - 1 : total + 1\n}" },
  ],
  C: [
    { path: "src/ledger.c", excerpt: "struct ledger *ledger_new(size_t capacity)\n{\n    struct ledger *ledger = malloc(sizeof *ledger);\n    if (ledger == NULL) {\n        return NULL;\n    }\n    ledger->count = 0;\n    ledger->capacity = capacity;\n    return ledger;\n}" },
    { path: "src/compute.c", excerpt: "static int compute(int value)\n{\n    int total = value * 2;\n    if (total > 10) {\n        return total - 1;\n    }\n    printf(\"%d\\n\", total);\n    return total + 1;\n}" },
  ],
  "C++": [
    { path: "src/ledger.cpp", excerpt: "class Ledger {\npublic:\n    int add(int amount) {\n        entries_.push_back(amount);\n        return static_cast<int>(entries_.size());\n    }\n\nprivate:\n    std::vector<int> entries_;\n};" },
    { path: "src/compute.cc", excerpt: "namespace demo {\n\nauto compute(int value) -> int {\n    const auto total = value * 2;\n    return total > 10 ? total - 1 : total + 1;\n}\n\n}  // namespace demo" },
  ],
});

/** A closing line that makes every variant's code distinct. */
const VARIANT_LINE: Readonly<Record<StackLanguage, (variant: number) => string>> = Object.freeze({
  Python: (variant: number) => `LIMIT_${variant} = ${variant}`,
  Ruby: (variant: number) => `LIMIT_${variant} = ${variant}`,
  TypeScript: (variant: number) => `export const LIMIT_${variant} = ${variant};`,
  JavaScript: (variant: number) => `var LIMIT_${variant} = ${variant};`,
  Go: (variant: number) => `const limit${variant} = ${variant}`,
  Rust: (variant: number) => `const LIMIT_${variant}: i64 = ${variant};`,
  Java: (variant: number) => `final int limit${variant} = ${variant};`,
  "C#": (variant: number) => `const int Limit${variant} = ${variant};`,
  Kotlin: (variant: number) => `const val LIMIT_${variant} = ${variant}`,
  Swift: (variant: number) => `let limit${variant} = ${variant}`,
  C: (variant: number) => `static const int limit${variant} = ${variant};`,
  "C++": (variant: number) => `constexpr int kLimit${variant} = ${variant};`,
});

/** One revalidated Stack candidate, as revalidation produces it. */
export const stackCandidate = (
  profile: CrawlProfile,
  snapshotId: string,
  language: StackLanguage,
  variant: number,
  overrides: Readonly<Record<string, unknown>> = {},
): RevalidatedStackCandidate => {
  const repository = (overrides.repository as string | undefined) ?? `stackorg${variant}/${LANGUAGE_SLUGS[language]}-tools`;
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
  Ruby: ["garnet/tram", "garnet/ferry", "opal-works/kiln", "opal-works/loom"],
  TypeScript: ["helix-dev/prism", "helix-dev/vortex", "sablecraft/ember", "sablecraft/zenith"],
  JavaScript: ["cobalt-js/meadow", "cobalt-js/harp", "quill/marina", "quill/sable"],
  Go: ["kestrel-io/harbor", "kestrel-io/quarry", "mantle/drift", "mantle/sprocket"],
  Rust: ["corvid/anvil", "corvid/forge", "lattice-rs/marrow", "lattice-rs/pylon"],
  Java: ["birch-io/canyon", "birch-io/glacier", "tessel/orchard", "tessel/beacon"],
  "C#": ["pinewood/atlas", "pinewood/comet", "veldt/horizon", "veldt/summit"],
  Kotlin: ["moss-labs/pebble", "moss-labs/willow", "ridge/falcon", "ridge/heron"],
  Swift: ["coral/badger", "coral/otter", "dune-kit/raven", "dune-kit/finch"],
  C: ["granite/spindle", "granite/lathe", "ochre/kettle", "ochre/bellows"],
  "C++": ["umber/cascade", "umber/delta", "slate-dev/prairie", "slate-dev/fjord"],
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

/** A full pool per deck for one snapshot: two project and two language rounds per language, ten commits. */
export const deckCandidates = (profile: CrawlProfile, snapshotId: string): DeckCandidates => ({
  project: projectRoundInputs(profile, snapshotId),
  language: STACK_LANGUAGES.flatMap((language) => [0, 1].map((variant) => stackCandidate(profile, snapshotId, language, variant))),
  beforeAfter: Array.from({ length: 10 }, (_, index) => commitCandidate({ profile, snapshotId, index })),
});

export const composeInput = (
  profile: CrawlProfile = loadDeckProfile(),
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
      // A profile with a curated section adds its algorithm deck.
      ...(profile.curated?.algorithm ? { algorithm: generateAlgorithmRounds({ profile, candidates: algorithmCandidates(profile, snapshotId) }) } : {}),
    },
    candidates,
  };
};

/** Two curated repositories and two families of four algorithms: a small algorithm deck of eight rounds. */
export const CURATED_REPOSITORIES = Object.freeze([
  { repository: "algos/python", commit: sha1("python-pin"), language: "Python" },
  { repository: "algos/go", commit: sha1("go-pin"), language: "Go" },
] as const);
const curatedAlgorithm = (id: string, label: string, names: readonly string[], idea: string, complexity: string, stem: string) => ({
  id, label, names, idea, complexity,
  files: { "algos/python": { path: `algorithms/${stem}.py`, symbols: [] }, "algos/go": { path: `algorithms/${stem}.go`, symbols: [] } },
});
export const CURATED_SECTION = Object.freeze({
  repositories: CURATED_REPOSITORIES,
  algorithm: {
    rounds: 8,
    templates: {
      title: "Which algorithm?",
      description: "Read an algorithm with its name hidden and pick which one it is.",
      prompt: "Which algorithm is this?",
      evidence: "This is {path} in {repository}; its own name, hidden here, is {name}.",
      explanation: "The answer is the algorithm the repository files this code under.",
    },
    families: [
      { id: "simple-sorts", note: "All four sort by comparing pairs of items; look at which items move.", algorithms: [
        curatedAlgorithm("bubble-sort", "Bubble sort", ["bubble_sort", "bubblesort"], "It swaps neighbours that are out of order.", "O(n²).", "bubble_sort"),
        curatedAlgorithm("insertion-sort", "Insertion sort", ["insertion_sort", "insertionsort"], "It slides each item left until it fits.", "O(n²) at worst.", "insertion_sort"),
        curatedAlgorithm("selection-sort", "Selection sort", ["selection_sort", "selectionsort"], "It moves the smallest remaining item forward.", "Always O(n²).", "selection_sort"),
        curatedAlgorithm("quick-sort", "Quicksort", ["quick_sort", "quicksort"], "It splits items around a pivot and recurses.", "O(n log n) on average.", "quick_sort"),
      ] },
      { id: "searches", note: "All four look for a target in a list; look at the next position checked.", algorithms: [
        curatedAlgorithm("binary-search", "Binary search", ["binary_search", "binarysearch"], "It halves the range at every step.", "O(log n).", "binary_search"),
        curatedAlgorithm("linear-search", "Linear search", ["linear_search", "linearsearch"], "It checks each item in turn.", "O(n).", "linear_search"),
        curatedAlgorithm("jump-search", "Jump search", ["jump_search", "jumpsearch"], "It leaps ahead a block at a time.", "O(√n).", "jump_search"),
        curatedAlgorithm("interpolation-search", "Interpolation search", ["interpolation_search", "interpolationsearch"],
          "It estimates the position from the target's value.", "O(log log n) on even data.", "interpolation_search"),
      ] },
    ],
  },
});

/** The deck profile with the curated section: it configures an eight-round algorithm deck. */
export const loadCuratedProfile = (selection: Readonly<Record<string, number>> = {}): CrawlProfile => {
  const raw = JSON.parse(readFileSync(new URL("../../profiles/local-real-rounds.v4.json", import.meta.url), "utf8"));
  return parseCrawlProfile({ ...raw, selection: { ...raw.selection, ...selection }, curated: structuredClone(CURATED_SECTION) });
};

/** A body for each algorithm, long enough for a window and naming no other algorithm of its family. */
const ALGORITHM_BODIES: Readonly<Record<string, string>> = Object.freeze({
  bubble_sort: "    for end in range(len(items) - 1, 0, -1):\n        swapped = False\n        for i in range(end):\n            if items[i] > items[i + 1]:\n                items[i], items[i + 1] = items[i + 1], items[i]\n                swapped = True\n        if not swapped:\n            break\n    return items",
  insertion_sort: "    for index in range(1, len(items)):\n        value = items[index]\n        position = index\n        while position > 0 and items[position - 1] > value:\n            items[position] = items[position - 1]\n            position -= 1\n        items[position] = value\n    return items",
  selection_sort: "    for index in range(len(items) - 1):\n        smallest = index\n        for other in range(index + 1, len(items)):\n            if items[other] < items[smallest]:\n                smallest = other\n        items[index], items[smallest] = items[smallest], items[index]\n    return items",
  quick_sort: "    if len(items) < 2:\n        return items\n    pivot = items[len(items) // 2]\n    lower = [item for item in items if item < pivot]\n    same = [item for item in items if item == pivot]\n    upper = [item for item in items if item > pivot]\n    return quick_sort(lower) + same + quick_sort(upper)",
  binary_search: "    low, high = 0, len(items) - 1\n    while low <= high:\n        middle = (low + high) // 2\n        if items[middle] == target:\n            return middle\n        if items[middle] < target:\n            low = middle + 1\n        else:\n            high = middle - 1\n    return -1",
  linear_search: "    for index, item in enumerate(items):\n        if item == target:\n            return index\n    return -1\n\n\ndef count_matches(items, target):\n    return sum(1 for item in items if item == target)",
  jump_search: "    step = int(len(items) ** 0.5)\n    previous = 0\n    while previous < len(items) and items[min(previous + step, len(items)) - 1] < target:\n        previous += step\n    for index in range(previous, min(previous + step, len(items))):\n        if items[index] == target:\n            return index\n    return -1",
  interpolation_search: "    low, high = 0, len(items) - 1\n    while low <= high and items[low] <= target <= items[high]:\n        if items[high] == items[low]:\n            return low if items[low] == target else -1\n        guess = low + (target - items[low]) * (high - low) // (items[high] - items[low])\n        if items[guess] == target:\n            return guess\n        low, high = (guess + 1, high) if items[guess] < target else (low, guess - 1)\n    return -1",
});

/** A curated file's Python source: a docstring, the named function, and a script entry point to strip. */
export const curatedPythonSource = (stem: string): string => {
  const search = stem.endsWith("_search");
  return `"""Reference implementation."""\n\nimport math\n\n\ndef ${stem}(items${search ? ", target" : ""}):\n    """Doc for ${stem}.\n\n    >>> ${stem}([3, 1, 2]${search ? ", 2" : ""})\n    """\n${ALGORITHM_BODIES[stem]}\n\n\nif __name__ == "__main__":\n    print(${stem}([5, 4, 3]${search ? ", 4" : ""}))\n`;
};

/** The small profile's Python files; its Go files are absent, so a Go turn falls back to Python. */
export const curatedFiles = (): ReadonlyMap<string, string> => new Map(CURATED_SECTION.algorithm.families
  .flatMap(({ algorithms }) => algorithms.map((entry) => {
    const file = entry.files["algos/python"];
    return [`algos/python:${file.path}`, curatedPythonSource(file.path.split("/")[1]!.replace(/\.py$/u, ""))] as const;
  })));

/** Bound algorithm candidates for the small profile, as selection and the final snapshot would leave them. */
export const algorithmCandidates = (profile: CrawlProfile, snapshotId: string): readonly AlgorithmCandidate[] =>
  CURATED_SECTION.algorithm.families.flatMap((family) => family.algorithms.map((entry) => {
    const stem = entry.files["algos/python"].path.split("/")[1]!.replace(/\.py$/u, "");
    const window = algorithmWindow(curatedPythonSource(stem), "Python",
      { names: [entry.label, ...entry.names], symbols: [], words: labelWords(entry.label) },
      { maxLines: profile.screening.excerptLines, maxBytes: profile.screening.excerptBytes, minBytes: profile.screening.minimumExcerptBytes })!;
    const bytes = Buffer.from(curatedPythonSource(stem));
    return Object.freeze({
      familyId: family.id, algorithmId: entry.id, language: "Python" as const, repository: "algos/python",
      commit: CURATED_REPOSITORIES[0].commit, path: entry.files["algos/python"].path, blob: sha1(`curated-blob-${stem}`),
      rawContentHash: sha256(bytes.toString()), licenseName: "MIT License", licenseSpdx: "MIT",
      licenseFileUrl: `https://github.com/algos/python/blob/${CURATED_REPOSITORIES[0].commit}/LICENSE`,
      authorName: "Curated Author", authorLogin: "curated-author", authorCommit: sha1(`author-${stem}`),
      excerpt: window.excerpt, excerptHash: sha256(window.excerpt), functionName: window.functionName, crawlSnapshotId: snapshotId,
    });
  }));
