import { mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fetchSelectedBlob } from "./blob-worker";
import { canonicalHash } from "./canonical";
import { CapacityError, createCapacityMeter } from "./capacity";
import { GitHubSearchError } from "./github-search";
import { JournalError, openJournal } from "./journal";
import { HARNESS_CANDIDATES, accepted, classificationsFor, harnessRow, hash, loadProfile, makeHarness } from "./command-test-harness";
import {
  CURATED_REPOSITORIES, CURATED_SECTION, FIX_SECTION, OUTPUT_SECTION, advisoryHarnessData, curatedFiles, exerciseFiles, fixHarnessData, frameworkFiles, loadCuratedProfile, missingLineFiles, nameFunctionFiles, outputFiles, sha256, swapOutputFile,
} from "./testdata/deck-builders";
import { LANGUAGE_SLUGS } from "../../../packages/artifact/src/index";
import { MAINSTREAM_LANGUAGES, parseCrawlProfile } from "./profile";
import { createRetryController, RetryError } from "./retry";
import { createRunReport } from "./run-report";
import { workerStage } from "./runtime";
import { collectStackMetadata, StackMetadataError, type StackMetadataRow } from "./stack-metadata";
import { TransportError } from "./transport";
import { journaledWorker } from "./worker-journal";
import {
  prepareLocalExperiment,
  projectPreparationEnvironment,
  runPreparationCli,
  type PreparationDependencies,
  type PreparationResult,
} from "./index";

const testModuleName: string = "vitest";
const { afterEach, describe, expect, it } = await import(testModuleName) as any;
const COMMAND_MODULES = ["index", "pipeline", "dependencies", "runtime", "selection", "select-github", "select-stack", "diagnostics", "types"];
const sourceOf = (module: string) => readFile(new URL(`./${module}.ts`, import.meta.url), "utf8");
const originalArguments = [...process.argv];
afterEach(() => { process.argv.splice(0, process.argv.length, ...originalArguments); });
const admittedWith = (candidate: any, source: Record<string, unknown> = {}) => accepted({
  admissionDecision: "AUTOMATED_POC_ADMISSION_ONLY", lineage: candidate, source: {
    repository: candidate.repository, commit: String(candidate.id).padStart(40, "c"), path: `src/file-${candidate.id}.ts`,
    blob: String(candidate.id).padStart(40, "b"), rawContentHash: String(candidate.id).padStart(64, "r"),
    excerptHash: String(candidate.id).padStart(64, "e"), queryId: candidate.queryId, ...source,
  },
}, "4");
const slugOf = (language: string): string => LANGUAGE_SLUGS[language as keyof typeof LANGUAGE_SLUGS];
/** Each language's four popular rows (the project deck's) followed by the given ordinary rows (the language deck's). */
const popularRows = (language: string) => [0, 1, 2, 3].map((rank) =>
  harnessRow(language, `${slugOf(language)}-pop-${rank}`, { starEventsCount: 9000 - rank * 1000 }));
/** A language's two default ordinary rows: the language deck's two rounds of it. */
const ordinaryRows = (language: string) => [harnessRow(language, slugOf(language)), harnessRow(language, `${slugOf(language)}-2`)];
const stackRowsWith = (python: readonly object[], others: Partial<Record<string, readonly object[]>> = {}) =>
  Object.fromEntries(MAINSTREAM_LANGUAGES.map((language) => [language, [...popularRows(language), ...(language === "Python" ? python
    : others[language] ?? ordinaryRows(language))]])) as Record<string, readonly object[]>;
/** Two rounds per language in each Stack deck. */
const STACK_POOL = 2 * MAINSTREAM_LANGUAGES.length;
const PROJECT_CALL = `project:${STACK_POOL}:${Array(STACK_POOL).fill(3).join(",")}`;
/** Each language's ordinary rows in the default harness, in the order the language deck tries them. */
const DEFAULT_LANGUAGE_ROWS = MAINSTREAM_LANGUAGES.flatMap((language) =>
  language === "Python" ? ["py-reject", "py", "py-2"] : [slugOf(language), `${slugOf(language)}-2`]);
/** Captures the commit ids the before-or-after deck is generated from. */
const beforeAfterIds = (): Readonly<{ ids: unknown[]; generate: PreparationDependencies["generateBeforeAfter"] }> => {
  const ids: unknown[] = [];
  return { ids, generate: ({ profile, candidates }) => {
    ids.push(...candidates.map((candidate: any) => candidate.lineage.id));
    return { fixtures: Array(profile.selection.beforeAfterPool).fill({ kind: "BEFORE_AFTER" }) } as any;
  } };
};
const metadataFrom = (rows: Record<string, readonly object[]>): PreparationDependencies["collectStackMetadata"] =>
  async ({ configuration, capacity }) => {
    capacity.recordStackRows(configuration, rows[configuration]!.length, 100);
    return accepted(rows[configuration]!, `a${MAINSTREAM_LANGUAGES.indexOf(configuration).toString(16)}`);
  };
const searchWith = (queryClassifications: unknown): PreparationDependencies["searchGitHub"] => async () => accepted({
  candidates: HARNESS_CANDIDATES,
  queryClassifications,
} as any, "2");
/** An offline journal that holds nothing, so every worker output the run asks it for is a miss. */
const emptyOfflineJournal = () => {
  const path = join(mkdtempSync(join(tmpdir(), "codeguessr-offline-")), "run.jsonl");
  openJournal({ mode: "fresh", path }).finish();
  return openJournal({ mode: "offline", path });
};

