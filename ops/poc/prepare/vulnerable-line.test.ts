import { readFileSync } from "node:fs";

import { namesAdvisory, parseArtifactDecks, vulnerableLineHint } from "../../../packages/artifact/src/index";
import { composeExperimentArtifact } from "./compose";
import { advisoryListingUrl, readAdvisories, readAdvisoryFix } from "./github-advisories";
import { parseCrawlProfile, poolSizes } from "./profile";
import { authorizeRequest } from "./request-policy";
import { VULNERABLE_LINE_SECTION, composeInput, loadCuratedProfile, loadDeckProfile, snapshotIdFor, syntheticAdvisory, vulnerableLineCandidates } from "./testdata/deck-builders";
import { generateVulnerableLineRounds } from "./vulnerable-line-rounds";

// The operator typecheck keeps vitest types out of its program, as the other ops suites do.
const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const deckProfile = loadDeckProfile();
const github = (http: ReadonlyMap<string, unknown>) => ({
  profile: deckProfile, retry: { execute: <Value>(operation: () => Promise<Value>) => operation() },
  transport: { requestJson: async (input: { url: string }) => {
    if (!http.has(input.url)) throw new Error("UNEXPECTED_REQUEST");
    return structuredClone(http.get(input.url));
  } },
}) as any;
const codeOf = async (promise: Promise<unknown>): Promise<unknown> => promise.then(() => "RESOLVED", (error: Error) => error.message);

describe("advisory listings (#59)", () => {
  const ghsa = syntheticAdvisory(1);
  const advisory = (overrides: Record<string, unknown> = {}) => ({
    ghsa_id: ghsa, type: "reviewed", url: `https://api.github.com/advisories/${ghsa}`, html_url: `https://github.com/advisories/${ghsa}`,
    published_at: "2024-02-03T04:05:06Z", withdrawn_at: null, description: "never kept", credits: [{ user: { login: "someone" } }],
    references: [
      "https://github.com/Acme/Widget/commit/" + "a".repeat(40), "https://github.com/acme/widget/commit/" + "a".repeat(40) + "/",
      "https://github.com/acme/widget/pull/7/commits/" + "b".repeat(40), "https://nvd.nist.gov/vuln/detail/CVE-2024-0001",
    ],
    vulnerabilities: [{ package: { ecosystem: "pip", name: "widget" } }, { package: { ecosystem: "npm", name: "widget-js" } }],
    cwes: [{ cwe_id: "CWE-79", name: "Cross-site scripting" }],
    ...overrides,
  });
  const read = (page: unknown) => readAdvisories(github(new Map([[advisoryListingUrl("pip", "2024-01-01..2024-06-30"), page]])),
    { ecosystem: "pip", published: "2024-01-01..2024-06-30" });

  it("keeps an advisory's id, packages in the listed ecosystem, CWEs, and each distinct commit, never its prose", async () => {
    const [pointer] = await read([advisory()]);
    expect(pointer).toEqual({ advisory: ghsa, ecosystem: "pip", packages: ["widget"], cwes: ["CWE-79"],
      commits: [{ repository: "acme/widget", commit: "a".repeat(40) }], withdrawn: false });
    expect(JSON.stringify(pointer)).not.toMatch(/never kept|someone/u);
  });

  it("fails a page outside its window or order, or with a malformed advisory", async () => {
    expect(await codeOf(read([advisory({ published_at: "2023-12-31T23:59:59Z" })]))).toBe("VULNERABLE_ADVISORY_SHAPE");
    expect(await codeOf(read([advisory({ published_at: "2024-03-01T00:00:00Z" }), advisory()]))).toBe("VULNERABLE_ADVISORY_SHAPE");
    expect(await codeOf(read([advisory({ ghsa_id: "GHSA-0000-0000-0000" })]))).toBe("VULNERABLE_ADVISORY_SHAPE");
    expect(await codeOf(read([advisory({ type: "malware" })]))).toBe("VULNERABLE_ADVISORY_SHAPE");
    expect(await codeOf(read([advisory({ vulnerabilities: [{ package: { ecosystem: "npm", name: "widget-js" } }] })]))).toBe("VULNERABLE_ADVISORY_SHAPE");
    expect(await read([advisory({ withdrawn_at: "2024-05-01T00:00:00Z" })])).toMatchObject([{ withdrawn: true }]);
  });

  it("lets the request policy read only the first page of one ecosystem's window", () => {
    const allowed = (url: string) => { try { authorizeRequest({ provider: "github", method: "GET", url }); return true; } catch { return false; } };
    expect(allowed(advisoryListingUrl("rust", "2023-01-01..2023-06-30"))).toBe(true);
    expect(allowed(`${advisoryListingUrl("pip", "2023-01-01..2023-06-30")}&after=Y3Vyc29y`)).toBe(false);
    expect(allowed(advisoryListingUrl("pip", "2023-01-01..2023-06-30").replace("reviewed", "malware"))).toBe(false);
    expect(allowed(advisoryListingUrl("composer" as any, "2023-01-01..2023-06-30"))).toBe(false);
    expect(allowed("https://api.github.com/advisories/GHSA-2345-6789-cfgh")).toBe(false);
  });
});

