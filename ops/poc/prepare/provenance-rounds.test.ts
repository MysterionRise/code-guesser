import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { parsePrivateReveal, parsePublicRound } from "./model";
import { parseCrawlProfile } from "./profile";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;
const modulePath: string = "./provenance-rounds";
const roundsModule = await import(modulePath).catch(() => ({})) as Record<string, any>;
const generateProvenanceRounds = typeof roundsModule.generateProvenanceRounds === "function"
  ? roundsModule.generateProvenanceRounds
  : (): never => { throw new Error("PROVENANCE_ROUNDS_NOT_IMPLEMENTED"); };

const hash = (digit: string): string => digit.repeat(64);
const git = (digit: string): string => digit.repeat(40);
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const profile = async () => parseCrawlProfile(JSON.parse(
  await readFile(new URL("../profiles/local-real-rounds.v1.json", import.meta.url), "utf8"),
));

const admitted = (index: number, commitMessage: string): Record<string, unknown> => {
  const digit = String(index);
  const commit = git(digit);
  const repository = `example/project-${index}`;
  const path = `src/value-${index}.ts`;
  const repositoryUrl = `https://github.com/${repository}`;
  const commitUrl = `${repositoryUrl}/commit/${commit}`;
  const excerpt = `export function value${index}() {\n  const base = ${index};\n  return base + 1;\n}`;
  const source = Object.freeze({
    discoverySource: "GITHUB_COMMIT_SEARCH",
    repository,
    repositoryUrl,
    authorName: `Author ${index}`,
    authorLogin: `author-${index}`,
    authorBasis: "SELECTED_COMMIT",
    authorSourceUrl: commitUrl,
    path,
    blob: git(String(index + 4)),
    rawContentHash: hash(digit),
    excerptHash: sha256(excerpt),
    licenseName: "MIT License",
    licenseSpdx: "MIT",
    licenseFileUrl: `${repositoryUrl}/blob/${commit}/LICENSE`,
    commit,
    commitUrl,
    blobUrl: `${repositoryUrl}/blob/${commit}/${path}`,
    profileVersion: "local-real-rounds.v1",
    crawlSnapshotId: hash("f"),
    queryId: `query-${index}`,
    childCommit: commit,
    childTree: git(String(index + 1)),
    parentCommit: git(String(index + 2)),
    parentTree: git(String(index + 3)),
    parentPath: path,
    childPath: path,
    parentMode: "100644",
    childMode: "100644",
    parentBlob: git(String(index + 3)),
    childBlob: git(String(index + 4)),
    parentRawContentHash: hash(String(index + 3)),
    childRawContentHash: hash(digit),
    changedLineHash: hash(String(index + 2)),
  });
  return Object.freeze({
    admissionDecision: "AUTOMATED_POC_ADMISSION_ONLY",
    lineage: Object.freeze({
      queryId: source.queryId,
      queryIndex: index,
      committerDate: `2026-07-${String(31 - index).padStart(2, "0")}T10:00:00Z`,
      repository,
      repositoryUrl,
      commit,
      commitUrl,
      path,
      blob: source.blob,
      commitMessage,
      childCommit: commit,
      childTree: source.childTree,
      parentCommit: source.parentCommit,
      parentTree: source.parentTree,
      parentPath: path,
      childPath: path,
      parentMode: "100644",
      childMode: "100644",
      parentBlob: source.parentBlob,
      childBlob: source.childBlob,
      parentRawContentHash: source.parentRawContentHash,
      childRawContentHash: source.childRawContentHash,
      changedLineHash: source.changedLineHash,
      excerpt,
      excerptHash: source.excerptHash,
    }),
    source,
  });
};

const pool = () => [
  admitted(1, "Refine value without a recorded trailer"),
  admitted(2, "Mention Co-authored-by: GitHub Copilot inline only"),
  admitted(3, "Refine value\n Generated-by: Copilot"),
  admitted(4, "Refine value\r\nGenerated-by: Copilot"),
];

