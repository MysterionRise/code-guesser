import { readFile } from "node:fs/promises";

import { CAPACITY_CEILINGS, CrawlProfileError, parseCrawlProfile, poolSizes } from "./profile";
import { CURATED_REPOSITORIES, FIX_SECTION, OUTPUT_SECTION } from "./testdata/deck-builders";

const profilePath = new URL("../profiles/local-real-rounds.v5.json", import.meta.url);
const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const validProfile = async (): Promise<Record<string, any>> =>
  JSON.parse(await readFile(profilePath, "utf8")) as Record<string, any>;
const rejects = (value: unknown): void => {
  expect(() => parseCrawlProfile(value)).toThrow(CrawlProfileError);
};

describe("local crawl profile v6 (#129)", () => {
  const v6 = async (): Promise<Record<string, any>> =>
    JSON.parse(await readFile(new URL("../profiles/local-real-rounds.v6.json", import.meta.url), "utf8")) as Record<string, any>;

  it("configures every v1.0 deck built so far, the rarer languages for the language deck alone, and the wider allowlist", async () => {
    const profile = parseCrawlProfile(await v6());
    expect(profile.profileVersion).toBe("local-real-rounds.v6");
    expect(profile.licenses).toEqual(["Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MIT", "Python-2.0"]);
    expect(profile.stack.configurations).toHaveLength(26);
    expect(profile.stack.configurations.slice(12).every(({ projectDeck }) => projectDeck === false)).toBe(true);
    expect(poolSizes(profile)).toEqual({ project: 24, language: 52, "before-after": 20, algorithm: 24, output: 24, fix: 24, "missing-line": 24,
      "name-function": 24, framework: 32, exercise: 48, "vulnerable-line": 0 });
    expect(profile.capacity).toEqual(CAPACITY_CEILINGS);
  });

  it("keeps v5's sections as they were, so only the additions differ", async () => {
    const [five, six] = [await validProfile(), await v6()];
    for (const key of ["algorithm", "output", "fix"]) expect(six.curated[key]).toEqual(five.curated[key]);
    expect(six.stack.configurations.slice(0, 12)).toEqual(five.stack.configurations);
    expect(six.curated.repositories.slice(0, 3)).toEqual(five.curated.repositories);
  });

  it("refuses a profile version it does not know", async () => {
    rejects({ ...(await v6()), profileVersion: "local-real-rounds.v7" });
  });
});