describe("advisory fix commits (#59)", () => {
  const sha = "c".repeat(40);
  const api = "https://api.github.com/repos/Acme/Widget";
  const file = (filename: string, overrides: Record<string, unknown> = {}) => ({ filename, status: "modified", additions: 1, deletions: 1,
    patch: "@@ -10,3 +10,3 @@\n context\n-    return render(text)\n+    return render(escape(text))\n context", ...overrides });
  const commit = (files: readonly unknown[], overrides: Record<string, unknown> = {}) => ({
    sha, url: `${api}/commits/${sha}`, html_url: `https://github.com/Acme/Widget/commit/${sha}`, parents: [{ sha: "d".repeat(40) }], files, ...overrides,
  });
  // The reference spells the repository in lower case; GitHub answers with its own name.
  const read = (response: unknown) => readAdvisoryFix(github(new Map([[`https://api.github.com/repos/acme/widget/commits/${sha}`, response]])),
    { repository: "acme/widget", commit: sha });

  it("finds the one replaced line of code beside tests, notes, and manifests, under GitHub's own name for the repository", async () => {
    const fix = await read(commit([file("widget/views.py"), file("tests/test_views.py", { additions: 30 }), file("CHANGELOG.md", { additions: 3 }),
      file("pyproject.toml"), file("widget/__version__.py")]));
    expect(fix).toEqual({ repository: "Acme/Widget", language: "Python",
      fix: { path: "widget/views.py", buggyLine: "    return render(text)", fixedLine: "    return render(escape(text))" } });
  });

  it("refuses a merge, a second file of code, a wider change, an unknown language, a version bump, or whitespace", async () => {
    expect(await codeOf(read(commit([file("widget/views.py")], { parents: [{ sha: "d".repeat(40) }, { sha: "e".repeat(40) }] })))).toBe("VULNERABLE_PARENT");
    expect(await codeOf(read(commit([file("widget/views.py"), file("widget/forms.py")])))).toBe("VULNERABLE_CHANGE");
    expect(await codeOf(read(commit([file("widget/views.py"), file("widget/history.py")])))).toBe("VULNERABLE_CHANGE");
    expect(await codeOf(read(commit([file("widget/views.py", { additions: 2 })])))).toBe("VULNERABLE_CHANGE");
    expect(await codeOf(read(commit([file("widget/views.php")])))).toBe("VULNERABLE_LANGUAGE");
    expect(await codeOf(read(commit([file("widget/__init__.py", { patch: "@@ -1 +1 @@\n-__version__ = \"1.2.3\"\n+__version__ = \"1.2.4\"" })])))).toBe("VULNERABLE_VERSION");
    expect(await codeOf(read(commit([file("widget/views.py", { patch: "@@ -1 +1 @@\n-  return x\n+    return x" })])))).toBe("VULNERABLE_CHANGE");
    expect(await codeOf(read(commit([file("widget/views.py")], { url: `https://api.github.com/repos/other/widget/commits/${sha}` })))).toBe("FIX_COMMIT");
  });
});

