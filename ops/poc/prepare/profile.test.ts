import { readFile } from "node:fs/promises";

import { CAPACITY_CEILINGS, CrawlProfileError, parseCrawlProfile } from "./profile";

const profilePath = new URL("../profiles/local-real-rounds.v3.json", import.meta.url);
const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const validProfile = async (): Promise<Record<string, any>> =>
  JSON.parse(await readFile(profilePath, "utf8")) as Record<string, any>;
const rejects = (value: unknown): void => {
  expect(() => parseCrawlProfile(value)).toThrow(CrawlProfileError);
};

describe("local crawl profile v3", () => {
  it("loads the profile with the pinned dataset and the five language configurations", async () => {
    const profile = parseCrawlProfile(await validProfile());
    expect(profile.profileVersion).toBe("local-real-rounds.v3");
    expect(profile.stack.revision).toBe("e565caa3a78c2423bd374333a472b049eb090e47");
    expect(profile.stack.configurations).toEqual([
      { language: "Python", configuration: "Python", extensions: [".py"] },
      { language: "TypeScript", configuration: "TypeScript", extensions: [".ts", ".tsx"] },
      { language: "Go", configuration: "Go", extensions: [".go"] },
      { language: "Rust", configuration: "Rust", extensions: [".rs"] },
      { language: "Ruby", configuration: "Ruby", extensions: [".rb"] },
    ]);
    expect(profile.selection).toEqual({ projectPool: 10, languagePool: 10, beforeAfterPool: 10, minimumStarEvents: 1000 });
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
      (value: any) => { value.selection.languagePool = 4; },
      (value: any) => { value.selection.projectPool = 41; },
      (value: any) => { value.selection.minimumStarEvents = 0; },
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
      (value: any) => { value.templates.language.explanation = "Our detector says so."; },
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
