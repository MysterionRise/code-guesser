import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { generateAlgorithmRounds, type AlgorithmCandidate } from "../algorithm-rounds";
import { doctestFunctions, roundExamples } from "../doctest-parse";
import { balancedAnswers, generateOutputRounds, outputPane, type OutputCandidate } from "../output-rounds";
import { gapChoices, gapSlack } from "../missing-line-window";
import { generateMissingLineRounds, type MissingLineCandidate } from "../missing-line-rounds";
import { nameChoices, nameExtremeLimits, nameSlack } from "../name-function-window";
import { generateNameFunctionRounds, type NameFunctionCandidate } from "../name-function-rounds";
import { generateExerciseRounds, type ExerciseCandidate } from "../exercise-rounds";
import { generateFixRounds, type FixCandidate } from "../fix-rounds";
import { generateFrameworkRounds, type FrameworkCandidate } from "../framework-rounds";
import { generateVulnerableLineRounds, type VulnerableLineCandidate } from "../vulnerable-line-rounds";
import { frameworkWindow } from "../framework-window";
import { changeKind, fixWindows } from "../fix-window";
import type { AdvisoryPointer } from "../github-advisories";
import type { DatasetBug } from "../github-fixes";
import { fixExtremeLimits, fixSlack, labelStems } from "../model";
import { balancedChoice } from "../round-helpers";
import { FIX_WINDOW_LINES } from "../select-fix";
import { generateBeforeAfterRounds } from "../before-after-rounds";
import { algorithmWindow, exerciseWindow } from "../function-windows";
import { canonicalBytes, canonicalHash } from "../canonical";
import type { ComposeOptions } from "../compose";
import type { GitHubAdmissionCandidate } from "../github-admission";
import { generateLanguageRounds } from "../language-rounds";
import { LANGUAGE_SLUGS } from "../../../../packages/artifact/src/index";
import { MAINSTREAM_LANGUAGES, STACK_EXTENSIONS, STACK_LANGUAGES, parseCrawlProfile, type CrawlProfile, type StackLanguage } from "../profile";
import { generateProjectRounds, type ProjectRoundInput, type RepositoryOption } from "../project-rounds";
import type { RevalidatedStackCandidate } from "../stack-revalidation";

export const sha1 = (seed: string): string => createHash("sha1").update(seed).digest("hex");
export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** The run's profile without its curated section: the three decks built from The Stack v2 and GitHub search. */
export const loadDeckProfile = (): CrawlProfile => {
  const { curated: _curated, ...raw } = JSON.parse(readFileSync(new URL("../../profiles/local-real-rounds.v5.json", import.meta.url), "utf8"));
  return parseCrawlProfile(raw);
};

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
const LANGUAGE_FIXTURES: Readonly<Partial<Record<StackLanguage, readonly Readonly<{ path: string; excerpt: string }>[]>>> = Object.freeze({
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
  // The rarer languages (v1.0), each showing its own syntax and none of its look-alike's.
  Haskell: [
    { path: "src/Ledger.hs", excerpt: "total :: [Int] -> Int\ntotal entries = foldr add 0 entries\n  where\n    add amount running = amount + running\n\naverage :: [Int] -> Int\naverage entries = total entries `div` length entries" },
    { path: "src/Compute.hs", excerpt: "compute :: Int -> Maybe Int\ncompute value = do\n  let doubled = value * 2\n  if doubled > 10 then Just (doubled - 1) else Nothing\n\nhalve :: Int -> Int\nhalve value = value `div` 2" },
  ],
  Elm: [
    { path: "src/Ledger.elm", excerpt: "total : List Int -> Int\ntotal entries =\n    List.foldl (+) 0 entries\n\n\ntype alias Entry =\n    { amount : Int, note : String }" },
    { path: "src/Counter.elm", excerpt: "update : Msg -> Model -> ( Model, Cmd Msg )\nupdate msg model =\n    case msg of\n        Increment ->\n            ( { model | count = model.count + 1 }, Cmd.none )" },
  ],
  OCaml: [
    { path: "lib/ledger.ml", excerpt: "let total entries =\n  List.fold_left (fun acc amount -> acc + amount) 0 entries\n;;\n\nlet print_total entries =\n  Printf.printf \"%d\\n\" (total entries)" },
    { path: "lib/compute.ml", excerpt: "let compute ~scale value =\n  let doubled = value * scale in\n  if doubled > 10 then doubled - 1 else doubled + 1\n\nlet halve value = compute ~scale:1 value / 2" },
  ],
  "F#": [
    { path: "src/Ledger.fs", excerpt: "type Ledger() =\n    let mutable entries = []\n    member this.Add(amount: int) =\n        entries <- amount :: entries\n        List.sum entries" },
    { path: "src/Compute.fs", excerpt: "let compute value =\n    let doubled = value * 2\n    if doubled > 10 then doubled - 1\n    elif doubled < 0 then 0\n    else doubled + 1\n\nprintfn \"%d\" (compute 4)" },
  ],
  Erlang: [
    { path: "src/ledger.erl", excerpt: "total(Entries) ->\n    lists:foldl(fun(Amount, Sum) -> Amount + Sum end, 0, Entries).\n\nprint_total(Entries) ->\n    io:format(\"~p~n\", [total(Entries)])." },
    { path: "src/counter.erl", excerpt: "loop(Count) ->\n    receive\n        {add, N} -> loop(Count + N);\n        {get, From} -> From ! {count, Count}, loop(Count)\n    end." },
  ],
  Prolog: [
    { path: "src/ledger.pl", excerpt: "total([], 0).\ntotal([Amount|Rest], Sum) :-\n    total(Rest, Partial),\n    Sum is Partial + Amount.\n\naverage(Entries, Mean) :-\n    total(Entries, Sum),\n    length(Entries, Count),\n    Mean is Sum / Count." },
    { path: "src/family.pl", excerpt: "parent(tom, bob).\nparent(bob, ann).\nparent(ann, joe).\n\ngrandparent(X, Z) :-\n    parent(X, Y),\n    parent(Y, Z).\n\nancestor(X, Y) :- parent(X, Y)." },
  ],
  Clojure: [
    { path: "src/ledger/core.clj", excerpt: "(defn total [entries]\n  (reduce + 0 entries))\n\n(defn add-entry [ledger amount]\n  (update ledger :entries conj amount))" },
    { path: "src/ledger/compute.clj", excerpt: "(defn compute [value]\n  (let [doubled (* value 2)]\n    (if (> doubled 10)\n      (dec doubled)\n      (inc doubled))))" },
  ],
  Racket: [
    { path: "private/ledger.rkt", excerpt: "(define (total entries)\n  (foldl + 0 entries))\n\n(define (add-entry entries amount)\n  (cons amount entries))" },
    { path: "private/compute.rkt", excerpt: "(define (compute value)\n  (let ([doubled (* value 2)])\n    (cond\n      [(> doubled 10) (sub1 doubled)]\n      [else (add1 doubled)])))" },
  ],
  Julia: [
    { path: "src/ledger.jl", excerpt: "function total(entries::Vector{Int})\n    sum = 0\n    for amount in entries\n        sum += amount\n    end\n    return sum\nend" },
    { path: "src/compute.jl", excerpt: "function scale!(values, factor)\n    for i in eachindex(values)\n        values[i] = values[i] * factor\n    end\n    push!(values, factor)\nend" },
  ],
  MATLAB: [
    { path: "src/total.m", excerpt: "function result = total(entries)\n% Adds every entry.\nresult = 0;\nfor k = 1:numel(entries)\n    result = result + entries(k);\nend\nend" },
    { path: "src/compute.m", excerpt: "function [low, high] = compute(value)\ndoubled = value * 2;\nif doubled ~= 10\n    disp(doubled);\nend\nlow = doubled - 1;\nhigh = doubled + 1;\nend" },
  ],
  Ada: [
    { path: "src/ledger.adb", excerpt: "function Total (Entries : Amount_Array) return Integer is\n   Sum : Integer := 0;\nbegin\n   for I in Entries'Range loop\n      Sum := Sum + Entries (I);\n   end loop;\n   return Sum;\nend Total;" },
    { path: "src/compute.adb", excerpt: "procedure Compute (Value : in out Integer) is\nbegin\n   if Value > 10 then\n      Value := Value - 1;\n   elsif Value < 0 then\n      Value := 0;\n   end if;\nend Compute;" },
  ],
  Pascal: [
    { path: "src/ledger.pas", excerpt: "function Total(const Entries: array of Integer): Integer;\nvar\n  I: Integer;\nbegin\n  Result := 0;\n  for I := Low(Entries) to High(Entries) do\n    Result := Result + Entries[I];\nend;" },
    { path: "src/compute.pas", excerpt: "procedure Compute(var Value: Integer);\nbegin\n  if Value > 10 then begin\n    Value := Value - 1;\n    WriteLn(Value);\n  end;\nend;" },
  ],
  Elixir: [
    { path: "lib/ledger.ex", excerpt: "def total(entries) do\n  Enum.reduce(entries, 0, fn amount, sum -> amount + sum end)\nend\n\ndefp describe(total) do\n  \"total: #{total}\"\nend" },
    { path: "lib/counter.ex", excerpt: "def handle_call(:get, _from, count) do\n  {:reply, count, count}\nend\n\ndef increment(pid) do\n  pid |> GenServer.cast(:increment)\nend" },
  ],
  Crystal: [
    { path: "src/ledger.cr", excerpt: "class Ledger\n  property entries = [] of Int32\n\n  def add(amount : Int32) : Int32\n    entries << amount\n    entries.sum\n  end\nend" },
    { path: "src/compute.cr", excerpt: "def compute(values : Array(Int32))\n  values.map do |value|\n    value * 2\n  end\nend\n\ndef halve(value : Int32)\n  value // 2\nend\n\nputs compute([1, 2, 3])" },
  ],
});

