import { canonicalArtifactBytes, canonicalArtifactHash } from "./canonical";
import { ComposeError, composeExperimentArtifact } from "./compose";
import { artifactFixtures } from "./model";
import { generateLanguageRounds } from "./language-rounds";
import { composeInput, sha256, snapshotIdFor, stackCandidate } from "./testdata/deck-builders";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;
const codeOf = (callback: () => unknown): string | undefined => {
  try { callback(); } catch (error) { if (error instanceof ComposeError) return error.code ?? "UNCODED"; throw error; }
  return undefined;
};

describe("pooled experiment composition", () => {
  it("composes the project, language, and before-or-after pools into one artifact", () => {
    const composed = composeExperimentArtifact(composeInput());
    expect(composed.artifact.schemaVersion).toBe("local-experiment-artifact.v3");
    expect(composed.artifact.decks.map(({ id, fixtures, roundsPerSession }) => `${id}:${fixtures.length}:${roundsPerSession}`))
      .toEqual(["project:24:5", "language:24:5", "before-after:10:5"]);
    expect(composed.artifact.decks.map(({ title }) => title)).toEqual(["Which project?", "Which language?", "Before or after?"]);
    expect(composed.artifactHash).toBe(canonicalArtifactHash(composed.artifact));
    expect(Buffer.from(composed.artifactBytes)).toEqual(Buffer.from(canonicalArtifactBytes(composed.artifact)));
    expect(artifactFixtures(composed.artifact).every(({ source }) => source.crawlSnapshotId === composed.artifact.crawlSnapshot.id)).toBe(true);
  });

  it("composes any subset of decks, in deck order", () => {
    const input = composeInput();
    const composed = composeExperimentArtifact({ ...input, decks: { "before-after": input.decks["before-after"]!, project: input.decks.project! } });
    expect(composed.artifact.decks.map(({ id }) => id)).toEqual(["project", "before-after"]);
    expect(codeOf(() => composeExperimentArtifact({ ...input, decks: {} }))).toBe("NO_DECK");
  });

  it("replays byte-identically and binds the profile bytes and response hashes", () => {
    expect(composeExperimentArtifact(composeInput()).artifactHash).toBe(composeExperimentArtifact(composeInput()).artifactHash);
    const input = composeInput();
    expect(() => composeExperimentArtifact({ ...input, canonicalProfileBytes: new Uint8Array([1]) })).toThrow(ComposeError);
    expect(() => composeExperimentArtifact({ ...input, acceptedResponseHashes: [] })).toThrow(ComposeError);
    expect(() => composeExperimentArtifact({ ...input, acceptedResponseHashes: [sha256("other")] })).toThrow(ComposeError);
  });

  it("rejects a pool in the wrong slot or of the wrong size", () => {
    const input = composeInput();
    expect(() => composeExperimentArtifact({ ...input, decks: { ...input.decks, project: input.decks.language! } })).toThrow(ComposeError);
    expect(codeOf(() => composeExperimentArtifact({ ...input, decks: { ...input.decks,
      language: { fixtures: input.decks.language!.fixtures.slice(0, 9) } } }))).toBe("DECK_SIZE_LANGUAGE");
  });

  it("allows a repository in two decks but never the same file twice", () => {
    const input = composeInput();
    const snapshotId = snapshotIdFor(input.profile);
    const projectFile = input.candidates.project[0]!.candidate;
    const language = input.candidates.language.map((candidate, index) => index === 0
      ? stackCandidate(input.profile, snapshotId, "Python", 10, { repository: String(projectFile.repository) })
      : candidate);
    const reused = generateLanguageRounds({ profile: input.profile, candidates: language });
    expect(() => composeExperimentArtifact({ ...input, decks: { ...input.decks, language: reused } })).toThrow(ComposeError);
  });

  it("names the protected key and public part when containment fails, without the value", () => {
    const input = composeInput();
    const leaked = structuredClone(input);
    const fixture = leaked.decks["before-after"]!.fixtures[0]! as any;
    fixture.prompt = `${fixture.prompt} ${fixture.source.authorName}`;
    expect(codeOf(() => composeExperimentArtifact(leaked))).toBe("PUBLIC_CONTAINMENT_AUTHORNAME_IN_PROMPT");
  });

  it("lets repository names appear only as project option labels", () => {
    const input = composeInput();
    const leaked = structuredClone(input);
    const repository = String(input.decks.project!.fixtures[0]!.source.repository);
    const fixture = leaked.decks.language!.fixtures[0]! as any;
    fixture.clues = [fixture.clues[0], `Compare it with ${repository}.`];
    expect(codeOf(() => composeExperimentArtifact(leaked))).toBe("PUBLIC_CONTAINMENT_REPOSITORY_IN_CLUES");
  });
});