describe("vulnerable-line profile (#59)", () => {
  const raw = () => JSON.parse(readFileSync(new URL("../profiles/local-real-rounds.v5.json", import.meta.url), "utf8"));
  const withSection = (section: unknown) => parseCrawlProfile({ ...raw(), curated: { repositories: [
    { repository: "algos/python", commit: "a".repeat(40), language: "Python" },
  ], "vulnerable-line": section } });
  const section = () => structuredClone(VULNERABLE_LINE_SECTION) as any;

  // Deferred past v1.0: the dry run's section, which reached 9 balanced rounds of 16 before its listings ran out.
  it("reads the section the dry run configured", () => {
    const real = JSON.parse(readFileSync(new URL("./testdata/vulnerable-line-section.json", import.meta.url), "utf8"));
    const parsed = parseCrawlProfile({ ...raw(), curated: { ...raw().curated, ...real } });
    expect(poolSizes(parsed)["vulnerable-line"]).toBe(16);
    expect(parsed.curated!["vulnerable-line"]!.ecosystems).toEqual(["rubygems", "npm", "go"]);
    expect(parsed.curated!["vulnerable-line"]!.published).toHaveLength(8);
  });

  it("refuses overlapping windows, an unknown ecosystem, too few commit reads, and a hint that is not one plain sentence", () => {
    expect(() => withSection(section())).not.toThrow();
    const overlapping = section();
    overlapping.published = ["2024-01-01..2024-06-30", "2024-06-30..2024-12-31"];
    expect(() => withSection(overlapping)).toThrow();
    const impossible = section();
    impossible.published = ["2024-02-30..2024-06-30"];
    expect(() => withSection(impossible)).toThrow();
    const composer = section();
    composer.ecosystems = ["pip", "composer"];
    expect(() => withSection(composer)).toThrow();
    const short = section();
    short.commitReads = 4;
    expect(() => withSection(short)).toThrow();
    const placeholder = section();
    placeholder.cwes[0].hint = "A path from {input} climbs out.";
    expect(() => withSection(placeholder)).toThrow();
    const unordered = section();
    unordered.cwes.reverse();
    expect(() => withSection(unordered)).toThrow();
  });
});

describe("vulnerable-line rounds (#59)", () => {
  const profile = loadCuratedProfile({}, { "vulnerable-line": true });
  const candidates = () => vulnerableLineCandidates(profile, snapshotIdFor(profile));

  it("offers four lines in line order, names the CWE first and a pair second, and keeps each advisory's identity for the reveal", () => {
    const { fixtures } = generateVulnerableLineRounds({ profile, candidates: candidates() });
    expect(fixtures).toHaveLength(8);
    for (const fixture of fixtures) {
      const lines = fixture.candidates.map(({ label }) => Number(label.slice("Line ".length)));
      expect(lines).toEqual([...lines].sort((left, right) => left - right));
      expect(fixture.clues[0]).toMatch(/^The advisory files it under CWE-(?:22|79): /u);
      expect(fixture.clues[1]).toMatch(/^It is line \d+ or line \d+\.$/u);
      expect(fixture.evidence).toContain(String(fixture.source.advisory));
    }
  });

  it("refuses a round whose code names an advisory or its package", () => {
    const named = candidates().map((candidate, index) => index > 0 ? candidate : { ...candidate, packageName: "target" });
    expect(() => generateVulnerableLineRounds({ profile, candidates: named })).toThrow("VULNERABLE_LINE_ADVISORY_SHOWN");
    expect(namesAdvisory("# see CVE-2024-12345", "widget")).toBe(true);
    expect(namesAdvisory(`// ${syntheticAdvisory(3)}`, "widget")).toBe(true);
    expect(namesAdvisory("import Widget from 'x'", "widget")).toBe(true);
    expect(namesAdvisory("const widgets = []", "widget")).toBe(false);
  });

  it("composes rounds the shared parser accepts, and the parser refuses a wrong hint or a package in the pane", () => {
    const input = composeInput(profile);
    const { artifact } = composeExperimentArtifact(input);
    const [deck] = parseArtifactDecks(artifact).filter(({ id }) => id === "vulnerable-line");
    expect(deck!.fixtures).toHaveLength(8);
    const tamper = (change: (fixture: any) => void) => {
      const copy = structuredClone(artifact) as any;
      change(copy.decks.find(({ id }: { id: string }) => id === "vulnerable-line").fixtures[0]);
      return () => parseArtifactDecks(copy);
    };
    expect(tamper(() => undefined)).not.toThrow();
    expect(tamper((fixture) => { fixture.clues[0] = vulnerableLineHint(fixture.source.cwe, "Something else entirely."); })).toThrow();
    expect(tamper((fixture) => { fixture.source.packageName = fixture.panes[0].text.match(/[a-z_]{4,}/u)[0]; })).toThrow();
    expect(tamper((fixture) => { fixture.source.ecosystem = "composer"; })).toThrow();
  });
});
