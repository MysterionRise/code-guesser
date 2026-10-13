import { readFile } from "node:fs/promises";

import {
  AUTHORIZED_QUERIES,
  CrawlProfileError,
  SIGNED_CAPACITY_CEILINGS,
  parseCrawlProfile,
} from "./profile";

const profilePath = new URL("../profiles/local-real-rounds.v2.json", import.meta.url);
const legacyProfilePath = new URL("../profiles/local-real-rounds.v1.json", import.meta.url);
const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const validProfile = async (): Promise<Record<string, any>> =>
  JSON.parse(await readFile(profilePath, "utf8")) as Record<string, any>;
const rejects = (value: unknown): void => {
  expect(() => parseCrawlProfile(value)).toThrow(CrawlProfileError);
};

describe("local crawl profile v2", () => {
  it("loads the signed profile with the exact dataset pin and five language configurations", async () => {
    const profile = parseCrawlProfile(await validProfile());

    expect(profile.profileVersion).toBe("local-real-rounds.v2");
    expect(profile.stack.release).toBe("v2.2.0");
    expect(profile.stack.revision).toBe("e565caa3a78c2423bd374333a472b049eb090e47");
    expect(profile.stack.configurations).toEqual([
      { language: "Python", configuration: "Python", extensions: [".py"] },
      { language: "TypeScript", configuration: "TypeScript", extensions: [".ts", ".tsx"] },
      { language: "Go", configuration: "Go", extensions: [".go"] },
      { language: "Rust", configuration: "Rust", extensions: [".rs"] },
      { language: "Ruby", configuration: "Ruby", extensions: [".rb"] },
    ]);
  });

  it("binds exactly the eight query tuples signed in revisions 12 and 13", async () => {
    const profile = parseCrawlProfile(await validProfile());

    expect(profile.github.queries.map(({ id, role }) => `${id}:${role}`)).toEqual([
      "ai-copilot-github:ai-credit", "ai-copilot-microsoft:ai-credit", "ai-claude-github:ai-credit",
      "ai-claude-vercel:ai-credit", "ordinary-facebook:ordinary", "ordinary-google:ordinary",
      "ordinary-vercel:ordinary", "ordinary-github:ordinary",
    ]);
    expect(profile.github.queries).toEqual(AUTHORIZED_QUERIES);
    expect(profile.github.queries.find(({ id }) => id === "ai-claude-github")!.query)
      .toBe("\"Co-Authored-By: Claude\" org:github committer-date:2026-09-02..2026-09-30 merge:false is:public");
    expect(profile.github.queries.find(({ id }) => id === "ordinary-vercel")!.query)
      .toBe("refactor org:vercel committer-date:2026-08-01..2026-08-31 merge:false is:public");
    expect(profile.github.queries.find(({ id }) => id === "ordinary-github")!.query)
      .toBe("refactor org:github committer-date:2026-08-01..2026-08-31 merge:false is:public");
  });

  it("rejects any change to a query literal, role, order, sort, or the query set", async () => {
    const base = await validProfile();
    const mutations: ((profile: any) => void)[] = [
      (profile) => { profile.github.queries[0].query += " "; },
      (profile) => { profile.github.queries[0].query = profile.github.queries[0].query.replace("09-01", "09-02"); },
      (profile) => { profile.github.queries[4].role = "ai-credit"; },
      (profile) => { profile.github.queries[1].order = "asc"; },
      (profile) => { profile.github.queries[1].sort = "author-date"; },
      (profile) => { profile.github.queries.pop(); },
      (profile) => { profile.github.queries.reverse(); },
      (profile) => { profile.github.queries.push({ ...profile.github.queries[0], id: "extra" }); },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(base);
      mutate(changed);
      rejects(changed);
    }
  });

  it("rejects the revision 11 profile because revision 12 replaced it", async () => {
    rejects(JSON.parse(await readFile(legacyProfilePath, "utf8")));
  });

  it("binds the FR-034 AI-credit markers exactly", async () => {
    const profile = parseCrawlProfile(await validProfile());

    expect(profile.aiCredits).toEqual({
      trailers: [
        { assistant: "GitHub Copilot", key: "Co-authored-by", names: ["Copilot", "Copilot App", "GitHub Copilot"], domain: "users.noreply.github.com" },
        { assistant: "Claude", key: "Co-authored-by", names: ["Claude"], domain: "anthropic.com" },
      ],
      literals: [{ assistant: "GitHub Copilot", line: "Generated-by: Copilot" }],
    });
    for (const mutate of [
      (profile: any) => { profile.aiCredits.trailers[1].domain = "example.com"; },
      (profile: any) => { profile.aiCredits.trailers[0].names.push("Bot"); },
      (profile: any) => { profile.aiCredits.literals = []; },
    ]) {
      const changed = structuredClone(await validProfile());
      mutate(changed);
      rejects(changed);
    }
  });

  it("accepts each signed v2 capacity exactly and rejects its first over-ceiling value", async () => {
    expect(SIGNED_CAPACITY_CEILINGS.requestCount).toBe(600);
    expect(SIGNED_CAPACITY_CEILINGS.stackMetadataBytes).toBe(96 * 1024 * 1024);
    const base = await validProfile();
    expect(parseCrawlProfile(base).capacity).toEqual(SIGNED_CAPACITY_CEILINGS);
    for (const key of Object.keys(SIGNED_CAPACITY_CEILINGS)) {
      const changed = structuredClone(base);
      changed.capacity[key] = (SIGNED_CAPACITY_CEILINGS as Record<string, number>)[key]! + 1;
      rejects(changed);
    }
  });

  it("binds the deck composition and candidate counts", async () => {
    const profile = parseCrawlProfile(await validProfile());

    expect(profile.selection).toEqual({
      projectRounds: 5, languageRounds: 5, aiRounds: 5,
      projectCandidates: 4, languageCandidates: 4, aiMinimumPerOutcome: 2,
    });
    for (const [key, value] of [["projectRounds", 3], ["languageRounds", 2], ["aiMinimumPerOutcome", 1], ["languageCandidates", 2]] as const) {
      const changed = structuredClone(await validProfile());
      changed.selection[key] = value;
      rejects(changed);
    }
  });

  it("requires language clue templates that never name a candidate or extension", async () => {
    const profile = parseCrawlProfile(await validProfile());
    expect(profile.templates.language.languages.map(({ language, distractors }) => `${language}:${distractors.join("/")}`)).toEqual([
      "Python:Ruby/JavaScript/PHP", "TypeScript:JavaScript/Java/C#", "Go:Rust/C++/Java",
      "Rust:Go/C++/Swift", "Ruby:Python/PHP/Kotlin",
    ]);
    for (const mutate of [
      (value: any) => { value.templates.language.languages[0].clues[0] = "This is Python."; },
      (value: any) => { value.templates.language.languages[0].clues[1] = "Files end in .py here."; },
      (value: any) => { value.templates.language.languages[1].clues[0] = "Unlike JavaScript, it has types."; },
      (value: any) => { value.templates.language.languages[0].distractors = ["Ruby", "Ruby", "PHP"]; },
      (value: any) => { value.templates.language.languages[0].distractors = ["Ruby", "Python", "PHP"]; },
      (value: any) => { value.templates.language.languages[0].distractors = ["Ruby", "Cobol", "PHP"]; },
      (value: any) => { value.templates.language.languages.pop(); },
    ]) {
      const changed = structuredClone(await validProfile());
      mutate(changed);
      rejects(changed);
    }
  });

  it("requires honest AI-deck wording and the exact template placeholders", async () => {
    const profile = parseCrawlProfile(await validProfile());
    expect(profile.templates.ai.prompt).toBe("Is this AI-generated?");
    expect(profile.templates.ai.absentCandidate).toBe("No AI credit on this commit");
    for (const mutate of [
      (value: any) => { value.templates.ai.absentCandidate = "Human-written"; },
      (value: any) => { value.templates.ai.absentEvidence = "A human wrote this code."; },
      (value: any) => { value.templates.ai.explanation = "Our detector analyzed the code style."; },
      (value: any) => { value.templates.ai.recordedEvidence = "The commit message credits an assistant."; },
      (value: any) => { value.templates.project.ownerClue = "The project is {repository}."; },
      (value: any) => { value.templates.ai.notice = ""; },
    ]) {
      const changed = structuredClone(await validProfile());
      mutate(changed);
      rejects(changed);
    }
  });

  it("rejects unknown or missing fields, URLs, and credential material at any depth", async () => {
    const base = await validProfile();
    for (const mutate of [
      (value: any) => { delete value.aiCredits; },
      (value: any) => { value.extra = true; },
      (value: any) => { value.templates.project.extra = "x"; },
      (value: any) => { value.templates.project.description = "See https://example.test"; },
      (value: any) => { value.templates.ai.description = "token=abc123"; },
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
    expect(Object.isFrozen(profile.templates.language.languages[0]!.clues)).toBe(true);
    expect(Object.isFrozen(profile.aiCredits.trailers[0]!.names)).toBe(true);
  });
});