describe("local experiment preparation command", () => {
/** Marker lines only; the failure-site line is asserted separately. */
const logLines = (calls: readonly string[]): string[] =>
  calls.filter((call) => call.startsWith("log:") && !call.startsWith("log:PREPARATION_FAILURE_SITE ")
    && !call.startsWith("log:PREPARATION_SPEND "));

  it("exposes one preparation entry point and one no-argument project command", async () => {
    expect(prepareLocalExperiment).toBeTypeOf("function");
    expect(runPreparationCli).toBeTypeOf("function");
    const manifest = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8"));
    expect(manifest.scripts["prepare:poc"]).toBe("node --import tsx ops/poc/prepare/index.ts");
  });

  it("runs preflight, Stack metadata, discovery, all three decks, the report, then publication", async () => {
    const harness = await makeHarness();
    const result = await prepareLocalExperiment(harness.dependencies) as PreparationResult;

    expect(harness.calls.indexOf("preflight")).toBeLessThan(harness.calls.indexOf("metadata:Python"));
    expect(harness.calls.indexOf("metadata:Ruby")).toBeLessThan(harness.calls.indexOf("search"));
    expect(harness.calls.filter((call) => call.startsWith("metadata:"))).toEqual(MAINSTREAM_LANGUAGES.map((language) => `metadata:${language}`));
    expect(harness.calls).toContain(PROJECT_CALL);
    expect(harness.calls).toContain(`language:${STACK_POOL}`);
    expect(harness.calls).toContain("before-after:5");
    expect(harness.calls).toContain(`compose:${STACK_POOL}/${STACK_POOL}/5`);
    expect(harness.calls.indexOf("report:stage")).toBeLessThan(harness.calls.indexOf("publish"));
    expect(harness.calls.indexOf("publish")).toBeLessThan(harness.calls.indexOf("report:commit"));
    expect(harness.calls.indexOf("report:commit")).toBeLessThan(harness.calls.indexOf("report:finalize"));
    expect(harness.calls.indexOf("report:finalize")).toBeLessThan(harness.calls.indexOf("log:PREPARATION_COMPLETE"));
    expect(harness.calls).not.toContain("report:rollback");
    expect(result.artifactHash).toBe(hash("9"));
    expect(harness.published).toHaveLength(1);
    expect(harness.reports).toHaveLength(1);
  });

  it("checks round eligibility before lease acceptance and continues with frozen limits", async () => {
    const harness = await makeHarness();
    await prepareLocalExperiment(harness.dependencies);

    expect(new Set(harness.dependencyMeters).size).toBe(1);
    // Two popular files per language for the project deck, then the language deck's rows in stable order.
    const fetched = [...MAINSTREAM_LANGUAGES.flatMap((language) => [0, 1].map((rank) => `${slugOf(language)}-pop-${rank}`)), ...DEFAULT_LANGUAGE_ROWS];
    expect(harness.calls.filter((call) => call.startsWith("fetch:"))).toEqual(
      fetched.map((id, index) => `fetch:${id}:${240 - index}:${16_777_216 - 80 * index}`));
    expect(harness.calls.filter((call) => call.startsWith("eligible:"))).toEqual(DEFAULT_LANGUAGE_ROWS.map((id) => `eligible:${id}`));
    expect(harness.leases).toEqual([
      ...Array(STACK_POOL).fill({ accepted: true, released: false, bytes: 80 }),
      { accepted: false, released: true, bytes: 80 },
      ...Array(STACK_POOL).fill({ accepted: true, released: false, bytes: 80 }),
    ]);
  });

  it("continues past rejected admissions until the before-or-after pool is full", async () => {
    const rejected: number[] = [];
    const captured = beforeAfterIds();
    const harness = await makeHarness({
      admitGitHubCandidate: async ({ candidate }) => {
        const id = (candidate as any).id as number;
        if (id === 1) { rejected.push(id); throw new Error("REPOSITORY_REJECTED"); }
        return admittedWith(candidate);
      },
      generateBeforeAfter: captured.generate,
    });

    await prepareLocalExperiment(harness.dependencies);
    expect(rejected).toEqual([1]);
    expect(captured.ids).toEqual([0, 2, 3, 4, 5]);
  });

  it("skips a search candidate whose repository the deck already holds before spending any lineage request", async () => {
    const profile = await loadProfile();
    // More skipped repeats than screened candidates: skips are diagnostics, not screened duplicates.
    const repeats = Array.from({ length: 30 }, (_, index) => ({ id: 100 + index, queryId: "refactor-facebook", repository: "same/repo", subject: "Refactor the same helper" }));
    const candidates = [
      { id: 0, queryId: "refactor-facebook", repository: "same/repo", subject: "Refactor the first helper" },
      ...repeats,
      ...[3, 4, 5, 6, 7, 8].map((id) => ({ id, queryId: "refactor-facebook", repository: `org${id}/repo-${id}`, subject: `Refactor helper ${id}` })),
    ];
    const captured = beforeAfterIds();
    const harness = await makeHarness({
      searchGitHub: async () => accepted({ candidates, queryClassifications: classificationsFor(profile) }, "2"),
      generateBeforeAfter: captured.generate,
      createReport: (input) => {
        const report = createRunReport(input) as any;
        expect(report.counts.duplicatesRejected).toBeLessThanOrEqual(report.counts.screened);
        return report;
      },
    });

    await prepareLocalExperiment(harness.dependencies);
    expect(harness.calls.filter((call) => call.startsWith("lineage:"))).toEqual([0, 3, 4, 5, 6].map((id) => `lineage:${id}`));
    expect(captured.ids).toEqual([0, 3, 4, 5, 6]);
    const report = harness.reports[0] as any;
    expect(report.diagnostics).toContainEqual({ stage: "DEDUPLICATION", reasonCode: "REPOSITORY_REPEATED", count: 30 });
    expect(report.counts.duplicatesRejected).toBe(0);
  });

  it("skips a commit whose subject no hint could quote before spending any request on it", async () => {
    const profile = await loadProfile();
    const candidates = HARNESS_CANDIDATES.map((candidate) => candidate.id === 1 ? { ...candidate, subject: "Fix" } : candidate);
    const harness = await makeHarness({ searchGitHub: async () => accepted({ candidates, queryClassifications: classificationsFor(profile) }, "2") });
    await prepareLocalExperiment(harness.dependencies);
    expect(harness.calls).not.toContain("screen:org1/repo-1");
    expect(harness.calls).not.toContain("lineage:1");
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "SCREENING", reasonCode: "SUBJECT_UNUSABLE", count: 1 });
  });

  it("keeps a popular file out of the project deck when its code names its own project, and tries the repository's next file", async () => {
    const python = [
      harnessRow("Python", "python-pop-0", { starEventsCount: 9000, excerpt: "import python_pop_0\npython-pop-0.run()" }),
      harnessRow("Python", "python-pop-0b", { repository: "python-org/python-pop-0", starEventsCount: 9000 }),
      ...popularRows("Python").slice(1),
    ];
    const rows = stackRowsWith(ordinaryRows("Python"));
    rows.Python = [...python, ...ordinaryRows("Python")];
    const harness = await makeHarness({ collectStackMetadata: metadataFrom(rows) });

    await prepareLocalExperiment(harness.dependencies);
    expect(harness.calls.filter((call) => call.startsWith("fetch:python-pop-0"))).toHaveLength(2);
    expect(harness.calls).toContain(PROJECT_CALL);
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "SCREENING", reasonCode: "PROJECT_NAME_IN_EXCERPT", count: 1 });
  });

  it("from profile v6 on, holds each project pane to no word of any option's name or description (#77)", async () => {
    // python-pop-0's first file calls `launch`, which its description names; python-pop-1's first file names
    // python-pop-0, the language's other answer; python-pop-2's description names `compute`, which python-pop-1's
    // file calls, so it is no decoy and python-pop-4 is offered instead.
    const python = [
      harnessRow("Python", "python-pop-0", { starEventsCount: 9000, excerpt: "value = launch(1)" }),
      harnessRow("Python", "python-pop-0b", { repository: "python-org/python-pop-0", starEventsCount: 9000, excerpt: "value = start(1)" }),
      harnessRow("Python", "python-pop-1", { starEventsCount: 8000, excerpt: "import python_pop_0" }),
      harnessRow("Python", "python-pop-1b", { repository: "python-org/python-pop-1", starEventsCount: 8000 }),
      ...popularRows("Python").slice(2),
      harnessRow("Python", "python-pop-4", { starEventsCount: 4500 }),
    ];
    const rows = stackRowsWith(ordinaryRows("Python"));
    rows.Python = [...python, ...ordinaryRows("Python")];
    const descriptions: Readonly<Record<string, string>> = { "python-org/python-pop-0": "Launches rockets.", "python-org/python-pop-2": "Compute engines." };
    const run = async (profileVersion: "local-real-rounds.v5" | "local-real-rounds.v6") => {
      const offered: string[] = [];
      let harness: Awaited<ReturnType<typeof makeHarness>>;
      harness = await makeHarness({
        collectStackMetadata: metadataFrom(rows),
        describeRepository: async ({ repository }) => {
          harness.calls.push(`describe:${repository}`);
          return accepted({ description: descriptions[repository] ?? `About ${repository.split("/")[1]}`, fork: false, archived: false }, "2");
        },
        generateProject: ({ profile, rounds }) => {
          for (const round of rounds.filter(({ candidate }) => (candidate as any).detectedLanguage === "Python")) {
            offered.push(String((round.candidate as any).repository), ...round.distractors.map((option) => option.repository));
          }
          return { fixtures: Array(2 * profile.stack.configurations.length).fill({ kind: "PROJECT" }) } as any;
        },
      }, { profile: await loadProfile(profileVersion) });
      await prepareLocalExperiment(harness.dependencies);
      return { harness, offered: new Set(offered) };
    };
    const v5 = await run("local-real-rounds.v5");
    expect(v5.harness.calls.filter((call) => call.startsWith("fetch:python-pop-0"))).toHaveLength(1);
    expect(v5.offered).toContain("python-org/python-pop-2");

    const { harness, offered } = await run("local-real-rounds.v6");
    // Each repository is described once, before any of its files is fetched.
    const describes = harness.calls.filter((call) => call.startsWith("describe:python-org/"));
    expect(new Set(describes).size).toBe(describes.length);
    expect(harness.calls.indexOf("describe:python-org/python-pop-0")).toBeLessThan(harness.calls.findIndex((call) => call.startsWith("fetch:python-pop-0:")));
    expect(harness.calls.filter((call) => call.startsWith("fetch:python-pop-0"))).toHaveLength(2);
    expect(harness.calls.filter((call) => call.startsWith("fetch:python-pop-1"))).toHaveLength(2);
    expect(offered).toEqual(new Set(["python-org/python-pop-0", "python-org/python-pop-1", "python-org/python-pop-3", "python-org/python-pop-4"]));
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "SCREENING", reasonCode: "PROJECT_NAME_IN_EXCERPT", count: 1 });
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "SCREENING", reasonCode: "PROJECT_WORDS_IN_EXCERPT", count: 2 });
    expect(logLines(harness.calls)).toContain("log:PREPARATION_DECKS project,language,before-after");
  });

  it("offers a repository in one language's project rounds only", async () => {
    // python-org/python-pop-2 also has a popular Ruby file; it stays a Python decoy and Ruby offers its own repositories.
    const rows = stackRowsWith(ordinaryRows("Python"));
    rows.Ruby = [harnessRow("Ruby", "shared", { repository: "python-org/python-pop-2", starEventsCount: 9500 }), ...rows.Ruby!];
    const offered = new Map<string, Set<string>>();
    const harness = await makeHarness({
      collectStackMetadata: metadataFrom(rows),
      generateProject: ({ profile, rounds }) => {
        for (const round of rounds) {
          const language = String((round.candidate as any).detectedLanguage);
          for (const repository of [String((round.candidate as any).repository), ...round.distractors.map((option) => option.repository)]) {
            offered.set(repository, new Set([...(offered.get(repository) ?? []), language]));
          }
        }
        return { fixtures: Array(2 * profile.stack.configurations.length).fill({ kind: "PROJECT" }) } as any;
      },
    });
    await prepareLocalExperiment(harness.dependencies);
    expect(offered.get("python-org/python-pop-2")).toEqual(new Set(["Python"]));
    expect([...offered.values()].every((languages) => languages.size === 1)).toBe(true);
  });

  it("selects a configured algorithm deck after the Stack decks, one whole family at a time, languages taking turns", async () => {
    const profile = loadCuratedProfile({ beforeAfterPool: 5 });
    const harness = await makeHarness({}, { profile, curatedFiles: curatedFiles() });
    await prepareLocalExperiment(harness.dependencies);
    const curated = harness.calls.filter((call) => call.startsWith("curated:"));
    // Languages take turns being tried first; the Go files are absent, so every Go turn falls back to Python.
    expect(curated.slice(0, 3)).toEqual([
      "curated:algos/python:algorithms/bubble_sort.py",
      "curated:algos/go:algorithms/insertion_sort.go", "curated:algos/python:algorithms/insertion_sort.py",
    ]);
    const lastStackFetch = harness.calls.length - 1 - [...harness.calls].reverse().findIndex((call: string) => call.startsWith("fetch:"));
    expect(harness.calls.indexOf(curated[0]!)).toBeGreaterThan(lastStackFetch);
    expect(harness.calls).toContain("algorithm:8");
    expect(harness.calls).toContain(`compose:${STACK_POOL}/${STACK_POOL}/5/8`);
    expect(logLines(harness.calls)).toContain("log:PREPARATION_DECKS project,language,before-after,algorithm");
  });

  it("drops a family that cannot fill, and skips the algorithm deck alone when too few families remain", async () => {
    const profile = loadCuratedProfile({ beforeAfterPool: 5 });
    const files = new Map(curatedFiles());
    files.delete("algos/python:algorithms/jump_search.py");
    const harness = await makeHarness({}, { profile, curatedFiles: files });
    await prepareLocalExperiment(harness.dependencies);
    expect(logLines(harness.calls)).toContain("log:PREPARATION_DECK_SKIPPED algorithm DECK_SHORT");
    expect(logLines(harness.calls)).toContain("log:PREPARATION_DECKS project,language,before-after");
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "SELECTION", reasonCode: "ALGORITHM_FAMILY_SHORT", count: 1 });
  });

  it("selects a configured output deck last, reading files in hash order and binding only the usable ones", async () => {
    const profile = loadCuratedProfile({ beforeAfterPool: 5 }, { algorithm: true, output: true });
    const harness = await makeHarness({}, { profile, curatedFiles: new Map([...curatedFiles(), ...outputFiles()]) });
    await prepareLocalExperiment(harness.dependencies);
    const lists = harness.calls.filter((call) => call.startsWith("list:"));
    expect(lists).toEqual(["list:algos/python:maths", "list:algos/python:strings"]);
    expect(harness.calls.indexOf(lists[0]!)).toBeGreaterThan(harness.calls.findIndex((call) => call === "curated:algos/python:algorithms/jump_search.py"));
    const reads = harness.calls.filter((call) => call.startsWith("read:")).map((call) => call.slice("read:algos/python:".length));
    const usable = [...outputFiles().keys()].map((key) => key.slice("algos/python:".length)).filter((path) => !path.includes("/test_"));
    expect(reads).toEqual(usable.sort((left, right) => sha256(`algos/python:${left}`) < sha256(`algos/python:${right}`) ? -1 : 1).slice(0, reads.length));
    // Only files with a usable function are bound, so the module without doctests never costs an author request.
    const bound = harness.calls.filter((call) => call.startsWith("curated:algos/python:maths/") || call.startsWith("curated:algos/python:strings/"));
    expect(bound).toHaveLength(8);
    expect(bound).not.toContain("curated:algos/python:maths/notes.py");
    expect(harness.calls).toContain("output:8");
    expect(harness.calls).toContain(`compose:${STACK_POOL}/${STACK_POOL}/5/8/8`);
    expect(logLines(harness.calls)).toContain("log:PREPARATION_DECKS project,language,before-after,algorithm,output");
  });

  it("from profile v6 on, never binds a function whose every call rearranges its arguments (#78)", async () => {
    const files = new Map([...curatedFiles(), ...outputFiles(), swapOutputFile()]);
    const bound = async (version: "local-real-rounds.v5" | "local-real-rounds.v6") => {
      const harness = await makeHarness({}, { profile: loadCuratedProfile({ beforeAfterPool: 5 }, { algorithm: true, output: true }, version), curatedFiles: files });
      await prepareLocalExperiment(harness.dependencies);
      expect(harness.calls).toContain("read:algos/python:maths/xor_swap.py");
      return { harness, swap: harness.calls.includes("curated:algos/python:maths/xor_swap.py") };
    };
    expect((await bound("local-real-rounds.v5")).swap).toBe(true);
    const { harness, swap } = await bound("local-real-rounds.v6");
    expect(swap).toBe(false);
    expect(logLines(harness.calls)).toContain("log:PREPARATION_DECKS project,language,before-after,algorithm,output");
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "SCREENING", reasonCode: "OUTPUT_NO_DOCTEST", count: 2 });
  });

  it("skips files another deck shows, and skips the output deck alone when its reads run out", async () => {
    const files = new Map([...curatedFiles(), ...outputFiles()]);
    const raw = JSON.parse(await readFile(new URL("../profiles/local-real-rounds.v5.json", import.meta.url), "utf8"));
    const wide = parseCrawlProfile({ ...raw, selection: { ...raw.selection, beforeAfterPool: 5 }, curated: {
      repositories: CURATED_REPOSITORIES, algorithm: CURATED_SECTION.algorithm,
      output: { ...OUTPUT_SECTION, directories: ["algorithms", "maths", "strings"], fileReads: 8 } } });
    const harness = await makeHarness({}, { profile: wide, curatedFiles: files });
    await prepareLocalExperiment(harness.dependencies);
    expect(harness.calls.some((call) => call.startsWith("read:algos/python:algorithms/"))).toBe(false);
    expect(harness.calls.filter((call) => call.startsWith("read:"))).toHaveLength(8);
    expect(logLines(harness.calls)).toContain("log:PREPARATION_DECK_SKIPPED output DECK_SHORT");
    expect(logLines(harness.calls)).toContain("log:PREPARATION_DECKS project,language,before-after,algorithm");
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "SCREENING", reasonCode: "OUTPUT_NO_DOCTEST", count: 1 });
  });

  it("selects a configured fix deck last: short patches in hash order, datasets taking turns, three rounds a repository", async () => {
    const profile = loadCuratedProfile({ beforeAfterPool: 5 }, { fix: true });
    const data = fixHarnessData();
    const harness = await makeHarness({}, { profile, fix: data });
    await prepareLocalExperiment(harness.dependencies);
    expect(harness.calls.filter((call) => call.startsWith("bugs:"))).toEqual(["bugs:defects4j", "bugs:bugsinpy"]);
    const patches = harness.calls.filter((call) => call.startsWith("patch:")).map((call) => call.slice("patch:".length));
    // The long patch is never read; the datasets alternate, each in its own hash order.
    expect(patches).not.toContain("Text-9");
    const order = (dataset: string) => data.bugs.filter((bug) => bug.dataset === dataset && bug.patchSize <= 800)
      .map(({ bug }) => bug).sort((left, right) => sha256(`${dataset}:${left}`) < sha256(`${dataset}:${right}`) ? -1 : 1);
    const [java, python] = [order("defects4j"), order("bugsinpy")];
    expect(patches).toEqual(java.flatMap((bug, index) => [bug, python[index]]).filter((bug): bug is string => bug !== undefined).slice(0, patches.length));
    // The wide patch is set aside before any upstream request; the rest are confirmed upstream.
    expect(harness.calls).not.toContain("fix:Calc-9");
    expect(harness.calls.filter((call) => call.startsWith("fix:"))).toHaveLength(8);
    expect(harness.calls).toContain("fix-deck:8");
    expect(harness.calls).toContain(`compose:${STACK_POOL}/${STACK_POOL}/5/8`);
    expect(logLines(harness.calls)).toContain("log:PREPARATION_DECKS project,language,before-after,fix");
  });

  it("rejects one bug whose dataset record is not UTF-8 and keeps selecting fixes", async () => {
    const profile = loadCuratedProfile({ beforeAfterPool: 5 }, { fix: true });
    const harness = await makeHarness({}, { profile, fix: fixHarnessData() });
    const read = harness.dependencies.readDatasetBlob;
    let reads = 0;
    harness.dependencies.readDatasetBlob = async (options) => (reads += 1) === 1 ? accepted(new Uint8Array([0xc3, 0x28]), "8") : read(options);
    await prepareLocalExperiment(harness.dependencies);
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "ADMISSION", reasonCode: "FIX_DATASET_ENCODING", count: 1 });
    expect(reads).toBeGreaterThan(1);
  });

  it("skips the fix deck alone when its patch reads run out", async () => {
    const raw = JSON.parse(await readFile(new URL("../profiles/local-real-rounds.v5.json", import.meta.url), "utf8"));
    const narrow = parseCrawlProfile({ ...raw, selection: { ...raw.selection, beforeAfterPool: 5 },
      curated: { repositories: CURATED_REPOSITORIES, fix: { ...FIX_SECTION, patchReads: 8 } } });
    const harness = await makeHarness({}, { profile: narrow, fix: fixHarnessData() });
    await prepareLocalExperiment(harness.dependencies);
    expect(harness.calls.filter((call) => call.startsWith("patch:"))).toHaveLength(8);
    expect(logLines(harness.calls)).toContain("log:PREPARATION_DECK_SKIPPED fix DECK_SHORT");
    expect(logLines(harness.calls)).toContain("log:PREPARATION_DECKS project,language,before-after");
  });

  it("skips a deck whose rounds fail generation, and publishes the rest (#32)", async () => {
    const profile = loadCuratedProfile({ beforeAfterPool: 5 }, { fix: true });
    const harness = await makeHarness({}, { profile, fix: fixHarnessData() });
    const generate = harness.dependencies.generateCurated;
    harness.dependencies.generateCurated = (options) => options.deck === "fix"
      ? (() => { throw Object.assign(new Error("FIX_ROUNDS_REJECTED"), { code: "FIX_RANK_UNBALANCED" }); })()
      : generate(options);
    await prepareLocalExperiment(harness.dependencies);
    expect(logLines(harness.calls)).toContain("log:PREPARATION_DECK_SKIPPED fix FIX_RANK_UNBALANCED");
    expect(logLines(harness.calls)).toContain("log:PREPARATION_DECKS project,language,before-after");
    expect(harness.calls).toContain(`compose:${STACK_POOL}/${STACK_POOL}/5`);
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "SELECTION", reasonCode: "FIX_DECK_SKIPPED", count: 1 });
  });

  it("drops the later deck when composing it collides with one already kept (#32)", async () => {
    const profile = loadCuratedProfile({ beforeAfterPool: 5 }, { fix: true });
    const harness = await makeHarness({}, { profile, fix: fixHarnessData() });
    const compose = harness.dependencies.compose;
    harness.dependencies.compose = (options) => options.decks.fix !== undefined && options.decks["before-after"] !== undefined
      ? (() => { throw Object.assign(new Error("EXPERIMENT_COMPOSITION_REJECTED"), { code: "PUBLIC_CONTAINMENT_CANDIDATE_IN_PANES" }); })()
      : compose(options);
    await prepareLocalExperiment(harness.dependencies);
    expect(logLines(harness.calls)).toContain("log:PREPARATION_DECK_SKIPPED fix PUBLIC_CONTAINMENT_CANDIDATE_IN_PANES");
    expect(logLines(harness.calls)).toContain("log:PREPARATION_DECKS project,language,before-after");
  });

  it("fails the run on an uncoded generation error, which is a bug rather than a deck to skip (#32)", async () => {
    const profile = loadCuratedProfile({ beforeAfterPool: 5 }, { fix: true });
    const harness = await makeHarness({}, { profile, fix: fixHarnessData() });
    const generate = harness.dependencies.generateCurated;
    harness.dependencies.generateCurated = (options) => options.deck === "fix" ? (undefined as any).fixtures : generate(options);
    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(logLines(harness.calls)[0]).toBe("log:PREPARATION_STAGE_FAILED GENERATION UNCODED_TYPEERROR none");
    expect(logLines(harness.calls).some((line) => line.startsWith("log:PREPARATION_DECK_SKIPPED"))).toBe(false);
  });

  it("refuses a fix whose lines claim anything about authorship at selection, not after the spend (#32)", async () => {
    const profile = loadCuratedProfile({ beforeAfterPool: 5 }, { fix: true });
    const harness = await makeHarness({}, { profile, fix: fixHarnessData() });
    const bind = harness.dependencies.bindFixCommit;
    let calls = 0;
    harness.dependencies.bindFixCommit = async (options) => {
      const result = await bind(options);
      if ((calls += 1) !== 1) return result;
      const value = result.value;
      return { ...result, value: { ...value, fix: { ...value.fix, fixedLine: `${value.fix.fixedLine} // AI-generated` } } };
    };
    await prepareLocalExperiment(harness.dependencies);
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "SCREENING", reasonCode: "FIX_CLAIM", count: 1 });
  });

  it("selects a configured missing-line deck from the curated files no other deck shows, balanced over every rank (#57)", async () => {
    const profile = loadCuratedProfile({ beforeAfterPool: 5 }, { "missing-line": true });
    const harness = await makeHarness({}, { profile, curatedFiles: missingLineFiles() });
    await prepareLocalExperiment(harness.dependencies);
    expect(harness.calls).toContain("list:algos/python:utils");
    expect(harness.calls.filter((call) => call.startsWith("read:algos/python:utils/"))).toHaveLength(8);
    expect(harness.calls).toContain("missing-line:8");
    expect(logLines(harness.calls)).toContain("log:PREPARATION_DECKS project,language,before-after,missing-line");
  });

  it("selects a configured name-the-function deck from every source's files in one hash order, balanced (#73)", async () => {
    const profile = loadCuratedProfile({ beforeAfterPool: 5 }, { "name-function": true });
    const harness = await makeHarness({}, { profile, curatedFiles: nameFunctionFiles() });
    await prepareLocalExperiment(harness.dependencies);
    expect(harness.calls).toContain("list:algos/go:shapes");
    expect(harness.calls.filter((call) => call.startsWith("read:algos/go:shapes/"))).toHaveLength(8);
    expect(harness.calls).toContain("name-function:8");
    expect(logLines(harness.calls)).toContain("log:PREPARATION_DECKS project,language,before-after,name-function");
  });

  it("selects a configured framework deck one family at a time, after checking each example states no licence of its own (#62)", async () => {
    const profile = loadCuratedProfile({ beforeAfterPool: 5 }, { framework: true });
    const harness = await makeHarness({}, { profile, curatedFiles: frameworkFiles() });
    await prepareLocalExperiment(harness.dependencies);
    expect(harness.calls).toContain("list:todo/examples:examples/react/src");
    expect(harness.calls).toContain("read:todo/examples:examples/react/package.json");
    expect(harness.calls.filter((call) => call.startsWith("curated:todo/examples:"))).toHaveLength(8);
    expect(harness.calls).toContain("framework:8");
    expect(logLines(harness.calls)).toContain("log:PREPARATION_DECKS project,language,before-after,framework");
  });

  it("skips an example that states a licence of its own, and with it the family it would have filled (#62)", async () => {
    const profile = loadCuratedProfile({ beforeAfterPool: 5 }, { framework: true });
    const files = new Map(frameworkFiles());
    files.set("todo/examples:examples/svelte/LICENSE", "Some other licence.\n");
    files.set("todo/examples:examples/ember/package.json", "{ \"license\": \"GPL-3.0\" }\n");
    const harness = await makeHarness({}, { profile, curatedFiles: files });
    await prepareLocalExperiment(harness.dependencies);
    expect(harness.calls.some((call) => call.startsWith("read:todo/examples:examples/svelte/src/"))).toBe(false);
    expect(logLines(harness.calls)).toContain("log:PREPARATION_DECK_SKIPPED framework DECK_SHORT");
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "ADMISSION", reasonCode: "FRAMEWORK_LICENSE_OWN", count: 2 });
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "SELECTION", reasonCode: "FRAMEWORK_FAMILY_SHORT", count: 2 });
  });

  it("selects a configured exercise deck one family at a time, tracks taking turns, and falls back past a missing solution (#58)", async () => {
    const profile = loadCuratedProfile({ beforeAfterPool: 5 }, { exercise: true });
    const files = new Map(exerciseFiles());
    files.delete("algos/go:exercises/practice/leap/.meta/example.go");
    const harness = await makeHarness({}, { profile, curatedFiles: files });
    await prepareLocalExperiment(harness.dependencies);
    expect(harness.calls).toContain("curated:algos/go:exercises/practice/pangram/.meta/example.go");
    expect(harness.calls).toContain("curated:algos/python:exercises/practice/leap/.meta/example.py");
    expect(harness.calls).toContain("exercise:8");
    expect(logLines(harness.calls)).toContain("log:PREPARATION_DECKS project,language,before-after,exercise");
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "ADMISSION", reasonCode: "FILE_PATH", count: 1 });
  });

  it("selects a configured vulnerable-line deck from each ecosystem's listings, reading no commit for an advisory it sets aside (#59)", async () => {
    const profile = loadCuratedProfile({ beforeAfterPool: 5 }, { "vulnerable-line": true });
    const harness = await makeHarness({}, { profile, advisories: advisoryHarnessData() });
    await prepareLocalExperiment(harness.dependencies);
    for (const ecosystem of ["pip", "npm"]) {
      for (const published of ["2024-01-01..2024-06-30", "2024-07-01..2024-12-31"]) expect(harness.calls).toContain(`advisories:${ecosystem}:${published}`);
    }
    // Withdrawn, linking two commits, or under a CWE the profile has no hint for: set aside before any commit is read.
    for (const repository of ["vuln/extra11", "vuln/extra12", "vuln/extra13"]) expect(harness.calls).not.toContain(`advisory-fix:${repository}`);
    expect(harness.calls).toContain("vulnerable-line:8");
    expect(logLines(harness.calls)).toContain("log:PREPARATION_DECKS project,language,before-after,vulnerable-line");
  });

  it("attempts no algorithm deck when the profile configures none", async () => {
    const harness = await makeHarness();
    await prepareLocalExperiment(harness.dependencies);
    expect(harness.calls.some((call) => call.startsWith("curated:"))).toBe(false);
    expect(logLines(harness.calls).some((line) => line.includes("algorithm"))).toBe(false);
  });

  it("screens out a source whose identity the run report could not record, before it can fail publication", async () => {
    const captured = beforeAfterIds();
    const harness = await makeHarness({
      admitGitHubCandidate: async ({ candidate }) => admittedWith(candidate,
        (candidate as any).id === 1 ? { path: "src/c#/file-1.ts" } : {}),
      collectStackMetadata: metadataFrom(stackRowsWith([
        harnessRow("Python", "py-hash", { stableRowId: "0" }), harnessRow("Python", "py", { stableRowId: "1" }),
        harnessRow("Python", "py-2", { stableRowId: "2" }),
      ])),
      revalidateStackCandidate: async ({ row }: any) => accepted({ ...row,
        commit: String(Object.keys(stackRowsWith([])).indexOf(row.detectedLanguage) * 10 + row.id.length).padStart(40, "d"),
        path: row.id === "py-hash" ? "pkg/a?b.py" : row.path }, "7"),
      generateBeforeAfter: captured.generate,
    });

    await prepareLocalExperiment(harness.dependencies);
    expect(captured.ids).not.toContain(1);
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "SCREENING", reasonCode: "SOURCE_IDENTITY_UNREPORTABLE", count: 2 });
  });

  it("publishes the decks that filled and skips each other deck with its reason", async () => {
    const harness = await makeHarness({ collectStackMetadata: async () => accepted([], "5") });
    const result = await prepareLocalExperiment(harness.dependencies);
    expect(result.artifactHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(harness.calls).toContain("compose:0/0/5");
    expect(harness.calls.some((call) => call.startsWith("fetch:"))).toBe(false);
    expect(logLines(harness.calls)).toEqual([
      "log:PREPARATION_DECK_SKIPPED project DECK_SHORT",
      "log:PREPARATION_DECK_SKIPPED language DECK_SHORT",
      "log:PREPARATION_DECKS before-after",
      "log:PREPARATION_COMPLETE",
    ]);
    expect((harness.reports[0] as any).counts.selected).toBe(5);
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "SELECTION", reasonCode: "PROJECT_DECK_SKIPPED", count: 1 });
  });

  it("skips a short before-or-after pool and still publishes the Stack decks", async () => {
    const profile = await loadProfile();
    const harness = await makeHarness({
      searchGitHub: async () => accepted({ candidates: HARNESS_CANDIDATES.slice(0, 3), queryClassifications: classificationsFor(profile) }, "2"),
    });
    await prepareLocalExperiment(harness.dependencies);
    expect(harness.calls).toContain(`compose:${STACK_POOL}/${STACK_POOL}/0`);
    expect(harness.calls).toContain("log:PREPARATION_DECK_SKIPPED before-after DECK_SHORT");
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "SELECTION", reasonCode: "BEFORE_AFTER_DECK_SKIPPED", count: 1 });
  });

  it("rejects a duplicate within a deck and across decks, then continues to unique replacements", async () => {
    const captured = beforeAfterIds();
    const duplicateHash = hash("d");
    const harness = await makeHarness({
      admitGitHubCandidate: async ({ candidate }) => admittedWith(candidate,
        (candidate as any).id < 2 ? { rawContentHash: duplicateHash } : {}),
      revalidateStackCandidate: async ({ row }: any) => accepted({ ...row,
        ...(row.id === "py" ? { rawContentHash: duplicateHash } : {}) }, "8"),
      generateBeforeAfter: captured.generate,
    });

    await prepareLocalExperiment(harness.dependencies);
    expect(captured.ids).toEqual([0, 2, 3, 4, 5]);
    // One commit repeats the first commit's content; the Python file repeats it across decks.
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "DEDUPLICATION", reasonCode: "SOURCE_DUPLICATE", count: 2 });
    // The language deck moves past the repeated Python file to the next eligible row.
    expect(harness.calls).toContain(`language:${STACK_POOL}`);
  });

  it("orders the language deck's rows by the profile keys and continues after cross-source deduplication", async () => {
    const collisionHash = hash("c");
    const stackRows = stackRowsWith([
      harnessRow("Python", "later", { stableRowId: hash("3") }),
      harnessRow("Python", "late", { stableRowId: hash("2") }),
      harnessRow("Python", "collision", { stableRowId: hash("1") }),
    ]);
    const harness = await makeHarness({
      admitGitHubCandidate: async ({ candidate }) => admittedWith(candidate,
        (candidate as any).id === 0 ? { rawContentHash: collisionHash } : {}),
      revalidateStackCandidate: async ({ row }: any) => accepted({ ...row,
        ...(row.id === "collision" ? { rawContentHash: collisionHash } : {}) }, "8"),
      collectStackMetadata: metadataFrom(stackRows),
    });

    await prepareLocalExperiment(harness.dependencies);
    const languageFetches = harness.calls.filter((call) => call.startsWith("fetch:") && !call.includes("-pop-"));
    expect(languageFetches.slice(0, 4).map((call) => call.split(":")[1])).toEqual(["collision", "late", "later", "ruby"]);
    expect(harness.leases[STACK_POOL]).toMatchObject({ accepted: false, released: true });
  });

  it("continues after a language row that repeats another round's content", async () => {
    const duplicateHash = hash("d");
    const rows = stackRowsWith([harnessRow("Python", "py", { stableRowId: hash("1") }), harnessRow("Python", "py-2", { stableRowId: hash("5") })], {
      TypeScript: [
        harnessRow("TypeScript", "ts-later", { stableRowId: hash("6") }),
        harnessRow("TypeScript", "ts-late", { stableRowId: hash("3") }),
        harnessRow("TypeScript", "ts-duplicate", { stableRowId: hash("2") }),
      ],
    });
    const harness = await makeHarness({
      collectStackMetadata: metadataFrom(rows),
      revalidateStackCandidate: async ({ row }: any) => accepted({ ...row,
        ...(row.id === "py" || row.id === "ts-duplicate" ? { rawContentHash: duplicateHash } : {}) }, "8"),
    });

    await prepareLocalExperiment(harness.dependencies);
    const languageFetches = harness.calls.filter((call) => call.startsWith("fetch:") && !call.includes("-pop-"));
    expect(languageFetches.map((call) => call.split(":")[1]).filter((id: string | undefined) => /^(?:py|ts-)/u.test(String(id))))
      .toEqual(["py", "py-2", "ts-duplicate", "ts-late", "ts-later"]);
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "DEDUPLICATION", reasonCode: "SOURCE_DUPLICATE", count: 1 });
  });

  it("never publishes on insufficient selection, composition, or report failure", async () => {
    const profile = await loadProfile();
    const failures: Partial<PreparationDependencies>[] = [
      { collectStackMetadata: async () => accepted([], "5"),
        searchGitHub: async () => accepted({ candidates: [], queryClassifications: classificationsFor(profile) } as any, "2") },
      { compose: () => { throw new Error("COMPOSE_REJECTED"); } },
      { stageReport: async () => { throw new Error("REPORT_REJECTED"); } },
    ];
    for (const override of failures) {
      const harness = await makeHarness(override);
      await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow();
      expect(harness.published).toEqual([]);
    }
  });

  it("reports actual bounded counts and non-sensitive rejection reason codes", async () => {
    const harness = await makeHarness();
    await prepareLocalExperiment(harness.dependencies);
    const report = harness.reports[0] as any;

    // Two project and two language rounds per language (one Python row rejected), and five commits.
    expect(report.counts).toMatchObject({
      repositoriesAdmitted: 5, blobAttempts: 2 * STACK_POOL + 1, blobsRetrieved: 2 * STACK_POOL,
      githubRevalidations: 2 * STACK_POOL + 1, screened: 2 * STACK_POOL + 1 + 5, duplicatesRejected: 0, selected: 2 * STACK_POOL + 5,
    });
    expect(report.diagnostics).toEqual([
      { stage: "SCREENING", reasonCode: "LANGUAGE_ROUNDS_REJECTED", count: 1 },
    ]);
    expect(JSON.stringify(report)).not.toMatch(/raw-secret|external-hf|external-gh/u);
  });

  it("passes the real strict run-report parser before writing", async () => {
    const harness = await makeHarness({ createReport: createRunReport });
    await prepareLocalExperiment(harness.dependencies);

    expect(Object.isFrozen(harness.reports[0])).toBe(true);
    expect((harness.reports[0] as any).outcome).toBe("SUCCESS");
  });

  it("binds provider-reported incompleteness to the successful run report", async () => {
    const profile = await loadProfile();
    const classifications = classificationsFor(profile, 1);
    const harness = await makeHarness({
      searchGitHub: searchWith(classifications),
      createReport: createRunReport,
    });

    const result = await prepareLocalExperiment(harness.dependencies);
    const report = harness.reports[0] as any;

    expect(report.githubQueries.map(({ id, completeness }: any) => ({ queryId: id, completeness })))
      .toEqual(classifications);
    expect(report.result).toMatchObject({
      artifactHash: result.artifactHash,
      crawlSnapshotId: result.crawlSnapshotId,
    });
  });

  it("warns exactly once after report commit and publication, then completes", async () => {
    const profile = await loadProfile();
    const harness = await makeHarness({ searchGitHub: searchWith(classificationsFor(profile, 1)) });

    await prepareLocalExperiment(harness.dependencies);

    expect(logLines(harness.calls)).toEqual([
      "log:GITHUB_SEARCH_INCOMPLETE",
      "log:PREPARATION_DECKS project,language,before-after",
      "log:PREPARATION_COMPLETE",
    ]);
    expect(harness.calls.indexOf("report:stage")).toBeLessThan(harness.calls.indexOf("publish"));
    expect(harness.calls.indexOf("publish")).toBeLessThan(harness.calls.indexOf("report:commit"));
    expect(harness.calls.indexOf("report:commit")).toBeLessThan(harness.calls.indexOf("log:GITHUB_SEARCH_INCOMPLETE"));
  });

  it("does not emit the incomplete warning for a complete search", async () => {
    const harness = await makeHarness();

    await prepareLocalExperiment(harness.dependencies);

    expect(logLines(harness.calls)).toEqual([
      "log:PREPARATION_DECKS project,language,before-after",
      "log:PREPARATION_COMPLETE",
    ]);
  });

  it("fails closed on malformed injected query classifications", async () => {
    const profile = await loadProfile();
    const valid = classificationsFor(profile);
    const malformed = [
      ["missing", valid.slice(0, -1)],
      ["extra", [...valid, { queryId: "extra", completeness: "COMPLETE" }]],
      ["misordered", [valid[1], valid[0], ...valid.slice(2)]],
      ["mismatched", [{ ...valid[0], queryId: "wrong" }, ...valid.slice(1)]],
      ["duplicate", [valid[0], valid[0], ...valid.slice(2)]],
      ["unsupported", [{ ...valid[0], completeness: "INCOMPLETE" }, ...valid.slice(1)]],
    ] as const;

    for (const [_label, classifications] of malformed) {
      const harness = await makeHarness({ searchGitHub: searchWith(classifications) });
      await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
      expect(logLines(harness.calls)).toEqual([
        "log:PREPARATION_STAGE_FAILED DISCOVERY INVARIANT_REJECTED none",
        "log:PREPARATION_FAILED",
      ]);
      expect(harness.calls).not.toContain("report:stage");
      expect(harness.calls).not.toContain("publish");
    }
  });

  it("emits no incomplete or completion warning when publication fails", async () => {
    const profile = await loadProfile();
    const harness = await makeHarness({
      searchGitHub: searchWith(classificationsFor(profile, 1)),
      publishArtifact: async () => { throw new Error("PUBLICATION_REJECTED"); },
    });

    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");

    expect(logLines(harness.calls)).toEqual([
      "log:PREPARATION_STAGE_FAILED PUBLICATION PUBLICATION_REJECTED none",
      "log:PREPARATION_FAILED",
    ]);
  });

  it("never leaves a success report when artifact publication fails", async () => {
    const harness = await makeHarness({
      publishArtifact: async () => { throw new Error("PUBLICATION_REJECTED"); },
    });

    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");

    expect(harness.reports).toEqual([]);
    expect(harness.published).toEqual([]);
    expect(harness.calls).toContain("report:stage");
    expect(harness.calls).toContain("report:rollback");
    expect(harness.calls).not.toContain("report:commit");
    expect(harness.calls.indexOf("report:stage")).toBeLessThan(harness.calls.indexOf("report:rollback"));
  });

  it("rolls back a published artifact when the report cannot be committed", async () => {
    const harness = await makeHarness({
      stageReport: async () => {
        return {
          commit: async () => { throw new Error("REPORT_COMMIT_FAILED"); },
          rollback: async () => {},
          finalize: async () => {},
        };
      },
    });

    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");

    expect(harness.published).toEqual([]);
    expect(harness.reports).toEqual([]);
    expect(harness.calls).toContain("publish:rollback");
    expect(logLines(harness.calls)).toEqual([
      expect.stringMatching(/^log:PREPARATION_STAGE_FAILED PUBLICATION [A-Z][A-Z0-9_]* none$/u),
      "log:PREPARATION_FAILED",
    ]);
  });

  it("closes the runtime after success and after failure, logging its counts-only journal line", async () => {
    const closed: unknown[] = [];
    const harness = await makeHarness({ finishRuntime: (runtime) => { closed.push(runtime); return "PREPARATION_JOURNAL mode=fresh replayed=0 live=3"; } });
    await prepareLocalExperiment(harness.dependencies);
    expect(closed).toHaveLength(1);
    expect(logLines(harness.calls).slice(-2)).toEqual(["log:PREPARATION_JOURNAL mode=fresh replayed=0 live=3", "log:PREPARATION_COMPLETE"]);

    const failing = await makeHarness({
      finishRuntime: () => { throw new Error("disk full at /secret/path"); },
      searchGitHub: async () => { throw new GitHubSearchError("GITHUB_SEARCH_SHAPE"); },
    });
    await expect(prepareLocalExperiment(failing.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(logLines(failing.calls).slice(-2)).toEqual(["log:PREPARATION_JOURNAL_FAILED", "log:PREPARATION_FAILED"]);
    expect(failing.calls.join(" ")).not.toContain("/secret/path");
  });

  it("writes a counts-only failure report with the stage, code, spend, and rejection aggregates", async () => {
    const reports: any[] = [];
    const harness = await makeHarness({
      writeFailureReport: async (report) => { reports.push(report); },
      admitGitHubCandidate: async () => { throw new Error("LICENSE_REJECTED"); },
      fetchStackBlob: async () => { throw new StackMetadataError("WORKER_EXIT_TOKEN_REJECTED"); },
      log: () => undefined,
    });
    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ schemaVersion: "local-experiment-failure.v1", stage: "SELECTION",
      code: "DECK_SHORT", statusClass: "none", journal: null });
    expect(reports[0].rejections).toContainEqual({ stage: "SELECTION", reasonCode: "LANGUAGE_DECK_SKIPPED", count: 1 });
    expect(reports[0].rejections).toContainEqual({ stage: "BLOB_RETRIEVAL", reasonCode: "WORKER_EXIT_TOKEN_REJECTED", count: expect.any(Number) });
    expect(reports[0].capacity.requests).toBeTypeOf("number");
    expect(JSON.stringify(reports[0])).not.toMatch(/external-(?:hf|gh)|Bearer/u);

    const unwritable = await makeHarness({
      writeFailureReport: async () => { throw new Error("EACCES /secret"); },
      preflight: async () => { throw new Error("PREFLIGHT_REJECTED"); },
    });
    await expect(prepareLocalExperiment(unwritable.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(logLines(unwritable.calls).slice(-2)).toEqual(["log:PREPARATION_FAILURE_REPORT_FAILED", "log:PREPARATION_FAILED"]);
  });

  it("writes the game's pin in the committed format", async () => {
    const { pinSource } = await import("./dependencies");
    const pinPath = new URL("../../../apps/game/src/demo/local-real-experiment.pin.server.ts", import.meta.url);
    const committed = await readFile(pinPath, "utf8");
    const pinned = /TRUSTED_ARTIFACT_HASH = "([0-9a-f]{64})"/u.exec(committed)![1]!;
    expect(pinSource(pinned)).toBe(committed);
    expect(pinSource(hash("a"))).toMatch(/^import "server-only";[\s\S]*TRUSTED_ARTIFACT_HASH = "a{64}";\n$/u);
  });

  it("finalizes from responses this run accepted and refuses any request it did not", async () => {
    const command = await import("./index") as Record<string, any>;
    const profile = await loadProfile();
    const capacity = createCapacityMeter({ limits: profile.capacity,
      githubQueryIds: profile.github.queries.map(({ id }) => id), stackLanguages: MAINSTREAM_LANGUAGES });
    let liveRequests = 0;
    const runtime = command.createPreparationRuntime(profile, { PATH: "/bin" }, capacity,
      async () => new Response(JSON.stringify({ sequence: ++liveRequests }), {
        status: 200, headers: { "content-type": "application/json" },
      }));
    const headers = { accept: "application/vnd.github+json", "x-github-api-version": profile.github.apiVersion };
    const commit = { provider: "github", method: "GET", headers,
      url: `https://api.github.com/repos/example/project/commits/${"a".repeat(40)}` };
    const access = { provider: "huggingFace", method: "GET",
      url: "https://huggingface.co/api/datasets/bigcode/the-stack-v2", headers: { accept: "application/json" } };

    expect(await runtime.transport.requestJson(commit)).toEqual({ sequence: 1 });
    expect(await runtime.transport.requestJson(access)).toEqual({ sequence: 2 });
    runtime.beginReplay();
    expect(await runtime.transport.requestJson(commit)).toEqual({ sequence: 1 });
    await expect(runtime.transport.requestJson(access)).rejects.toMatchObject({ code: "FINALIZE_REPLAY_MISS" });
    await expect(runtime.transport.requestJson({ ...commit, url: commit.url.replace("a", "b") }))
      .rejects.toMatchObject({ code: "FINALIZE_REPLAY_MISS" });
    expect(liveRequests).toBe(2);
    expect(capacity.snapshot().requestCount).toBe(2);
  });

  it("reuses an identical GitHub GET within a run and in replay, but never a search page", async () => {
    const command = await import("./index") as Record<string, any>;
    const profile = await loadProfile();
    const capacity = createCapacityMeter({ limits: profile.capacity,
      githubQueryIds: profile.github.queries.map(({ id }) => id), stackLanguages: MAINSTREAM_LANGUAGES });
    let liveRequests = 0;
    const runtime = command.createPreparationRuntime(profile, { PATH: "/bin" }, capacity,
      async () => new Response(JSON.stringify({ sequence: ++liveRequests, items: [] }), {
        status: 200, headers: { "content-type": "application/json" },
      }));
    const headers = { accept: "application/vnd.github+json", "x-github-api-version": profile.github.apiVersion };
    const commit = { provider: "github", method: "GET", headers,
      url: `https://api.github.com/repos/example/project/commits/${"a".repeat(40)}` };
    const search = new URL("https://api.github.com/search/commits");
    search.searchParams.set("q", profile.github.queries[0]!.query);
    search.searchParams.set("sort", "committer-date");
    search.searchParams.set("order", "desc");
    search.searchParams.set("page", "1");
    search.searchParams.set("per_page", "100");
    const page = { provider: "github", method: "GET", headers, url: search.href };

    expect(await runtime.transport.requestJson(commit)).toMatchObject({ sequence: 1 });
    expect(await runtime.transport.requestJson(commit)).toMatchObject({ sequence: 1 });
    expect(await runtime.transport.requestJson(page, 1)).toMatchObject({ sequence: 2 });
    expect(await runtime.transport.requestJson(page, 1)).toMatchObject({ sequence: 3 });
    runtime.beginReplay();
    for (let replayed = 0; replayed < 3; replayed += 1) {
      expect(await runtime.transport.requestJson(commit)).toMatchObject({ sequence: 1 });
    }
    expect(liveRequests).toBe(3);
    expect(capacity.snapshot().requestCount).toBe(3);
  });

  it("screens each repository once before lineage and skips every candidate of a rejected one", async () => {
    const candidates = [...HARNESS_CANDIDATES, { id: 9, queryId: "ordinary-facebook", repository: "org1/repo-1" }];
    const screened: string[] = [];
    const harness = await makeHarness({
      searchGitHub: async () => accepted({ candidates, queryClassifications: classificationsFor(profile) }, "2"),
      screenGitHubRepository: async ({ repository }) => {
        screened.push(repository);
        if (repository === "org1/repo-1") throw Object.assign(new Error("GITHUB_ADMISSION_REJECTED"), { code: "GITHUB_ADMISSION_REJECTED" });
        return accepted({ repository }, "5");
      },
    });
    const profile = await loadProfile();
    await prepareLocalExperiment(harness.dependencies).catch(() => undefined);
    expect(screened.filter((repository) => repository === "org1/repo-1")).toHaveLength(1);
    expect(new Set(screened).size).toBe(screened.length);
    expect(harness.calls.some((call) => call === "lineage:1" || call === "lineage:9")).toBe(false);
    expect(screened.indexOf("org0/repo-0")).toBeGreaterThanOrEqual(0);
    expect(harness.calls.indexOf("lineage:0")).toBeGreaterThan(-1);
  });

  it("screens a Stack row's repository before fetching its blob", async () => {
    const harness = await makeHarness({
      collectStackMetadata: async ({ configuration }) => accepted([{ id: configuration.toLowerCase(),
        detectedLanguage: configuration, repository: "mirror/rejected" }], "5"),
      screenGitHubRepository: async ({ repository }) => {
        if (repository === "mirror/rejected") throw Object.assign(new Error("GITHUB_ADMISSION_REJECTED"), { code: "ADMISSION_REPOSITORY" });
        return accepted({ repository }, "2");
      },
    });
    await prepareLocalExperiment(harness.dependencies);
    expect(harness.calls.some((call) => call.startsWith("fetch:"))).toBe(false);
    expect(harness.calls).toContain("log:PREPARATION_DECK_SKIPPED language DECK_SHORT");
    // The first language finds no row, so the deck cannot fill and no later language is screened.
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "GITHUB_REVALIDATION", reasonCode: "ADMISSION_REPOSITORY", count: 1 });
    expect((harness.reports[0] as any).diagnostics.some(({ reasonCode }: any) => reasonCode === "REPOSITORY_SCREENED_OUT")).toBe(false);
  });

  it("rejects a composed snapshot that disagrees with captured hashes before publication", async () => {
    const harness = await makeHarness({
      compose: () => ({ artifact: { crawlSnapshot: { id: hash("e") }, decks: [] },
        artifactHash: hash("9"), artifactBytes: new Uint8Array([1]), roundRecordSet: {} } as any),
    });

    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(harness.published).toEqual([]);
  });

  it("rejects replay-finalized source bindings that do not use the captured snapshot", async () => {
    const harness = await makeHarness({
      finalizeBindings: async ({ beforeAfterCandidates, projectSelections, languageSelections }) => ({
        beforeAfterCandidates,
        projectCandidates: projectSelections.map(({ candidate }: any) => ({ ...candidate, crawlSnapshotId: hash("e") })),
        languageCandidates: languageSelections.map(({ candidate }: any) => ({ ...candidate, crawlSnapshotId: hash("e") })),
      }),
    });

    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(harness.published).toEqual([]);
  });

  it("binds replayed sources, composition, report, publication, and result to one captured snapshot", async () => {
    let finalizedId = "";
    const harness = await makeHarness({
      finalizeBindings: async ({ crawlSnapshotId, beforeAfterCandidates, projectSelections, languageSelections }) => {
        finalizedId = crawlSnapshotId;
        return {
          beforeAfterCandidates: beforeAfterCandidates.map((candidate: any) => ({ ...candidate, source: { ...(candidate.source ?? {}), crawlSnapshotId } })),
          projectCandidates: projectSelections.map(({ candidate }: any) => ({ ...candidate, crawlSnapshotId })),
          languageCandidates: languageSelections.map(({ candidate }: any) => ({ ...candidate, crawlSnapshotId })),
        };
      },
    });
    const profile = await loadProfile();
    // Preflight, each Stack metadata configuration, search, lineage, and admission, then blobs and revalidation.
    const acceptedResponseHashes = ["1", ...MAINSTREAM_LANGUAGES.map((_, index) => `a${index.toString(16)}`), "2", "3", "4", "7", "8"].map(hash);
    const expected = canonicalHash({ profileHash: canonicalHash(profile), acceptedResponseHashes });

    const result = await prepareLocalExperiment(harness.dependencies);
    expect(finalizedId).toBe(expected);
    expect(result.crawlSnapshotId).toBe(expected);
    expect((harness.reports[0] as any).result.crawlSnapshotId).toBe(expected);
    expect((harness.published[0] as any).artifact.crawlSnapshot.id).toBe(expected);
  });

  it("projects credentials from the environment only and rejects CLI arguments before loading dependencies", async () => {
    expect(projectPreparationEnvironment({
      PATH: "/bin", HF_TOKEN: "hf", GITHUB_TOKEN: "gh", AWS_ACCESS_KEY_ID: "id",
      AWS_SECRET_ACCESS_KEY: "secret", AWS_SESSION_TOKEN: "session", NODE_OPTIONS: "--inspect",
      STACK_V2_ACKNOWLEDGED_USABLE_REVISION: "7".repeat(40), STACK_V2_ACKNOWLEDGED_REVISION: "wrong",
    })).toEqual({
      PATH: "/bin", HF_TOKEN: "hf", GITHUB_TOKEN: "gh", AWS_ACCESS_KEY_ID: "id",
      AWS_SECRET_ACCESS_KEY: "secret", AWS_SESSION_TOKEN: "session",
      STACK_V2_ACKNOWLEDGED_USABLE_REVISION: "7".repeat(40),
    });
    process.argv.splice(0, process.argv.length, "node", "index.ts", "https://example.test/?token=secret");
    const logged: string[] = [];
    await expect(runPreparationCli((message) => { logged.push(message); })).rejects.toThrow("COMMAND_ARGUMENTS_REJECTED");
    expect(logged.join(" ")).not.toMatch(/example\.test|token|secret/u);
  });

  it("prints the stable code and the accepted flags when it gets a mistyped flag, then exits non-zero", async () => {
    for (const argv of [["--ofline"], ["--resume", "--offline"], ["offline"]]) {
      process.argv.splice(0, process.argv.length, "node", "index.ts", ...argv);
      const logged: string[] = [];
      await expect(runPreparationCli((message) => { logged.push(message); })).rejects.toThrow("COMMAND_ARGUMENTS_REJECTED");
      expect(logged).toEqual(["COMMAND_ARGUMENTS_REJECTED", "usage: pnpm prepare:poc [--resume | --offline]"]);
    }
  });

  it("projects only AWS and provider-store values into the selected-blob worker", async () => {
    const command = await import("./index") as Record<string, any>;
    const source = {
      PATH: "/bin", HOME: "/external/home", HF_TOKEN: "hf", GITHUB_TOKEN: "gh",
      AWS_ACCESS_KEY_ID: "id", AWS_SECRET_ACCESS_KEY: "secret", AWS_SESSION_TOKEN: "session",
      AWS_PROFILE: "poc", AWS_SHARED_CREDENTIALS_FILE: "/external/credentials",
      STACK_V2_ACKNOWLEDGED_USABLE_REVISION: "7".repeat(40),
    };

    expect(command.projectBlobWorkerEnvironment(source)).toEqual({
      PATH: "/bin", HOME: "/external/home", AWS_ACCESS_KEY_ID: "id",
      AWS_SECRET_ACCESS_KEY: "secret", AWS_SESSION_TOKEN: "session", AWS_PROFILE: "poc",
      AWS_SHARED_CREDENTIALS_FILE: "/external/credentials",
    });
  });

  it("reads Stack metadata before GitHub discovery, so a Stack failure spends no GitHub requests", async () => {
    const harness = await makeHarness();
    await prepareLocalExperiment(harness.dependencies);
    const first = (prefix: string): number => harness.calls.findIndex((call) => call.startsWith(prefix));
    expect(first("metadata:")).toBeGreaterThan(first("preflight"));
    expect(first("metadata:")).toBeLessThan(first("search"));

    const failing = await makeHarness({
      collectStackMetadata: async () => { throw new StackMetadataError("WORKER_EXIT_NETWORK_LIMIT_REJECTED"); },
    });
    await expect(prepareLocalExperiment(failing.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(failing.calls.some((call) => call === "search" || call.startsWith("lineage:"))).toBe(false);
    expect(logLines(failing.calls)).toEqual([
      "log:PREPARATION_STAGE_FAILED STACK_METADATA WORKER_EXIT_NETWORK_LIMIT_REJECTED none",
      "log:PREPARATION_FAILED",
    ]);
  });

  it("stops at the first spent run-wide budget instead of rejecting every later candidate", async () => {
    let lineageCalls = 0;
    const harness = await makeHarness({
      bindGitHubLineage: async () => {
        lineageCalls += 1;
        throw new RetryError("RETRY_SIGNAL_MISSING", new CapacityError("REQUEST_COUNT"));
      },
    });
    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(lineageCalls).toBe(1);
    expect(harness.calls.some((call) => call.startsWith("fetch:"))).toBe(false);
    expect(logLines(harness.calls).slice(0, 4)).toEqual([
      "log:PREPARATION_DECK_SKIPPED project BUDGET_EXHAUSTED_REQUEST_COUNT",
      "log:PREPARATION_DECK_SKIPPED language BUDGET_EXHAUSTED_REQUEST_COUNT",
      "log:PREPARATION_DECK_SKIPPED before-after BUDGET_EXHAUSTED_REQUEST_COUNT",
      "log:PREPARATION_STAGE_FAILED SELECTION BUDGET_EXHAUSTED_REQUEST_COUNT none",
    ]);
  });

  it("fails the run, publishing nothing, when an offline replay lacks a selected blob's worker output", async () => {
    // The real worker bridge over a real offline journal: the miss is the journal's own error, not a faked chain.
    const offline = emptyOfflineJournal();
    const spawned: unknown[] = [];
    const harness = await makeHarness({
      fetchStackBlob: ({ row, limits, capacity }) => workerStage(() => fetchSelectedBlob({ row: row as StackMetadataRow, limits,
        environment: { PATH: "/bin" }, capacity, runWorker: journaledWorker(offline, async (request) => { spawned.push(request); throw new Error("WORKER_SPAWNED"); }, "code") })),
    });
    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(spawned).toEqual([]);
    expect(harness.published).toEqual([]);
    // The first miss ends the run: no later row is tried, so a replay can never publish a different Stack deck.
    expect(harness.calls.filter((call) => call.startsWith("revalidate:"))).toEqual([]);
    expect(logLines(harness.calls)[0]).toBe("log:PREPARATION_STAGE_FAILED BLOB_RETRIEVAL JOURNAL_MISS none");
  });

  it("fails the run at Stack metadata, naming the miss, when an offline replay lacks the metadata worker's output", async () => {
    const offline = emptyOfflineJournal();
    const harness = await makeHarness({
      collectStackMetadata: (options) => workerStage(() => collectStackMetadata({ profile: options.profile, capacity: options.capacity,
        configuration: options.configuration, rowLimit: options.profile.capacity.stackRowsPerLanguage, environment: options.environment,
        blobAccess: async () => undefined, runWorker: journaledWorker(offline, async () => { throw new Error("WORKER_SPAWNED"); }, "code") })),
    });
    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(harness.calls).not.toContain("search");
    expect(logLines(harness.calls)).toEqual([
      "log:PREPARATION_STAGE_FAILED STACK_METADATA JOURNAL_MISS none",
      "log:PREPARATION_FAILED",
    ]);
  });

  it("publishes the decks filled before a run-wide budget ran out", async () => {
    let fetches = 0;
    const harness = await makeHarness({
      fetchStackBlob: async ({ row }: any) => {
        fetches += 1;
        if (fetches > STACK_POOL) throw new RetryError("RETRY_SIGNAL_MISSING", new CapacityError("BLOB_ATTEMPTS"));
        return accepted({ stableRowId: row.id, byteLength: 80 }, "7");
      },
    });
    await prepareLocalExperiment(harness.dependencies);
    expect(fetches).toBe(STACK_POOL + 1);
    expect(logLines(harness.calls)).toEqual([
      "log:PREPARATION_DECK_SKIPPED language BUDGET_EXHAUSTED_BLOB_ATTEMPTS",
      "log:PREPARATION_DECKS project,before-after",
      "log:PREPARATION_COMPLETE",
    ]);
  });

  it("logs request spend per stage on success and on failure, counts only", async () => {
    const harness = await makeHarness();
    await prepareLocalExperiment(harness.dependencies);
    const spendLine = /^log:PREPARATION_SPEND (?:[A-Z_]+=\d+ )*total=\d+$/u;
    expect(harness.calls.filter((call) => spendLine.test(call))).toHaveLength(1);
    const failing = await makeHarness({ searchGitHub: async () => { throw new GitHubSearchError("GITHUB_SEARCH_ITEM_COUNT"); } });
    await expect(prepareLocalExperiment(failing.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(failing.calls.filter((call) => spendLine.test(call))).toHaveLength(1);
  });

  it("logs stage, reason code, and status class for every failure, naming uncoded ones safely", async () => {
    const uncoded = await makeHarness({
      searchGitHub: async () => { throw new TypeError("Cannot read properties of undefined (reading 'sha') https://example.test/?token=secret"); },
    });
    await expect(prepareLocalExperiment(uncoded.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(logLines(uncoded.calls)).toEqual([
      "log:PREPARATION_STAGE_FAILED DISCOVERY UNCODED_TYPEERROR none",
      "log:PREPARATION_FAILED",
    ]);

    // A revoked token: the search answers 401, which asks for no retry, so the retry controller wraps it.
    const diagnostic = { provider: "github", hostClass: "github", method: "GET", pathTemplate: "/search/commits",
      statusClass: "4xx", reasonCode: "UNSUPPORTED_STATUS" } as const;
    const retry = createRetryController({ maxRunRetries: 1, maxWaitMilliseconds: 1, maxTotalWaitMilliseconds: 1, sleep: async () => undefined });
    const search = await makeHarness({
      searchGitHub: () => retry.execute(async () => { throw new TransportError("UNSUPPORTED_STATUS", diagnostic, 401); }),
    });
    await expect(prepareLocalExperiment(search.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(logLines(search.calls)).toEqual([
      "log:PREPARATION_STAGE_FAILED DISCOVERY UNSUPPORTED_STATUS 4xx",
      "log:PREPARATION_FAILED",
    ]);

    const inconsistent = await makeHarness({
      searchGitHub: async () => { throw new GitHubSearchError("GITHUB_SEARCH_TOTAL_CHANGED"); },
    });
    await expect(prepareLocalExperiment(inconsistent.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(logLines(inconsistent.calls)).toEqual([
      "log:PREPARATION_STAGE_FAILED DISCOVERY GITHUB_SEARCH_TOTAL_CHANGED none",
      "log:PREPARATION_FAILED",
    ]);

    const preflight = await makeHarness({
      preflight: async () => { throw new TransportError("TIMEOUT", { ...diagnostic, provider: "huggingFace", hostClass: "huggingFace",
        pathTemplate: "/datasets/bigcode/the-stack-v2/{resource}", statusClass: "none", reasonCode: "TIMEOUT" }); },
    });
    await expect(prepareLocalExperiment(preflight.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(logLines(preflight.calls)).toEqual([
      "log:PREPARATION_STAGE_FAILED PREFLIGHT TIMEOUT none",
      "log:PREPARATION_FAILED",
    ]);

    const publication = await makeHarness({
      publishArtifact: async () => { throw Object.assign(new Error("PUBLICATION_FAILED"), { code: "PUBLICATION_FAILED" }); },
    });
    await expect(prepareLocalExperiment(publication.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(logLines(publication.calls)).toEqual([
      "log:PREPARATION_STAGE_FAILED PUBLICATION PUBLICATION_FAILED none",
      "log:PREPARATION_FAILED",
    ]);

    const unsafe = await makeHarness({
      searchGitHub: async () => { throw Object.assign(new Error("leak"), { code: "Bearer raw-secret", diagnostic: { statusClass: "https://x/?q=1" } }); },
    });
    await expect(prepareLocalExperiment(unsafe.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(logLines(unsafe.calls)).toEqual([
      "log:PREPARATION_STAGE_FAILED DISCOVERY UNCODED_ERROR none",
      "log:PREPARATION_FAILED",
    ]);
  });

  it("names the generation, report, and curated-file stages when they fail, with the selection counts", async () => {
    const counts = "log:PREPARATION_COUNTS discovered=8 admitted=5 duplicates=0";
    const rejections = "log:PREPARATION_REJECTIONS SCREENING:LANGUAGE_ROUNDS_REJECTED=1";
    // Composition refuses every deck in turn (#32): each is skipped with the code, and with none left the run fails.
    const composing = await makeHarness({ compose: () => { throw Object.assign(new Error("EXPERIMENT_COMPOSITION_REJECTED"), { code: "DECK_SIZE_PROJECT" }); } });
    await expect(prepareLocalExperiment(composing.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(logLines(composing.calls)).toEqual([
      ...["project", "language", "before-after"].map((deck) => `log:PREPARATION_DECK_SKIPPED ${deck} DECK_SIZE_PROJECT`),
      "log:PREPARATION_STAGE_FAILED GENERATION DECK_SIZE_PROJECT none", counts,
      "log:PREPARATION_REJECTIONS SCREENING:LANGUAGE_ROUNDS_REJECTED=1 SELECTION:BEFORE_AFTER_DECK_SKIPPED=1 SELECTION:LANGUAGE_DECK_SKIPPED=1 SELECTION:PROJECT_DECK_SKIPPED=1",
      "log:PREPARATION_FAILED",
    ]);

    // The real run-report parser, given a selected count above its bound (v5 run 1's failure).
    const reporting = await makeHarness({ createReport: (input: any) => createRunReport({ ...input, counts: { ...input.counts, selected: 10_000 } }) });
    await expect(prepareLocalExperiment(reporting.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(logLines(reporting.calls)).toEqual([
      "log:PREPARATION_STAGE_FAILED REPORT EXPERIMENT_RECORD_REJECTED none", counts, rejections, "log:PREPARATION_FAILED",
    ]);
    expect(reporting.calls).not.toContain("report:stage");

    const curated = await makeHarness({ bindCuratedFile: async () => { throw new JournalError("JOURNAL_MISS"); } },
      { profile: loadCuratedProfile({ beforeAfterPool: 5 }), curatedFiles: curatedFiles() });
    await expect(prepareLocalExperiment(curated.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(logLines(curated.calls)).toEqual([
      "log:PREPARATION_STAGE_FAILED CURATED_FILES JOURNAL_MISS none", counts, rejections, "log:PREPARATION_FAILED",
    ]);
  });

  it("logs pool counts and per-stage rejection codes when selection fails, never candidate detail", async () => {
    const harness = await makeHarness({
      admitGitHubCandidate: async ({ candidate }) => {
        // A coded rejection whose message carries candidate detail: only its code may reach the log.
        throw (candidate as any).id % 2 === 0 ? new Error("LICENSE_REJECTED")
          : Object.assign(new Error("https://github.com/owner/repo secret"), { code: "ADMISSION_REPOSITORY" });
      },
      collectStackMetadata: async () => accepted([], "5"),
    });
    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(logLines(harness.calls)).toEqual([
      "log:PREPARATION_DECK_SKIPPED project DECK_SHORT",
      "log:PREPARATION_DECK_SKIPPED language DECK_SHORT",
      "log:PREPARATION_DECK_SKIPPED before-after DECK_SHORT",
      "log:PREPARATION_STAGE_FAILED SELECTION DECK_SHORT none",
      "log:PREPARATION_COUNTS discovered=8 admitted=0 duplicates=0",
      "log:PREPARATION_REJECTIONS ADMISSION:ADMISSION_REPOSITORY=4 ADMISSION:LICENSE_REJECTED=4 "
        + "SELECTION:BEFORE_AFTER_DECK_SKIPPED=1 SELECTION:LANGUAGE_DECK_SKIPPED=1 SELECTION:PROJECT_DECK_SKIPPED=1",
      "log:PREPARATION_FAILED",
    ]);
    expect(harness.calls.join(" ")).not.toMatch(/owner\/repo|secret/u);
  });

  it("fails the run on a programming error inside one candidate instead of rejecting every candidate", async () => {
    let revalidations = 0;
    function misreadRevalidation(): never { revalidations += 1; throw new TypeError("Cannot read properties of undefined (reading 'sha') https://example.test/x"); }
    const harness = await makeHarness({ revalidateStackCandidate: async () => misreadRevalidation() });
    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(revalidations).toBe(1);
    expect(harness.published).toEqual([]);
    expect(logLines(harness.calls)[0]).toBe("log:PREPARATION_STAGE_FAILED BLOB_RETRIEVAL UNCODED_TYPEERROR none");
    expect(harness.calls).toContain("log:PREPARATION_FAILURE_SITE misreadRevalidation@command.test.ts");
    expect(harness.calls.join(" ")).not.toMatch(/example\.test|Cannot read/u);

    // The same holds when the retry controller wrapped it, and for an error with no stable code at all.
    let lineages = 0;
    const wrapped = await makeHarness({ bindGitHubLineage: async () => {
      lineages += 1;
      throw new RetryError("RETRY_SIGNAL_MISSING", new RangeError("Invalid count value: -1"));
    } });
    await expect(prepareLocalExperiment(wrapped.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(logLines(wrapped.calls)[0]).toBe("log:PREPARATION_STAGE_FAILED ADMISSION UNCODED_RANGEERROR none");
    expect(lineages).toBe(1);

    const uncoded = await makeHarness({ admitGitHubCandidate: async () => { throw new Error("https://github.com/owner/repo secret"); } });
    await expect(prepareLocalExperiment(uncoded.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(logLines(uncoded.calls)[0]).toBe("log:PREPARATION_STAGE_FAILED ADMISSION UNCODED_ERROR none");
    expect(uncoded.calls.filter((call) => call.startsWith("admit:") || call.startsWith("lineage:"))).toEqual(["lineage:0"]);
    expect(uncoded.calls.join(" ")).not.toMatch(/owner\/repo|secret/u);
  });

  it("fails the run with INVARIANT_REJECTED when a revalidated Stack file's language differs from its row's", async () => {
    const harness = await makeHarness({ revalidateStackCandidate: async ({ row }: any) => accepted({ ...row, detectedLanguage: "Cobol" }, "8") });
    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(harness.calls.filter((call) => call.startsWith("fetch:"))).toHaveLength(1);
    expect(logLines(harness.calls)[0]).toBe("log:PREPARATION_STAGE_FAILED BLOB_RETRIEVAL INVARIANT_REJECTED none");
  });

  it("reports the transport cause behind a wrapped retry failure as the rejection code", async () => {
    const diagnostic = { provider: "github", hostClass: "github", method: "GET", pathTemplate: "/repos/{owner}/{repository}/{resource}",
      statusClass: "none", reasonCode: "REQUEST_LIMIT" } as const;
    const harness = await makeHarness({
      bindGitHubLineage: async () => { throw new RetryError("RETRY_SIGNAL_MISSING", new TransportError("REQUEST_LIMIT", diagnostic)); },
    });
    await prepareLocalExperiment(harness.dependencies);
    // Every one of the eight commits is rejected by its lineage request's transport cause.
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "DISCOVERY", reasonCode: "REQUEST_LIMIT", count: 8 });
    expect(harness.calls).toContain("log:PREPARATION_DECK_SKIPPED before-after DECK_SHORT");
  });

  it("screens Stack rows by the profile licence allowlist before any blob is fetched", async () => {
    const harness = await makeHarness({
      collectStackMetadata: metadataFrom(stackRowsWith([
        harnessRow("Python", "py-gpl", { stableRowId: "1", detectedLicenses: ["GPL-3.0"] }),
        harnessRow("Python", "py-mixed", { stableRowId: "2", detectedLicenses: ["MIT", "GPL-3.0"] }),
        harnessRow("Python", "py-empty", { stableRowId: "3", detectedLicenses: [] }),
        harnessRow("Python", "py-reject", { stableRowId: "4", detectedLicenses: ["MIT"] }),
        harnessRow("Python", "py", { stableRowId: "5", detectedLicenses: ["Apache-2.0"] }),
        harnessRow("Python", "py-2", { stableRowId: "6", detectedLicenses: ["BSD-3-Clause"] }),
      ])),
    });

    await prepareLocalExperiment(harness.dependencies);

    const fetched = harness.calls.filter((call) => call.startsWith("fetch:") && !call.includes("-pop-")).map((call) => call.split(":")[1]);
    expect(fetched).toEqual(DEFAULT_LANGUAGE_ROWS);
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "SCREENING", reasonCode: "LICENSE_REJECTED", count: 3 });
  });

  it("names the failing function and file after every stage failure, without line numbers or data", async () => {
    function explodeInsideSearch(): never { throw new TypeError("Bearer leaked https://example.test/?token=x"); }
    const harness = await makeHarness({ searchGitHub: async () => explodeInsideSearch() });
    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    const site = harness.calls.find((call) => call.startsWith("log:PREPARATION_FAILURE_SITE "));
    expect(site).toBe("log:PREPARATION_FAILURE_SITE explodeInsideSearch@command.test.ts");
    expect(harness.calls.join(" ")).not.toMatch(/leaked|example\.test|token=|:\d+:\d+/u);
  });

  it("skips candidates whose public code would reveal a protected value and keeps selecting", async () => {
    const captured = beforeAfterIds();
    const harness = await makeHarness({
      admitGitHubCandidate: async ({ candidate }) => {
        const id = (candidate as any).id;
        const lineage = { ...(candidate as object), afterExcerpt: id === 1 ? "// Licensed under the MIT License\nexport const x = 1;" : `export const value${id} = ${id};` };
        return admittedWith(lineage, { licenseSpdx: "MIT" });
      },
      generateBeforeAfter: captured.generate,
      collectStackMetadata: metadataFrom(stackRowsWith([
        harnessRow("Python", "py-leak", { stableRowId: "1" }), harnessRow("Python", "py", { stableRowId: "2" }),
      ])),
      revalidateStackCandidate: async ({ row }: any) => accepted({ ...row,
        excerpt: row.id === "py-leak" ? `# see ${row.path}\nprint(1)` : "print(1)" }, "8"),
    });

    await prepareLocalExperiment(harness.dependencies);
    expect(captured.ids).not.toContain(1);
    expect(captured.ids).toHaveLength(5);
    expect(harness.calls).toContain("eligible:py");
    expect((harness.reports[0] as any).diagnostics).toContainEqual({ stage: "SCREENING", reasonCode: "PUBLIC_CONTAINMENT_REJECTED", count: 2 });
  });

  it("keeps game and browser code out of the command and redacts top-level failures", async () => {
    for (const module of COMMAND_MODULES) {
      expect(await sourceOf(module)).not.toMatch(/from\s+["'][^"']*(?:apps\/game|next\/|playwright)|startGame|demo-game/u);
    }
    expect(await sourceOf("dependencies")).toMatch(/publishArtifact: publishWithPin,/u);
    expect(await sourceOf("dependencies")).toMatch(/targetPath: ARTIFACT_PATH,\s+beforeCommit: async \(\) => \{\s+await input\.beforeCommit\?\.\(\);\s+await writeAtomically\(PIN_PATH/u);
    const messages: string[] = [];
    const harness = await makeHarness({
      preflight: async () => { throw new Error("Bearer raw-secret account@example.test"); },
      log: (message) => { messages.push(message); },
    });
    await expect(prepareLocalExperiment(harness.dependencies)).rejects.toThrow("PREPARATION_FAILED");
    expect(messages.filter((message) => !/^PREPARATION_(?:FAILURE_SITE|SPEND) /u.test(message))).toEqual(["PREPARATION_STAGE_FAILED PREFLIGHT UNCODED_ERROR none", "PREPARATION_FAILED"]);
    expect(messages.some((message) => /^PREPARATION_FAILURE_SITE [A-Za-z0-9_$.<>]+@[A-Za-z0-9_.-]+\.[cm]?[jt]sx?$/u.test(message))).toBe(true);
    expect(messages.join(" ")).not.toMatch(/raw-secret|@example|Bearer/u);
  });
});