/** A closing line that makes every variant's code distinct. */
const VARIANT_LINE: Readonly<Partial<Record<StackLanguage, (variant: number) => string>>> = Object.freeze({
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
  Haskell: (variant: number) => `limit${variant} = ${variant} :: Int`,
  Elm: (variant: number) => `limit${variant} = ${variant}`,
  OCaml: (variant: number) => `let limit_${variant} = ${variant}`,
  "F#": (variant: number) => `let limit${variant} = ${variant}`,
  Erlang: (variant: number) => `limit_${variant}() -> ${variant}.`,
  Prolog: (variant: number) => `limit(${variant}).`,
  Clojure: (variant: number) => `(def limit-${variant} ${variant})`,
  Racket: (variant: number) => `(define limit-${variant} ${variant})`,
  Julia: (variant: number) => `const LIMIT_${variant} = ${variant}`,
  MATLAB: (variant: number) => `limit${variant} = ${variant};`,
  Ada: (variant: number) => `Limit_${variant} : constant := ${variant};`,
  Pascal: (variant: number) => `const Limit${variant} = ${variant};`,
  Elixir: (variant: number) => `@limit_${variant} ${variant}`,
  Crystal: (variant: number) => `LIMIT_${variant} = ${variant}`,
});

/**
 * The deck profile reading every language (v1.0): the twelve as before, then the rarer pairs for the language deck
 * alone.
 */