describe("honest provenance round generation", () => {
  it("preserves a newline-terminated lineage excerpt and its byte-exact hash", async () => {
    const candidates = structuredClone(pool()) as any[];
    const excerpt = `${candidates[0]!.lineage.excerpt}\n`;
    candidates[0]!.lineage.excerpt = excerpt;
    candidates[0]!.lineage.excerptHash = sha256(excerpt);
    candidates[0]!.source.excerptHash = sha256(excerpt);

    const output = generateProvenanceRounds({ profile: await profile(), candidates });

    expect(output.fixtures[0]!.excerpt).toBe(excerpt);
    expect(output.fixtures[0]!.source.excerptHash).toBe(sha256(excerpt));
  });

  it("stably selects exactly three rounds containing both literal marker outcomes", async () => {
    const output = generateProvenanceRounds({ profile: await profile(), candidates: pool() });

    expect(output.fixtures).toHaveLength(3);
    expect(output.fixtures.map(({ source }: any) => source.commit)).toEqual([git("1"), git("2"), git("4")]);
    expect(output.fixtures.map(({ source }: any) => source.markerMatched)).toEqual([false, false, true]);
    expect(output.fixtures.map(({ excerpt }: any) => excerpt)).toEqual([
      (pool()[0] as { lineage: { excerpt: string } }).lineage.excerpt,
      (pool()[1] as { lineage: { excerpt: string } }).lineage.excerpt,
      (pool()[3] as { lineage: { excerpt: string } }).lineage.excerpt,
    ]);
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.fixtures)).toBe(true);
  });

  it("uses only profile copy and binds source, public, and private versions", async () => {
    const parsedProfile = await profile();
    const output = generateProvenanceRounds({ profile: parsedProfile, candidates: pool() });
    const candidateIds = [
      "local-experiment.marker-recorded.v1",
      "local-experiment.marker-not-recorded.v1",
    ];

    for (const [index, fixture] of output.fixtures.entries()) {
      const publicRound = parsePublicRound(output.publicRounds[index]);
      const privateReveal = parsePrivateReveal(output.privateReveals[fixture.roundId]);
      expect(fixture.prompt).toBe(parsedProfile.templates.provenance.prompt);
      expect(fixture.candidates.map(({ id }: any) => id)).toEqual(candidateIds);
      expect(fixture.clues).toEqual(parsedProfile.templates.provenance.clues);
      expect([
        parsedProfile.templates.provenance.recordedEvidence,
        parsedProfile.templates.provenance.unrecordedEvidence,
      ]).toContain(fixture.evidence);
      expect(fixture.explanation).toBe(parsedProfile.templates.provenance.explanation);
      expect(fixture.attribution).toBe([
        fixture.source.authorName,
        fixture.source.repository,
        `${fixture.source.licenseName} (${fixture.source.licenseSpdx})`,
        fixture.source.blobUrl,
      ].join(" · "));
      expect(publicRound.roundId).toBe(fixture.roundId);
      expect(publicRound.roundVersionId).toBe(fixture.roundVersion);
      expect(publicRound.excerpt.versionId).toBe(fixture.source.excerptHash);
      expect(privateReveal.roundVersionId).toBe(publicRound.roundVersionId);
      expect(privateReveal.versions.content).toBe(publicRound.excerpt.versionId);
      expect(privateReveal.versions.candidateSet).toBe(publicRound.versions.candidateSet);
      expect(privateReveal.versions.scoring).toBe(publicRound.versions.scoring);
      expect(privateReveal.versions.rules).toBe(publicRound.versions.rules);
      expect(Object.keys(fixture.source).sort()).toEqual([
        ...Object.keys((pool()[fixture.source.commit === git("4") ? 3 : index] as {
          source: Record<string, unknown>;
        }).source),
        "markerMatched",
      ].sort());
      expect(Object.isFrozen(publicRound)).toBe(true);
      expect(Object.isFrozen(privateReveal)).toBe(true);
    }
    expect(Object.keys(output.privateReveals).sort()).toEqual(
      output.publicRounds.map(({ roundId }: any) => roundId).sort(),
    );
    const publicJson = JSON.stringify(output.publicRounds);
    for (const fixture of output.fixtures) {
      expect(publicJson).not.toContain(fixture.source.repository);
      expect(publicJson).not.toContain(fixture.source.authorName);
      expect(publicJson).not.toContain(fixture.source.licenseName);
      expect(publicJson).not.toContain(fixture.source.commit);
      expect(publicJson).not.toContain((fixture.source.commit as string).slice(0, 12));
      expect(publicJson).not.toContain(fixture.source.blobUrl);
    }
    expect(JSON.stringify(output)).not.toMatch(
      /code style (?:shows|proves|indicates)|authored by|written by|generated by (?:ai|a model)|human-only|detection|approved|authenticated/iu,
    );
  });

  it("matches configured markers only as exact full CRLF-aware lines", async () => {
    const candidates = [
      admitted(1, "Subject\r\nCo-authored-by: GitHub Copilot\r\nBody"),
      admitted(2, "Subject Co-authored-by: GitHub Copilot"),
      admitted(3, "Subject\n Co-authored-by: GitHub Copilot"),
    ];
    const output = generateProvenanceRounds({ profile: await profile(), candidates });
    expect(output.fixtures.map(({ source }: any) => source.markerMatched)).toEqual([true, false, false]);
  });

  it("matches a configured trailer marker followed only by its angle-bracket address", async () => {
    const markers = ["Co-authored-by: Copilot", "Generated-by: Copilot"];
    const { markerRecorded } = roundsModule;
    expect(markerRecorded("Subject\n\nCo-authored-by: Copilot <198982749+Copilot@users.noreply.github.com>", markers)).toBe(true);
    expect(markerRecorded("Subject\r\nCo-authored-by: Copilot <copilot@github.com>\r\n", markers)).toBe(true);
    expect(markerRecorded("Generated-by: Copilot", markers)).toBe(true);
    for (const message of [
      "Co-authored-by: Copilot App <x@example.test>",
      "Co-authored-by: Copilot <>",
      "Co-authored-by: Copilot <with space>",
      "Co-authored-by: Copilot  <x@example.test>",
      "Co-authored-by: Copilot <x@example.test> trailing",
      "Co-authored-by: Copilot extra",
      "co-authored-by: copilot <x@example.test>",
      "Generated-by: Copilot <x@example.test>?",
    ]) expect(markerRecorded(message, markers)).toBe(false);
    expect(() => markerRecorded("x", ["multi\nline"])).toThrow();
  });

  it("is byte-stable for the same admitted ordered pool", async () => {
    const parsedProfile = await profile();
    const first = generateProvenanceRounds({ profile: parsedProfile, candidates: pool() });
    const second = generateProvenanceRounds({ profile: parsedProfile, candidates: pool() });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it.each([
    ["insufficient", () => pool().slice(0, 2)],
    ["non-match only", () => [
      admitted(1, "Ordinary one"), admitted(2, "Ordinary two"), admitted(3, "Ordinary three"),
    ]],
    ["match only", () => [
      admitted(1, "Generated-by: Copilot"),
      admitted(2, "Co-authored-by: GitHub Copilot"),
      admitted(3, "Generated-by: Copilot"),
    ]],
    ["duplicate identity", () => [pool()[0], pool()[0], pool()[3]]],
  ])("rejects a %s selection pool", async (
    _name: string,
    candidates: () => readonly Record<string, unknown>[],
  ) => {
    const parsedProfile = await profile();
    expect(() => generateProvenanceRounds({ profile: parsedProfile, candidates: candidates() }))
      .toThrow(roundsModule.ProvenanceRoundsError);
  });

  it.each([
    ["admission decision", (candidate: any) => { candidate.admissionDecision = "WRONG_DECISION"; }],
    ["source commit", (candidate: any) => { candidate.source.commit = git("a"); }],
    ["source path", (candidate: any) => { candidate.source.path = "src/other.ts"; }],
    ["source blob", (candidate: any) => { candidate.source.blob = git("a"); }],
    ["source lineage", (candidate: any) => { candidate.source.childTree = git("a"); }],
    ["blank excerpt", (candidate: any) => { candidate.lineage.excerpt = ""; }],
    ["altered excerpt", (candidate: any) => { candidate.lineage.excerpt += "\nexport const injected = true;"; }],
    ["changed-line identity", (candidate: any) => { candidate.source.changedLineHash = ""; }],
  ])("rejects an inconsistent %s", async (
    _name: string,
    mutate: (candidate: any) => void,
  ) => {
    const candidates = pool().map((candidate) => structuredClone(candidate)) as any[];
    mutate(candidates[0]);
    const parsedProfile = await profile();
    expect(() => generateProvenanceRounds({ profile: parsedProfile, candidates }))
      .toThrow(roundsModule.ProvenanceRoundsError);
  });
});