describe("local crawl profile v5", () => {
  it("loads the profile with the pinned dataset and twelve languages in look-alike pairs", async () => {
    const profile = parseCrawlProfile(await validProfile());
    expect(profile.profileVersion).toBe("local-real-rounds.v5");
    expect(profile.stack.revision).toBe("e565caa3a78c2423bd374333a472b049eb090e47");
    expect(profile.stack.configurations).toEqual([
      { language: "Python", configuration: "Python", extensions: [".py"] },
      { language: "Ruby", configuration: "Ruby", extensions: [".rb"] },
      { language: "TypeScript", configuration: "TypeScript", extensions: [".ts", ".tsx"] },
      { language: "JavaScript", configuration: "JavaScript", extensions: [".js"] },
      { language: "Go", configuration: "Go", extensions: [".go"] },
      { language: "Rust", configuration: "Rust", extensions: [".rs"] },
      { language: "Java", configuration: "Java", extensions: [".java"] },
      { language: "C#", configuration: "C#", extensions: [".cs"] },
      { language: "Kotlin", configuration: "Kotlin", extensions: [".kt"] },
      { language: "Swift", configuration: "Swift", extensions: [".swift"] },
      { language: "C", configuration: "C", extensions: [".c"] },
      { language: "C++", configuration: "C++", extensions: [".cpp", ".cc", ".cxx", ".hpp"] },
    ]);
    expect(profile.selection).toEqual({
      beforeAfterPool: 10, minimumStarEvents: 1000, popularRepositories: 24, filesPerRepository: 3, ordinaryRows: 200,
    });
    // The run profile carries the curated section: three more decks of 24 rounds.
    expect(poolSizes(profile)).toEqual({ project: 24, language: 24, "before-after": 10, algorithm: 24, output: 24, fix: 24, "missing-line": 0, "name-function": 0,
      framework: 0, exercise: 0, "vulnerable-line": 0 });
    expect(profile.curated!.repositories.map(({ repository }) => repository)).toEqual(["TheAlgorithms/Python", "TheAlgorithms/Go", "TheAlgorithms/Java"]);
  });

  it("accepts the curated section the go-live profile will carry, and rejects a hint that names its family", async () => {
    const curated = JSON.parse(await readFile(new URL("./testdata/curated-section.json", import.meta.url), "utf8"));
    const profile = parseCrawlProfile({ ...(await validProfile()), curated });
    expect(profile.curated!.repositories.map(({ language }) => language)).toEqual(["Python", "Go", "Java"]);
    expect(profile.curated!.algorithm!.families).toHaveLength(8);
    expect(poolSizes(profile).algorithm).toBe(24);
    expect(poolSizes(profile).output).toBe(24);
    expect(poolSizes(profile).fix).toBe(24);
    expect(profile.curated!.fix!.datasets.map(({ projects }) => projects.length)).toEqual([15, 13]);
    expect(profile.curated!.output!.directories).toHaveLength(6);
    for (const mutate of [
      (value: any) => { value.algorithm.families[0].algorithms[0].idea = "Unlike insertion sort, it swaps neighbours."; },
      (value: any) => { value.algorithm.families[1].note = "Quicksort and its friends."; },
      (value: any) => { value.algorithm.families[0].algorithms.pop(); },
      (value: any) => { value.algorithm.rounds = 26; },
      (value: any) => { value.repositories[0].commit = "master"; },
      (value: any) => { value.algorithm.families[0].algorithms[0].files["Unknown/Repo"] = { path: "a.py", symbols: [] }; },
      (value: any) => { value.algorithm.families[0].algorithms[0].files["TheAlgorithms/Go"].symbols = ["not an identifier"]; },
    ]) {
      const changed = structuredClone(curated);
      mutate(changed);
      rejects({ ...(await validProfile()), curated: changed });
    }
  });

  it("accepts an output deck over a curated Python pin, and rejects one it could not fill fairly", async () => {
    const curated = { repositories: CURATED_REPOSITORIES, output: OUTPUT_SECTION };
    const profile = parseCrawlProfile({ ...(await validProfile()), curated });
    expect(profile.curated!.output!.directories).toEqual(["maths", "strings"]);
    expect(poolSizes(profile).output).toBe(8);
    expect(poolSizes(profile).algorithm).toBe(0);
    for (const change of [
      { rounds: 10 }, { rounds: 4 }, { repository: "algos/go" }, { repository: "other/python" }, { directories: ["maths/sub"] },
      { directories: ["maths", "maths"] }, { fileReads: 7 }, { fileReads: 241 },
      { templates: { ...OUTPUT_SECTION.templates, evidence: "The docstring in {path} records {call}." } },
    ]) {
      rejects({ ...(await validProfile()), curated: { ...curated, output: { ...OUTPUT_SECTION, ...change } } });
    }
  });

  it("accepts a fix deck over two bug datasets, and rejects one it could not fill fairly", async () => {
    const curated = { repositories: CURATED_REPOSITORIES, fix: FIX_SECTION };
    const profile = parseCrawlProfile({ ...(await validProfile()), curated });
    expect(profile.curated!.fix!.datasets.map(({ id }) => id)).toEqual(["defects4j", "bugsinpy"]);
    expect(poolSizes(profile).fix).toBe(8);
    const dataset = FIX_SECTION.datasets[0]!;
    for (const change of [
      { rounds: 10 }, { patchReads: 7 }, { patchReads: 241 }, { perRepository: 5 },
      { datasets: [{ ...dataset, id: "swe-bench" }] }, { datasets: [dataset, dataset] }, { datasets: [{ ...dataset, commit: "main" }] },
      { datasets: [{ ...dataset, projects: [] }] }, { datasets: [{ ...dataset, projects: [{ name: "Calc", repository: "calc/calc", language: "Cobol" }] }] },
      { datasets: [{ ...dataset, projects: [dataset.projects[0], dataset.projects[0]] }] },
      { templates: { ...FIX_SECTION.templates, evidence: "{dataset} records bug {bug}." } },
    ]) {
      rejects({ ...(await validProfile()), curated: { ...curated, fix: { ...FIX_SECTION, ...change } } });
    }
  });

  it("accepts any distinct commit searches and rejects a repeated or malformed one", async () => {
    const base = await validProfile();
    const profile = parseCrawlProfile(base);
    expect(profile.github.queries.length).toBeGreaterThan(0);
    expect(profile.github.queries.every(({ query }) => query.startsWith("refactor "))).toBe(true);
    for (const mutate of [
      (value: any) => { value.github.queries.push({ ...value.github.queries[0] }); },
      (value: any) => { value.github.queries[0].order = "asc"; },
      (value: any) => { value.github.queries[0].id = "Not An Id"; },
      (value: any) => { value.github.queries[0].role = "ordinary"; },
      (value: any) => { value.github.queries = []; },
    ]) {
      const changed = structuredClone(base);
      mutate(changed);
      rejects(changed);
    }
  });

  it("keeps every capacity within the shared ceilings", async () => {
    const base = await validProfile();
    expect(parseCrawlProfile(base).capacity.requestCount).toBeLessThanOrEqual(CAPACITY_CEILINGS.requestCount);
    for (const key of Object.keys(CAPACITY_CEILINGS)) {
      const changed = structuredClone(base);
      changed.capacity[key] = (CAPACITY_CEILINGS as Record<string, number>)[key]! + 1;
      rejects(changed);
    }
  });

  it("bounds every pool to one to eight sessions and keeps screening limits consistent", async () => {
    const base = await validProfile();
    for (const mutate of [
      (value: any) => { value.selection.beforeAfterPool = 4; },
      (value: any) => { value.selection.beforeAfterPool = 41; },
      (value: any) => { value.selection.projectPool = 10; },
      (value: any) => { value.selection.minimumStarEvents = 0; },
      (value: any) => { value.selection.popularRepositories = 101; },
      (value: any) => { value.selection.filesPerRepository = 11; },
      (value: any) => { value.selection.ordinaryRows = 1001; },
      (value: any) => { value.screening.minimumExcerptBytes = value.screening.excerptBytes; },
      (value: any) => { value.screening.maxChangedLines = value.screening.changeWindowLines; },
    ]) {
      const changed = structuredClone(base);
      mutate(changed);
      rejects(changed);
    }
  });

  it("requires each template's exact placeholders and no authorship claim", async () => {
    const base = await validProfile();
    for (const mutate of [
      (value: any) => { value.templates.project.fileClue = "The file is named."; },
      (value: any) => { value.templates.language.syntaxClue = "Look for {syntax} and {syntax}."; },
      (value: any) => { value.templates.beforeAfter.linesClue = "Removed {removed}."; },
      (value: any) => { value.templates.beforeAfter.description = "Spot the human-written version."; },
      (value: any) => { value.templates.language.explanation = "Our AI detector says so."; },
    ]) {
      const changed = structuredClone(base);
      mutate(changed);
      rejects(changed);
    }
  });

  it("rejects unknown or missing fields, URLs, and credential material at any depth", async () => {
    const base = await validProfile();
    for (const mutate of [
      (value: any) => { delete value.licenses; },
      (value: any) => { value.extra = true; },
      (value: any) => { value.templates.project.extra = "x"; },
      (value: any) => { value.templates.project.description = "See https://example.test"; },
      (value: any) => { value.templates.language.description = "token=abc123"; },
      (value: any) => { value.aiCredits = {}; },
    ]) {
      const changed = structuredClone(base);
      mutate(changed);
      rejects(changed);
    }
  });

  it("returns a recursively immutable profile", async () => {
    const profile = parseCrawlProfile(await validProfile());
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.github.queries[0])).toBe(true);
    expect(Object.isFrozen(profile.templates.beforeAfter)).toBe(true);
  });
});