export const loadRareLanguageProfile = (): CrawlProfile => {
  const raw = JSON.parse(readFileSync(new URL("../../profiles/local-real-rounds.v5.json", import.meta.url), "utf8"));
  const rare = STACK_LANGUAGES.slice(MAINSTREAM_LANGUAGES.length)
    .map((language) => ({ language, extensions: [...STACK_EXTENSIONS[language]], projectDeck: false }));
  return parseCrawlProfile({ ...raw, stack: { ...raw.stack, configurations: [...raw.stack.configurations, ...rare] } });
};

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
  const fixture = LANGUAGE_FIXTURES[language]![variant % 2]!;
  const path = fixture.path;
  const excerpt = `${fixture.excerpt}\n${VARIANT_LINE[language]!(variant)}`;
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
const PROJECT_OPTIONS: Readonly<Partial<Record<StackLanguage, readonly string[]>>> = Object.freeze({
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
  MAINSTREAM_LANGUAGES.flatMap((language) => {
    const options: RepositoryOption[] = PROJECT_OPTIONS[language]!.map((repository) => ({ repository, description: `A popular ${repository.split("/")[1]} toolkit.` }));
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
  language: MAINSTREAM_LANGUAGES.flatMap((language) => [0, 1].map((variant) => stackCandidate(profile, snapshotId, language, variant))),
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
      // A profile with a curated section adds the decks it configures.
      ...(profile.curated?.algorithm ? { algorithm: generateAlgorithmRounds({ profile, candidates: algorithmCandidates(profile, snapshotId) }) } : {}),
      ...(profile.curated?.output ? { output: generateOutputRounds({ profile, candidates: outputCandidates(profile, snapshotId) }) } : {}),
      ...(profile.curated?.fix ? { fix: generateFixRounds({ profile, candidates: fixCandidates(profile, snapshotId) }) } : {}),
      ...(profile.curated?.["missing-line"]
        ? { "missing-line": generateMissingLineRounds({ profile, candidates: missingLineCandidates(profile, snapshotId) }) } : {}),
      ...(profile.curated?.["name-function"]
        ? { "name-function": generateNameFunctionRounds({ profile, candidates: nameFunctionCandidates(profile, snapshotId) }) } : {}),
      ...(profile.curated?.framework
        ? { framework: generateFrameworkRounds({ profile, candidates: frameworkCandidates(profile, snapshotId) }) } : {}),
      ...(profile.curated?.exercise
        ? { exercise: generateExerciseRounds({ profile, candidates: exerciseCandidates(profile, snapshotId) }) } : {}),
      ...(profile.curated?.["vulnerable-line"]
        ? { "vulnerable-line": generateVulnerableLineRounds({ profile, candidates: vulnerableLineCandidates(profile, snapshotId) }) } : {}),
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
export const loadCuratedProfile = (
  selection: Readonly<Record<string, number>> = {},
  decks: Readonly<{ algorithm?: boolean; output?: boolean; fix?: boolean; "missing-line"?: boolean; "name-function"?: boolean;
    framework?: boolean; exercise?: boolean; "vulnerable-line"?: boolean }> = { algorithm: true },
): CrawlProfile => {
  const raw = JSON.parse(readFileSync(new URL("../../profiles/local-real-rounds.v5.json", import.meta.url), "utf8"));
  const curated = { repositories: [...CURATED_REPOSITORIES, ...(decks.framework ? [FRAMEWORK_REPOSITORY] : [])],
    ...(decks.algorithm ? { algorithm: CURATED_SECTION.algorithm } : {}),
    ...(decks.output ? { output: OUTPUT_SECTION } : {}), ...(decks.fix ? { fix: FIX_SECTION } : {}),
    ...(decks["missing-line"] ? { "missing-line": MISSING_LINE_SECTION } : {}),
    ...(decks["name-function"] ? { "name-function": NAME_FUNCTION_SECTION } : {}),
    ...(decks.framework ? { framework: FRAMEWORK_SECTION } : {}),
    ...(decks.exercise ? { exercise: EXERCISE_SECTION } : {}),
    ...(decks["vulnerable-line"] ? { "vulnerable-line": VULNERABLE_LINE_SECTION } : {}) };
  return parseCrawlProfile({ ...raw, selection: { ...raw.selection, ...selection }, curated: structuredClone(curated) });
};

/** An eight-round missing-line deck over the curated Python pin's `utils` directory (#57). */
export const MISSING_LINE_SECTION = Object.freeze({
  rounds: 8,
  repository: "algos/python",
  directories: ["utils"],
  fileReads: 14,
  windowLines: 8,
  templates: {
    title: "Missing line",
    description: "One line of a real function is hidden; pick the line that fills the gap.",
    prompt: "Which line fills the gap?",
    evidence: "Line {line} of {path} in {repository} reads this way.",
    explanation: "The answer is the file's own line; the others are lines from elsewhere in the same file.",
  },
});

/**
 * Twelve small modules of three functions each that share their names (`values`, `result`, `total`), as real code
 * does, so a decoy from another function can share as many names with a pane as the hidden line.
 */
export const missingLineFiles = (): ReadonlyMap<string, string> => new Map(Array.from({ length: 12 }, (_, index) => {
  const k = index + 3;
  const text = [
    `def scale_${k}(values, factor):`, "    result = []", "    for value in values:", `        result.append(value * factor + ${k})`,
    `        total = sum(result) + ${k}`, "    total = max(result)", "    return total", "",
    `def shift_${k}(values, offset):`, "    result = [0]", "    for value in reversed(values):", `        result.append(value - offset * ${k})`,
    `        total = len(result) - ${k}`, "    total = min(result)", `    return total + ${k}`, "",
    `def mix_${k}(values, other):`, "    result = [1]", "    for value, extra in zip(values, other):", `        result.append(value + extra * ${k})`,
    `        total = sum(result) * ${k}`, "    total = len(result)", `    return total - ${k}`, "",
  ].join("\n");
  return [`algos/python:utils/mod_${k}.py`, text] as const;
}));

/** Bound missing-line candidates for the small profile: the first files, each with the gap the balance search picks. */
export const missingLineCandidates = (profile: CrawlProfile, snapshotId: string): readonly MissingLineCandidate[] => {
  const deck = profile.curated!["missing-line"]!;
  const files = [...missingLineFiles()].slice(0, deck.rounds);
  const choices = files.map(([key, text]) => gapChoices(text, key, deck.windowLines).slice(0, 48));
  const picks = balancedChoice(choices.map((options) => options.map(({ ranks }) => ranks)), 4, gapSlack(files.length))!;
  return files.map(([key, text], index) => {
    const choice = choices[index]![picks[index]!]!;
    return Object.freeze({
      repository: "algos/python", commit: CURATED_REPOSITORIES[0].commit, path: key.slice("algos/python:".length),
      blob: sha1(`blob ${text}`), rawContentHash: sha256(text), licenseName: "MIT License", licenseSpdx: "MIT",
      licenseFileUrl: `https://github.com/algos/python/blob/${CURATED_REPOSITORIES[0].commit}/LICENSE`, authorName: "Curated Author",
      authorLogin: "curated-author", authorCommit: "c".repeat(40), language: "Python" as const, ...choice, excerptHash: sha256(choice.excerpt),
      crawlSnapshotId: snapshotId,
    });
  });
};

/** An eight-round name-the-function deck over the curated Go pin's `shapes` directory (#73). */
export const NAME_FUNCTION_SECTION = Object.freeze({
  rounds: 8,
  sources: [{ repository: "algos/go", directories: ["shapes"] }],
  fileReads: 12,
  functionLines: 12,
  templates: {
    title: "Name the function",
    description: "A real function with its name hidden; pick the name its author gave it.",
    prompt: "What did its author name this function?",
    evidence: "{path} in {repository} declares it as {name}.",
    explanation: "The answer is the name its author gave it; the others are functions declared beside it in the same file.",
  },
});

/** Twelve small Go files of six functions each, named in one, two, and three words, as real files are. */
export const nameFunctionFiles = (): ReadonlyMap<string, string> => new Map(Array.from({ length: 12 }, (_, index) => {
  const k = index + 3;
  const text = [
    "package shapes", "",
    "func scale(values []int, factor int) []int {", "\tout := make([]int, 0, len(values))", "\tfor _, v := range values {",
    `\t\tout = append(out, v*factor+${k})`, "\t}", "\treturn out", "}", "",
    "func total(values []int) int {", `\tsum := ${k}`, "\tfor _, v := range values {", "\t\tsum += v", "\t}", "\treturn sum", "}", "",
    "func largest(values []int) int {", `\tbest := values[0] + ${k}`, "\tfor _, v := range values {", "\t\tif v > best {", "\t\t\tbest = v",
    "\t\t}", "\t}", "\treturn best", "}", "",
    "func countAbove(values []int, limit int) int {", `\tn := ${k}`, "\tfor _, v := range values {", "\t\tif v > limit {", "\t\t\tn++",
    "\t\t}", "\t}", "\treturn n", "}", "",
    "func reverseOrder(values []int) []int {", `\tout := make([]int, len(values)+${k})`, "\tfor i, v := range values {",
    "\t\tout[len(values)-1-i] = v", "\t}", "\treturn out", "}", "",
    "func mergeSortedLists(left, right []int) []int {", `\tout := make([]int, 0, len(left)+len(right)+${k})`, "\tout = append(out, left...)",
    "\tout = append(out, right...)", "\treturn out", "}",
  ].join("\n");
  return [`algos/go:shapes/shape_${k}.go`, text] as const;
}));

/** Bound name-the-function candidates for the small profile: the first files, each with the function the balance picks. */
export const nameFunctionCandidates = (profile: CrawlProfile, snapshotId: string): readonly NameFunctionCandidate[] => {
  const deck = profile.curated!["name-function"]!;
  const files = [...nameFunctionFiles()].slice(0, deck.rounds);
  const choices = files.map(([key, text]) => nameChoices(text, "Go", key, deck.functionLines).slice(0, 96));
  const picks = balancedChoice(choices.map((options) => options.map(({ ranks }) => ranks)), 4, nameSlack(files.length),
    { costs: choices.map((options) => options.map(({ extremes }) => extremes)), limits: nameExtremeLimits(files.length) })!;
  return files.map(([key, text], index) => {
    const choice = choices[index]![picks[index]!]!;
    return Object.freeze({
      repository: "algos/go", commit: CURATED_REPOSITORIES[1].commit, path: key.slice("algos/go:".length),
      blob: sha1(`blob ${text}`), rawContentHash: sha256(text), licenseName: "MIT License", licenseSpdx: "MIT",
      licenseFileUrl: `https://github.com/algos/go/blob/${CURATED_REPOSITORIES[1].commit}/LICENSE`, authorName: "Curated Author",
      authorLogin: "curated-author", authorCommit: "c".repeat(40), language: "Go" as const, ...choice, excerptHash: sha256(choice.excerpt),
      crawlSnapshotId: snapshotId,
    });
  });
};

/**
 * A repository of one app built in many frameworks (#62), whose licence file GitHub names no licence for: its pin
 * declares MIT and pins the file.
 */
export const FRAMEWORK_REPOSITORY = Object.freeze({
  repository: "todo/examples", commit: sha1("todo-pin"), language: "JavaScript",
  license: { spdx: "MIT", path: "license.md", blob: sha1("todo-license") },
} as const);

const framework = (id: string, label: string, names: readonly string[], idea: string, files: readonly string[]) =>
  ({ id, label, names, symbols: [], idea, examples: [`examples/${id}`], files: files.map((file) => `examples/${id}/${file}`) });

/** An eight-round framework deck: two families of four, one round each. */
export const FRAMEWORK_SECTION = Object.freeze({
  rounds: 8,
  repository: "todo/examples",
  roundsPerFramework: 1,
  windowLines: 12,
  families: [
    { id: "components", note: "All four build the page from components that update when their state changes.", frameworks: [
      framework("react", "React", ["React"], "Components are functions that keep state in hooks and return markup.", ["src/item.jsx"]),
      framework("vue", "Vue", ["Vue"], "Templates carry directives on ordinary attributes, and the script declares refs.", ["src/Item.vue"]),
      framework("svelte", "Svelte", ["Svelte"], "A compiler makes plain variables reactive, and blocks open with a hash.", ["src/Item.svelte"]),
      framework("angular", "Angular", ["Angular"], "Classes carry decorators, and templates bind events in parentheses.", ["src/app/item.component.ts"]),
    ] },
    { id: "classics", note: "All four come from the first wave of front-end frameworks, with models, views, and bindings.", frameworks: [
      framework("backbone", "Backbone", ["Backbone"], "Views extend a base class and list their DOM events as selector strings.", ["js/views/todo-view.js"]),
      framework("ember", "Ember", ["Ember", "glimmer"], "Components keep tracked properties and use curly-brace modifiers.", ["app/components/todo-item.gjs"]),
      framework("knockout", "Knockout", ["Knockout"], "View models hold observables that are read by calling them.", ["js/app.js"]),
      framework("angularjs", "AngularJS", ["AngularJS"], "Controllers get services injected by name and share one scope object.", ["js/controllers/todo.js"]),
    ] },
  ],
  templates: {
    title: "Which framework?",
    description: "The same to-do app in many front-end frameworks, every name hidden: tell them apart by their idioms.",
    prompt: "Which framework is this to-do app written with?",
    evidence: "This is {path} in {repository}, the example built with {name}.",
    explanation: "Every example builds the same app, so only how each framework writes it tells them apart.",
  },
});

/** One small, idiomatic file per framework of the test deck, and a package manifest for some examples. */
export const frameworkFiles = (): ReadonlyMap<string, string> => new Map(Object.entries({
  "examples/react/package.json": "{ \"private\": true }\n",
  "examples/react/src/item.jsx": [
    "import { useState, useCallback } from \"react\";", "",
    "export function Item({ todo, onToggle }) {",
    "    const [editing, setEditing] = useState(false);",
    "    const toggle = useCallback(() => onToggle(todo.id), [onToggle, todo.id]);",
    "    return (",
    "        <li className={editing ? \"editing\" : \"\"}>",
    "            <input className=\"toggle\" type=\"checkbox\" checked={todo.done} onChange={toggle} />",
    "            <label onDoubleClick={() => setEditing(true)}>{todo.title}</label>",
    "        </li>",
    "    );",
    "}",
  ].join("\n"),
  "examples/vue/src/Item.vue": [
    "<script setup>", "import { ref } from 'vue'", "const props = defineProps(['todo'])", "const emit = defineEmits(['toggle'])",
    "const editing = ref(false)", "function toggle() {", "    emit('toggle', props.todo)", "}", "function edit() {", "    editing.value = true",
    "}", "</script>", "", "<template>", "    <li :class=\"{ editing }\">",
    "        <input type=\"checkbox\" class=\"toggle\" :checked=\"todo.done\" @change=\"toggle\" />",
    "        <label @dblclick=\"edit\">{{ todo.title }}</label>", "    </li>", "</template>",
  ].join("\n"),
  "examples/svelte/src/Item.svelte": [
    "<script>", "    let { item, onRemove } = $props();", "    let editing = $state(false);", "</script>", "",
    "<li class:completed={item.completed} class:editing>",
    "    <input class=\"toggle\" type=\"checkbox\" bind:checked={item.completed} />",
    "    <label ondblclick={() => (editing = true)}>{item.description}</label>",
    "    <button onclick={onRemove} class=\"destroy\"></button>",
    "    {#if editing}", "        <input class=\"edit\" value={item.description} />", "        <span>editing</span>", "    {/if}", "</li>",
  ].join("\n"),
  "examples/angular/src/app/item.component.ts": [
    "import { Component, EventEmitter, Input, Output } from '@angular/core';", "",
    "@Component({", "  selector: 'app-item',", "  standalone: true,", "  templateUrl: './item.component.html',", "})",
    "export class ItemComponent {", "  @Input({ required: true }) todo!: Todo;", "  @Output() remove = new EventEmitter<Todo>();",
    "  editing = false;", "", "  removeTodo(): void {", "    this.remove.emit(this.todo);", "  }", "}",
  ].join("\n"),
  "examples/backbone/js/views/todo-view.js": [
    "var app = app || {};", "", "(function ($) {", "\t'use strict';", "",
    "\tapp.TodoView = Backbone.View.extend({", "\t\ttagName: 'li',", "\t\tevents: {", "\t\t\t'click .toggle': 'toggleCompleted',",
    "\t\t\t'dblclick label': 'edit'", "\t\t},", "\t\tinitialize: function () {", "\t\t\tthis.listenTo(this.model, 'change', this.render);",
    "\t\t},", "\t\trender: function () {", "\t\t\tthis.$el.html(this.template(this.model.toJSON()));", "\t\t\treturn this;", "\t\t}",
    "\t});", "})(jQuery);",
  ].join("\n"),
  "examples/ember/package.json": "{ \"license\": \"MIT\" }\n",
  "examples/ember/app/components/todo-item.gjs": [
    "import Component from '@glimmer/component';", "import { tracked } from '@glimmer/tracking';", "",
    "export default class TodoItem extends Component {", "\t<template>", "\t\t<li class=\"{{if @todo.completed 'completed'}}\">",
    "\t\t\t<input class=\"toggle\" type=\"checkbox\" {{on \"change\" this.toggle}} />",
    "\t\t\t<label {{on \"dblclick\" this.edit}}>{{@todo.title}}</label>", "\t\t</li>", "\t</template>", "",
    "\t@tracked editing = false;", "", "\ttoggle = () => {", "\t\tthis.args.todo.completed = !this.args.todo.completed;", "\t};", "}",
  ].join("\n"),
  "examples/knockout/js/app.js": [
    "(function () {", "\t'use strict';", "", "\tvar Todo = function (title, completed) {", "\t\tthis.title = ko.observable(title);",
    "\t\tthis.completed = ko.observable(completed);", "\t\tthis.editing = ko.observable(false);", "\t};", "",
    "\tvar ViewModel = function (todos) {", "\t\tthis.todos = ko.observableArray(todos);", "\t\tthis.remaining = ko.computed(function () {",
    "\t\t\treturn this.todos().length;", "\t\t}.bind(this));", "\t};", "", "\tko.applyBindings(new ViewModel([]));", "}());",
  ].join("\n"),
  "examples/angularjs/js/controllers/todo.js": [
    "angular.module('todomvc')", "\t.controller('TodoCtrl', function TodoCtrl($scope, $location, store) {", "\t\t'use strict';", "",
    "\t\tvar todos = $scope.todos = store.todos;", "\t\t$scope.newTodo = '';", "",
    "\t\t$scope.$watch('todos', function () {", "\t\t\t$scope.remainingCount = todos.filter(function (todo) {",
    "\t\t\t\treturn !todo.completed;", "\t\t\t}).length;", "\t\t}, true);", "",
    "\t\t$scope.addTodo = function () {", "\t\t\ttodos.push({ title: $scope.newTodo.trim(), completed: false });",
    "\t\t\t$scope.newTodo = '';", "\t\t};", "\t});",
  ].join("\n"),
}).map(([path, text]) => [`todo/examples:${path}`, text] as const));

/** Bound framework candidates for the small profile: each framework's first file and its window. */
export const frameworkCandidates = (profile: CrawlProfile, snapshotId: string): readonly FrameworkCandidate[] => {
  const deck = profile.curated!.framework!;
  const every = deck.families.flatMap(({ frameworks }) => frameworks);
  const terms = { names: every.flatMap(({ label, names }) => [label, ...names]), symbols: every.flatMap(({ symbols }) => symbols) };
  const files = frameworkFiles();
  return deck.families.flatMap((family) => family.frameworks.map((entry) => {
    const path = entry.files[0]!;
    const text = files.get(`todo/examples:${path}`)!;
    const window = frameworkWindow(text, entry.id, family.frameworks.map(({ id }) => id), terms,
      { maxLines: deck.windowLines, maxBytes: profile.screening.excerptBytes, minBytes: profile.screening.minimumExcerptBytes })!;
    return Object.freeze({
      familyId: family.id, framework: entry.id, repository: "todo/examples", commit: FRAMEWORK_REPOSITORY.commit, path,
      blob: sha1(`blob ${text}`), rawContentHash: sha256(text), licenseName: "MIT License", licenseSpdx: "MIT",
      licenseFileUrl: `https://github.com/todo/examples/blob/${FRAMEWORK_REPOSITORY.commit}/license.md`, authorName: "Curated Author",
      authorLogin: "curated-author", authorCommit: "c".repeat(40), windowStart: window.windowStart, excerpt: window.excerpt,
      excerptHash: sha256(window.excerpt), marker: window.markers[0]!, crawlSnapshotId: snapshotId,
    });
  }));
};

/** An eight-round exercise deck (#58): two families of four, one round each, from the Python and Go pins' solutions. */
export const EXERCISE_SECTION = Object.freeze({
  rounds: 8,
  roundsPerExercise: 1,
  tracks: [
    { repository: "algos/python", solution: "exercises/practice/{slug}/.meta/example.py" },
    { repository: "algos/go", solution: "exercises/practice/{slug}/.meta/example.go" },
  ],
  families: [
    { id: "words", note: "All four read the letters of a word or phrase.", exercises: [
      { id: "isogram", label: "Isogram", names: ["isogram"], symbols: [], idea: "No letter may appear twice.", detail: "It takes a phrase and returns true or false." },
      { id: "pangram", label: "Pangram", names: ["pangram"], symbols: [], idea: "Every letter of the alphabet must appear.", detail: "It takes a sentence and returns true or false." },
      { id: "anagram", label: "Anagram", names: ["anagram"], symbols: [], idea: "It keeps the words made of the same letters as the target.", detail: "It takes a word and a list, and returns a list." },
      { id: "acronym", label: "Acronym", names: ["acronym"], symbols: [], idea: "It joins the first letter of every word.", detail: "It takes a phrase and returns a short string." },
    ] },
    { id: "numbers", note: "All four do arithmetic on whole integers.", exercises: [
      { id: "armstrong-numbers", label: "Armstrong numbers", names: ["armstrong"], symbols: [], idea: "Its digits, each raised to the digit count, add up to it.", detail: "It takes a number and returns true or false." },
      { id: "perfect-numbers", label: "Perfect numbers", names: ["perfect"], symbols: [], idea: "It compares a number with the sum of its divisors.", detail: "It takes a number and returns one of three classes." },
      { id: "collatz-conjecture", label: "Collatz conjecture", names: ["collatz", "conjecture"], symbols: [], idea: "It halves an even value and triples an odd one plus one, until it reaches one.", detail: "It takes a number and returns a count." },
      { id: "leap", label: "Leap", names: ["leap"], symbols: [], idea: "Divisible by four, except centuries not divisible by four hundred.", detail: "It takes a year and returns true or false." },
    ] },
  ],
  templates: {
    title: "Which exercise?",
    description: "A reference solution to an Exercism exercise, every name hidden: pick the exercise it solves.",
    prompt: "Which exercise does this code solve?",
    evidence: "This is {path} in {repository}, the reference solution to {name}.",
    explanation: "The answer is the exercise whose directory holds this solution.",
  },
});

const pythonSolutions: Readonly<Record<string, readonly string[]>> = {
  isogram: ["def is_isogram(phrase):", "    letters = [char.lower() for char in phrase if char.isalpha()]", "    seen = set()",
    "    for letter in letters:", "        if letter in seen:", "            return False", "        seen.add(letter)", "    return True"],
  pangram: ["from string import ascii_lowercase", "", "", "def is_pangram(sentence):",
    "    present = {char for char in sentence.lower() if char.isalpha()}",
    "    missing = [letter for letter in ascii_lowercase if letter not in present]", "    return len(missing) == 0"],
  anagram: ["def find_anagrams(word, candidates):", "    def letters(text):", "        return sorted(text.lower())", "",
    "    target = letters(word)", "    return [candidate for candidate in candidates",
    "            if candidate.lower() != word.lower() and letters(candidate) == target]"],
  acronym: ["import re", "", "", "def abbreviate(words):", "    parts = re.findall(r\"[A-Za-z][A-Za-z']*\", words)",
    "    initials = [part[0].upper() for part in parts]", "    return \"\".join(initials)"],
  "armstrong-numbers": ["def is_armstrong_number(number):", "    digits = [int(digit) for digit in str(number)]", "    power = len(digits)",
    "    total = sum(digit ** power for digit in digits)", "    return total == number"],
  "perfect-numbers": ["def classify(number):", "    if number < 1:", "        raise ValueError(\"only positive integers\")",
    "    aliquot = sum(divisor for divisor in range(1, number) if number % divisor == 0)", "    if aliquot == number:",
    "        return \"perfect\"", "    return \"abundant\" if aliquot > number else \"deficient\""],
  "collatz-conjecture": ["def steps(number):", "    if number < 1:", "        raise ValueError(\"Only positive integers are allowed\")",
    "    count = 0", "    while number != 1:", "        number = number // 2 if number % 2 == 0 else 3 * number + 1", "        count += 1",
    "    return count"],
  leap: ["def leap_year(year):", "    def divisible(divisor):", "        return year % divisor == 0", "", "    if divisible(400):",
    "        return True", "    if divisible(100):", "        return False", "    return divisible(4)"],
};
const goSolutions: Readonly<Record<string, readonly string[]>> = {
  pangram: ["package pangram", "", "import \"strings\"", "", "func IsPangram(input string) bool {", "\tlower := strings.ToLower(input)",
    "\tfor letter := 'a'; letter <= 'z'; letter++ {", "\t\tif !strings.ContainsRune(lower, letter) {", "\t\t\treturn false", "\t\t}", "\t}",
    "\treturn true", "}"],
  acronym: ["package acronym", "", "import \"strings\"", "", "func Abbreviate(s string) string {",
    "\tfields := strings.FieldsFunc(s, func(r rune) bool { return r == ' ' || r == '-' || r == '_' })", "\tvar initials strings.Builder",
    "\tfor _, field := range fields {", "\t\tinitials.WriteString(strings.ToUpper(field[:1]))", "\t}", "\treturn initials.String()", "}"],
  "perfect-numbers": ["package perfect", "", "type Classification int", "", "const (", "\tClassificationDeficient Classification = iota",
    "\tClassificationPerfect", "\tClassificationAbundant", ")", "", "func Classify(n int64) Classification {", "\tvar sum int64",
    "\tfor d := int64(1); d < n; d++ {", "\t\tif n%d == 0 {", "\t\t\tsum += d", "\t\t}", "\t}", "\tif sum == n {",
    "\t\treturn ClassificationPerfect", "\t}", "\tif sum > n {", "\t\treturn ClassificationAbundant", "\t}", "\treturn ClassificationDeficient", "}"],
  leap: ["package leap", "", "func divisible(year, by int) bool {", "\treturn year%by == 0", "}", "", "func IsLeapYear(year int) bool {",
    "\treturn divisible(year, 4) && (!divisible(year, 100) || divisible(year, 400))", "}"],
};

/** Reference solutions for the test deck: Python for every exercise, Go for those whose turn tries Go first. */
export const exerciseFiles = (): ReadonlyMap<string, string> => new Map([
  ...Object.entries(pythonSolutions).map(([slug, lines]) => [`algos/python:exercises/practice/${slug}/.meta/example.py`, lines.join("\n")] as const),
  ...Object.entries(goSolutions).map(([slug, lines]) => [`algos/go:exercises/practice/${slug}/.meta/example.go`, lines.join("\n")] as const),
]);

/** Bound exercise candidates for the small profile, chosen as the selector chooses: tracks take turns being tried first. */
export const exerciseCandidates = (profile: CrawlProfile, snapshotId: string, files = exerciseFiles()): readonly ExerciseCandidate[] => {
  const deck = profile.curated!.exercise!;
  const limits = { maxLines: profile.screening.excerptLines, maxBytes: profile.screening.excerptBytes, minBytes: profile.screening.minimumExcerptBytes };
  let turn = 0;
  return deck.families.flatMap((family) => {
    const terms = {
      names: family.exercises.flatMap(({ label, names }) => [label, ...names]), symbols: family.exercises.flatMap(({ symbols }) => symbols),
      stems: family.exercises.flatMap(({ label }) => labelStems(label)),
    };
    return family.exercises.map((entry) => {
      const order = deck.tracks.map((_, index) => deck.tracks[(turn + index) % deck.tracks.length]!);
      turn += 1;
      for (const track of order) {
        const path = track.solution.replace("{slug}", entry.id);
        const text = files.get(`${track.repository}:${path}`);
        const pin = CURATED_REPOSITORIES.find(({ repository }) => repository === track.repository)!;
        const window = text === undefined ? undefined : exerciseWindow(text, pin.language, terms, limits, [entry.label, ...entry.names]);
        if (!text || !window) continue;
        return Object.freeze({
          familyId: family.id, exercise: entry.id, language: pin.language, repository: pin.repository, commit: pin.commit, path,
          blob: sha1(`blob ${text}`), rawContentHash: sha256(text), licenseName: "MIT License", licenseSpdx: "MIT",
          licenseFileUrl: `https://github.com/${pin.repository}/blob/${pin.commit}/LICENSE`, authorName: "Curated Author",
          authorLogin: "curated-author", authorCommit: "c".repeat(40), windowStart: window.windowStart, excerpt: window.excerpt,
          excerptHash: sha256(window.excerpt), crawlSnapshotId: snapshotId,
        });
      }
      throw new Error(`no solution for ${entry.id}`);
    });
  });
};

/** An eight-round output deck over the curated Python pin's `maths` and `strings` directories. */
export const OUTPUT_SECTION = Object.freeze({
  rounds: 8,
  repository: "algos/python",
  directories: ["maths", "strings"],
  fileReads: 14,
  templates: {
    title: "Predict the output",
    description: "Read a short Python function and predict what one call of it returns.",
    prompt: "What does the last line show?",
    evidence: "The docstring in {path} of {repository} records {call} as {output}.",
    explanation: "The answer is the output the function's own doctest records.",
  },
});

const doctested = (name: string, parameter: string, body: string, examples: readonly (readonly [string, string])[]): string =>
  `"""A small module."""\n\n\ndef ${name}(${parameter}):\n    """Example.\n\n${examples.map(([argument, output]) =>
    `    >>> ${name}(${argument})\n    ${output}\n`).join("")}    """\n    # Work it out.\n${body}\n`;
/**
 * Files an output deck can read: six number modules and four string modules with four doctests each, a module
 * without doctests, and a test module, under `algos/python`'s `maths` and `strings` directories.
 */
export const outputFiles = (): ReadonlyMap<string, string> => new Map([
  ...[10, 20, 30, 40, 50, 60].map((step) => [`algos/python:maths/add_${step}.py`, doctested(`add_${step}`, "value: int",
    `    total = value\n    total += ${step}\n    return total`, [1, 2, 3, 4].map((value) => [String(value), String(value + step)] as const))] as const),
  ...[2, 3, 4, 5].map((times) => [`algos/python:strings/repeat_${times}.py`, doctested(`repeat_${times}`, "text: str",
    `    copies = [text] * ${times}\n    return "".join(copies)`, ["a", "b", "c", "d"].map((letter) => [`"${letter}"`, `'${letter.repeat(times)}'`] as const))] as const),
  ["algos/python:maths/notes.py", `"""No doctests."""\n\n\ndef half(value):\n    return value // 2\n`],
  ["algos/python:maths/test_add.py", doctested("add_9", "value", "    return value + 9", [1, 2, 3, 4].map((value) => [String(value), String(value + 9)] as const))],
]);

/** Bound output candidates for the small profile: the first eight usable files in hash order, answers balanced over every rank. */
export const outputCandidates = (profile: CrawlProfile, snapshotId: string): readonly OutputCandidate[] => {
  const files = [...outputFiles()].filter(([key]) => !key.includes("/test_") && !key.endsWith("notes.py"))
    .sort(([left], [right]) => sha256(left) < sha256(right) ? -1 : 1).slice(0, profile.curated!.output!.rounds)
    .map(([key, text]) => {
      const found = doctestFunctions(text, { maxLines: profile.screening.excerptLines })[0]!;
      return { key, text, found, examples: roundExamples(found.examples)! };
    });
  const answers = balancedAnswers(files.map(({ examples }) => examples))!;
  return files.map(({ key, text, found, examples }, index) => {
    const path = key.slice("algos/python:".length);
    const answer = examples[answers[index]!]!;
    const excerpt = outputPane(found.code, answer.call);
    return Object.freeze({
      repository: "algos/python", commit: CURATED_REPOSITORIES[0].commit, path, blob: sha1(`output-blob-${path}`),
      rawContentHash: sha256(text), licenseName: "MIT License", licenseSpdx: "MIT",
      licenseFileUrl: `https://github.com/algos/python/blob/${CURATED_REPOSITORIES[0].commit}/LICENSE`,
      authorName: "Curated Author", authorLogin: "curated-author", authorCommit: sha1(`author-${path}`),
      functionName: found.name, code: found.code, answer, decoys: examples.filter((example) => example !== answer),
      excerpt, excerptHash: sha256(excerpt), crawlSnapshotId: snapshotId,
    });
  });
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
      { names: [entry.label, ...entry.names], symbols: [], stems: family.algorithms.flatMap(({ label }) => labelStems(label)) },
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

/** An eight-round fix deck over two small Java projects (as Defects4J) and two Python projects (as BugsInPy). */
export const FIX_SECTION = Object.freeze({
  rounds: 8,
  datasets: [
    { id: "defects4j", repository: "bugs/d4j", commit: sha1("d4j-pin"), projects: [
      { name: "Calc", repository: "calc/calc", language: "Java" }, { name: "Text", repository: "text/text", language: "Java" },
    ] },
    { id: "bugsinpy", repository: "bugs/bip", commit: sha1("bip-pin"), projects: [
      { name: "kit", repository: "kit/kit", language: "Python" }, { name: "tool", repository: "tool/tool", language: "Python" },
    ] },
  ],
  patchReads: 20,
  perRepository: 3,
  templates: {
    title: "Spot the fix",
    description: "Read code just before a real one-line bug fix and pick the line the fix changed.",
    prompt: "Which line did the fix change?",
    evidence: "{dataset} records bug {bug} in {repository}; the fix changed line {line} of this excerpt.",
    explanation: "The answer is the one line the upstream fix commit changed in this file.",
  },
});

/** One synthetic bug: the file before its fix, the line the fix changed, and the dataset's record of it. */
export interface SyntheticFix {
  readonly dataset: "defects4j" | "bugsinpy";
  readonly project: string;
  readonly bug: string;
  readonly repository: string;
  readonly language: "Java" | "Python";
  readonly path: string;
  readonly text: string;
  readonly changedLine: number;
  readonly buggyLine: string;
  readonly fixedLine: string;
  readonly parent: string;
  readonly fixCommit: string;
  readonly patch: string;
}

/** Lengths of the lines around a synthetic fix, alternately shorter and longer than the changed line's. */
const FILLER_OFFSETS = [-10, 8, -6, 4, -3, 10, -8, 6, -4, 3, -12, 12, -2, 2] as const;
/**
 * A 27-line file whose line 14 is `changed` and whose other lines are filler assignments, alternately smaller and
 * larger than it in every way a solver might rank lines: shorter, simpler, less indented, and with no word of its
 * own; or longer, busier, more indented, and with four words of its own. A window can then place the changed line
 * at any rank by position, centrality, length, and complexity, and in the middle of every line feature.
 */
const syntheticFile = (language: StackLanguage, changed: string): string => Array.from({ length: 27 }, (_, index) => {
  if (index === 13) return changed;
  const offset = FILLER_OFFSETS[index % FILLER_OFFSETS.length]!;
  const length = changed.trim().length + offset;
  const end = language === "Python" ? "" : ";";
  const indent = " ".repeat(changed.length - changed.trimStart().length);
  if (offset < 0) {
    const pad = "a".repeat(Math.max(1, Math.floor((length - 11 - end.length) / 2)));
    return `${indent.slice(4)}x = "${pad}" + "${pad}"${end}`;
  }
  const body = `v${index} = (w${index} - u${index}) * (k - z${index}) + "`;
  return `${indent}    ${body}${"a".repeat(Math.max(1, length - body.length - 1 - end.length))}"${end}`;
}).join("\n");
/** A unified diff of one changed line; Defects4J's run from fixed to buggy, BugsInPy's from buggy to fixed. */
const linePatch = (path: string, line: number, before: string, after: string, direction: "forward" | "reverse"): string => {
  const [removed, added] = direction === "forward" ? [before, after] : [after, before];
  return [`diff --git a/${path} b/${path}`, "index 1111111..2222222 100644", `--- a/${path}`, `+++ b/${path}`,
    `@@ -${line - 1},3 +${line - 1},3 @@`, " context above", `-${removed}`, `+${added}`, " context below", ""].join("\n");
};

/** Twelve one-line bugs, three per repository, and their files before the fix. */
export const syntheticFixes = (): readonly SyntheticFix[] => [
  ...(["Calc", "Text"] as const).flatMap((project, projectIndex) => [1, 2, 3].map((id) => {
    const name = `${project}${id}`;
    const path = `src/${project.toLowerCase()}/${name}.java`;
    const factor = 10 + id + projectIndex * 10;
    const buggyLine = `        total = total + step * ${factor};`;
    const fixedLine = `        total = total + step * ${factor + 1};`;
    return { dataset: "defects4j" as const, project, bug: `${project}-${id}`, repository: `${project.toLowerCase()}/${project.toLowerCase()}`,
      language: "Java" as const, path, text: syntheticFile("Java", buggyLine), changedLine: 14, buggyLine, fixedLine,
      parent: sha1(`parent-${name}`), fixCommit: sha1(`fix-${name}`), patch: linePatch(path, 14, buggyLine, fixedLine, "reverse") };
  })),
  ...(["kit", "tool"] as const).flatMap((project, projectIndex) => [1, 2, 3].map((id) => {
    const name = `${project}${id}`;
    const path = `${project}/${name}.py`;
    const offset = 10 + id + projectIndex * 10;
    const buggyLine = `    offset = len(result) + ${offset}`;
    const fixedLine = `    offset = len(result) - ${offset}`;
    return { dataset: "bugsinpy" as const, project, bug: `${project}-${id}`, repository: `${project}/${project}`,
      language: "Python" as const, path, text: syntheticFile("Python", buggyLine), changedLine: 14, buggyLine, fixedLine,
      parent: sha1(`parent-${name}`), fixCommit: sha1(`fix-${name}`), patch: linePatch(path, 14, buggyLine, fixedLine, "forward") };
  })),
];

/** What the harness serves for the fix deck: the bugs each dataset lists, the blobs they point to, and each fix upstream. */
export interface FixHarnessData {
  readonly bugs: readonly DatasetBug[];
  readonly blobs: ReadonlyMap<string, string>;
  readonly fixes: readonly SyntheticFix[];
}
export const fixHarnessData = (): FixHarnessData => {
  const fixes = syntheticFixes();
  const blobs = new Map<string, string>();
  const blobOf = (text: string): string => { const id = sha1(`blob ${text}`); blobs.set(id, text); return id; };
  const table = (project: string) => blobOf(["bug.id,revision.id.buggy,revision.id.fixed,report.id,report.url",
    ...fixes.filter((fix) => fix.project === project).map((fix) => `${fix.bug.split("-")[1]},${fix.parent},${fix.fixCommit},R-1,https://example.org/R-1`),
    `9,${sha1("w")},${sha1("x")},R-9,https://example.org/R-9`, ""].join("\n"));
  const tables = new Map(["Calc", "Text"].map((project) => [project, table(project)]));
  const bugs: DatasetBug[] = fixes.map((fix) => ({
    dataset: fix.dataset, project: fix.project, bug: fix.bug, patchBlob: blobOf(fix.patch), patchSize: fix.patch.length,
    revisionsBlob: fix.dataset === "defects4j" ? tables.get(fix.project)!
      : blobOf(`python_version="3.8.3"\nbuggy_commit_id="${fix.parent.slice(0, 7)}"\nfixed_commit_id="${fix.fixCommit}"\ntest_file="tests/test_${fix.project}.py"\n`),
  }));
  // A patch that changes two lines, read and set aside, and one too long to read at all.
  const wide = `${fixes[0]!.patch}-    second line\n+    second line changed\n`;
  bugs.push({ dataset: "defects4j", project: "Calc", bug: "Calc-9", patchBlob: blobOf(wide), patchSize: wide.length, revisionsBlob: tables.get("Calc")! });
  bugs.push({ dataset: "defects4j", project: "Text", bug: "Text-9", patchBlob: sha1("never-read"), patchSize: 5_000, revisionsBlob: tables.get("Text")! });
  return { bugs, blobs, fixes };
};

/** Bound fix candidates for the small profile: four per dataset, windows chosen so the answers balance. */
export const fixCandidates = (profile: CrawlProfile, snapshotId: string): readonly FixCandidate[] => {
  const fixes = syntheticFixes();
  const chosen = [...fixes.filter(({ dataset }) => dataset === "defects4j").slice(0, 4), ...fixes.filter(({ dataset }) => dataset === "bugsinpy").slice(0, 4)];
  const windows = chosen.map((fix) => fixWindows(fix.text, fix.changedLine, `${fix.dataset}:${fix.bug}`, FIX_WINDOW_LINES, fix.language));
  const choices = balancedChoice(windows.map((options) => options.map(({ ranks }) => ranks)), 4, fixSlack(chosen.length),
    { costs: windows.map((options) => options.map(({ extremes }) => extremes)), limits: fixExtremeLimits(chosen.length) })!;
  return chosen.map((fix, index) => {
    const window = windows[index]![choices[index]!]!;
    return Object.freeze({
      dataset: fix.dataset, bugId: fix.bug, repository: fix.repository, language: fix.language, commit: fix.parent,
      fixCommit: fix.fixCommit, path: fix.path, blob: sha1(`buggy-${fix.bug}`), fixBlob: sha1(`fixed-${fix.bug}`),
      rawContentHash: sha256(fix.text), licenseName: "MIT License", licenseSpdx: "MIT",
      licenseFileUrl: `https://github.com/${fix.repository}/blob/${fix.parent}/LICENSE`, authorName: "Fix Author", authorLogin: "fix-author",
      buggyLine: fix.buggyLine, fixedLine: fix.fixedLine, changedLine: fix.changedLine, changeKind: changeKind(fix.buggyLine, fix.fixedLine),
      windowStart: window.windowStart, answer: window.answer, decoys: window.decoys, excerpt: window.excerpt,
      excerptHash: sha256(window.excerpt), crawlSnapshotId: snapshotId,
    });
  });
};

/** An eight-round vulnerable-line deck (#59) over two ecosystems' advisories in two publication windows. */
export const VULNERABLE_LINE_SECTION = Object.freeze({
  rounds: 8,
  ecosystems: ["pip", "npm"],
  published: ["2024-01-01..2024-06-30", "2024-07-01..2024-12-31"],
  commitReads: 20,
  cwes: [
    { id: "CWE-22", hint: "A path built from outside input can climb out of the directory it was meant for." },
    { id: "CWE-79", hint: "Text from outside reaches a page without being escaped." },
  ],
  templates: {
    title: "Spot the vulnerable line",
    description: "Read code just before a real one-line security fix and pick the line that was vulnerable.",
    prompt: "A security fix changed one of these lines. Which one was vulnerable?",
    evidence: "GitHub advisory {advisory} ({cwe}) links the fix in {repository}; it changed line {line} of this excerpt.",
    explanation: "The answer is the one line the advisory's fix commit replaced. Advisory data: GitHub Advisory Database, CC-BY 4.0.",
  },
});

const GHSA_ALPHABET = "23456789cfghjmpqrvwx";
/** A well-formed advisory id for a synthetic advisory. */
export const syntheticAdvisory = (index: number): string => {
  const group = (offset: number) => Array.from({ length: 4 }, (_, at) => GHSA_ALPHABET[(index * 7 + offset + at) % GHSA_ALPHABET.length]).join("");
  return `GHSA-${group(0)}-${group(4)}-${group(8)}`;
};

/** One synthetic advisory fix: a one-line change in its own repository, as the harness's fix binder serves it. */
export interface SyntheticAdvisoryFix {
  readonly advisory: string;
  readonly ecosystem: "pip" | "npm";
  readonly repository: string;
  readonly language: "Python" | "JavaScript";
  readonly path: string;
  readonly text: string;
  readonly changedLine: number;
  readonly buggyLine: string;
  readonly fixedLine: string;
  readonly parent: string;
  readonly fixCommit: string;
  readonly bug: string;
}

/** Ten one-line advisory fixes, in ten repositories, alternately Python on pip and JavaScript on npm. */
export const syntheticAdvisoryFixes = (): readonly SyntheticAdvisoryFix[] => Array.from({ length: 10 }, (_, index) => {
  const python = index % 2 === 0;
  const name = `app${index + 1}`;
  // As the fix deck's synthetic lines, three words used once each, so a window can rank them anywhere among the filler.
  const buggyLine = python ? `    target = join(root) + ${10 + index}` : `    html = render(text) + ${10 + index};`;
  const fixedLine = python ? `    target = join(safe(root)) + ${10 + index}` : `    html = escape(text) + ${10 + index};`;
  const language = python ? "Python" as const : "JavaScript" as const;
  return Object.freeze({
    advisory: syntheticAdvisory(index), ecosystem: python ? "pip" as const : "npm" as const, repository: `vuln/${name}`, language,
    path: python ? `${name}/views.py` : `lib/${name}.js`, text: syntheticFile(language, buggyLine), changedLine: 14, buggyLine, fixedLine,
    parent: sha1(`parent-${name}`), fixCommit: sha1(`fix-${name}`), bug: syntheticAdvisory(index),
  });
});

const advisoryPointer = (fix: Pick<SyntheticAdvisoryFix, "advisory" | "ecosystem" | "repository" | "fixCommit">, index: number,
  overrides: Partial<AdvisoryPointer> = {}): AdvisoryPointer => Object.freeze({
  advisory: fix.advisory, ecosystem: fix.ecosystem, packages: [`pkg-${index + 1}`], cwes: [index % 2 === 0 ? "CWE-22" : "CWE-79"],
  commits: [{ repository: fix.repository, commit: fix.fixCommit }], withdrawn: false, ...overrides,
});

/** What the harness serves for the vulnerable-line deck: each listing's advisories, their windows, and each fix upstream. */
export interface AdvisoryHarnessData {
  readonly listed: readonly AdvisoryPointer[];
  readonly published: ReadonlyMap<string, string>;
  readonly fixes: readonly SyntheticAdvisoryFix[];
}
/**
 * The ten fixes' advisories, and four more a deck sets aside before or after reading the commit: one withdrawn, one
 * linking two commits, one under a CWE the profile has no hint for, and one whose commit changes more than one line.
 */
export const advisoryHarnessData = (): AdvisoryHarnessData => {
  const fixes = syntheticAdvisoryFixes();
  const extra = (index: number, overrides: Partial<AdvisoryPointer>) =>
    advisoryPointer({ advisory: syntheticAdvisory(index), ecosystem: "pip", repository: `vuln/extra${index}`, fixCommit: sha1(`extra-${index}`) }, index, overrides);
  const listed = [
    ...fixes.map((fix, index) => advisoryPointer(fix, index)),
    extra(11, { withdrawn: true }),
    extra(12, { commits: [{ repository: "vuln/extra12", commit: sha1("extra-12a") }, { repository: "vuln/extra12", commit: sha1("extra-12b") }] }),
    extra(13, { cwes: ["CWE-999"] }),
    extra(14, {}),
  ];
  return { listed, fixes, published: new Map(listed.map((advisory, index) => [advisory.advisory, VULNERABLE_LINE_SECTION.published[index % 2]!])) };
};

/** Bound vulnerable-line candidates for the small profile: eight of the fixes, windows chosen so the answers balance. */
export const vulnerableLineCandidates = (profile: CrawlProfile, snapshotId: string): readonly VulnerableLineCandidate[] => {
  const chosen = syntheticAdvisoryFixes().slice(0, 8);
  const windows = chosen.map((fix) => fixWindows(fix.text, fix.changedLine, `advisory:${fix.advisory}`, FIX_WINDOW_LINES, fix.language));
  const choices = balancedChoice(windows.map((options) => options.map(({ ranks }) => ranks)), 4, fixSlack(chosen.length),
    { costs: windows.map((options) => options.map(({ extremes }) => extremes)), limits: fixExtremeLimits(chosen.length) })!;
  return chosen.map((fix, index) => {
    const window = windows[index]![choices[index]!]!;
    return Object.freeze({
      advisory: fix.advisory, ecosystem: fix.ecosystem, packageName: `pkg-${index + 1}`, cwe: index % 2 === 0 ? "CWE-22" : "CWE-79",
      repository: fix.repository, language: fix.language, commit: fix.parent, fixCommit: fix.fixCommit, path: fix.path,
      blob: sha1(`buggy-${fix.bug}`), fixBlob: sha1(`fixed-${fix.bug}`), rawContentHash: sha256(fix.text), licenseName: "MIT License",
      licenseSpdx: "MIT", licenseFileUrl: `https://github.com/${fix.repository}/blob/${fix.parent}/LICENSE`, authorName: "Fix Author",
      authorLogin: "fix-author", buggyLine: fix.buggyLine, fixedLine: fix.fixedLine, changedLine: fix.changedLine,
      windowStart: window.windowStart, answer: window.answer, decoys: window.decoys, excerpt: window.excerpt,
      excerptHash: sha256(window.excerpt), crawlSnapshotId: snapshotId,
    });
  });
};
