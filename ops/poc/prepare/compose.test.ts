import { canonicalArtifactBytes, canonicalArtifactHash } from "./canonical";
import { ComposeError, composeExperimentArtifact } from "./compose";
import { artifactFixtures } from "./model";
import { generateProjectRounds } from "./project-rounds";
import { DISTRACTOR_POOL, composeInput, githubCandidate, sha256, snapshotIdFor } from "./testdata/v2-builders";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;
const codeOf = (callback: () => unknown): string | undefined => {
  try { callback(); } catch (error) { if (error instanceof ComposeError) return error.code ?? "UNCODED"; throw error; }
  return undefined;
};

describe("three-deck experiment composition", () => {
  it("composes one artifact with project, language, and AI decks of five and a fifteen-round record set", () => {
    const input = composeInput();
    const composed = composeExperimentArtifact(input);

    expect(composed.artifact.schemaVersion).toBe("local-experiment-artifact.v2");
    expect(composed.artifact.decks.map(({ id, fixtures }) => `${id}:${fixtures.length}`)).toEqual(["project:5", "language:5", "ai:5"]);
    expect(composed.artifact.decks.map(({ title }) => title)).toEqual(["Which project?", "Which language?", "Is this AI-generated?"]);
    expect(composed.artifact.decks[2]!.notice).toBe("AI answers come from AI co-author credits in commit messages, not from analyzing the code.");
    expect(composed.artifact.decks[0]!.notice).toBeNull();
    expect(composed.roundRecordSet.publicRounds.map(({ mode }) => mode.kind)).toEqual([
      ...Array(5).fill("project"), ...Array(5).fill("language"), ...Array(5).fill("ai"),
    ]);
    expect(Object.keys(composed.roundRecordSet.privateReveals)).toHaveLength(15);
    expect(composed.artifactHash).toBe(canonicalArtifactHash(composed.artifact));
    expect(Buffer.from(composed.artifactBytes)).toEqual(Buffer.from(canonicalArtifactBytes(composed.artifact)));
    expect(artifactFixtures(composed.artifact).every(({ source }) => source.crawlSnapshotId === composed.artifact.crawlSnapshot.id)).toBe(true);
  });

  it("replays byte-identically and binds the profile bytes and response hashes", () => {
    const first = composeExperimentArtifact(composeInput());
    const second = composeExperimentArtifact(composeInput());
    expect(second.artifactHash).toBe(first.artifactHash);
    const input = composeInput();
    expect(() => composeExperimentArtifact({ ...input, canonicalProfileBytes: new Uint8Array([1]) })).toThrow(ComposeError);
    expect(() => composeExperimentArtifact({ ...input, acceptedResponseHashes: [] })).toThrow(ComposeError);
    expect(() => composeExperimentArtifact({ ...input, acceptedResponseHashes: [sha256("other")] })).toThrow(ComposeError);
  });

  it("rejects a deck in the wrong slot, a short deck, and projection drift", () => {
    const input = composeInput();
    expect(() => composeExperimentArtifact({ ...input, project: input.ai })).toThrow(ComposeError);
    expect(() => composeExperimentArtifact({ ...input, language: { ...input.language, fixtures: input.language.fixtures.slice(0, 4) } })).toThrow(ComposeError);
    const drifted = structuredClone(input);
    (drifted.language.publicRounds[0] as any).excerpt.text = "different public source";
    expect(() => composeExperimentArtifact(drifted)).toThrow(ComposeError);
  });

  it("allows a repository commit in two decks but never the same commit, blob, or excerpt twice", () => {
    const input = composeInput();
    const snapshotId = snapshotIdFor(input.profile);
    const shared = input.candidates.project.map((candidate, index) => index === 0
      ? githubCandidate({ profile: input.profile, snapshotId, index: 13, queryId: "ordinary-facebook", repository: "acme13/widget-13" })
      : candidate);
    const reused = generateProjectRounds({ profile: input.profile, candidates: shared, distractorPool: DISTRACTOR_POOL });
    expect(() => composeExperimentArtifact({ ...input, project: reused })).toThrow(ComposeError);
  });

  it("names the protected key and public field when containment fails, without the value", () => {
    const input = composeInput();
    const leaked = structuredClone(input);
    const fixture = leaked.ai.fixtures[0]! as any;
    fixture.prompt = `${fixture.prompt} ${fixture.source.authorName}`;
    (leaked.ai.publicRounds[0] as any).mode.prompt = fixture.prompt;
    const code = codeOf(() => composeExperimentArtifact(leaked));
    expect(code).toBe("PUBLIC_CONTAINMENT_AUTHORNAME_IN_MODE");
  });

  it("lets repository names appear only as project candidate labels", () => {
    const input = composeInput();
    expect(() => composeExperimentArtifact(input)).not.toThrow();
    const leaked = structuredClone(input);
    const project = leaked.project.fixtures[0]! as any;
    const repository = String(project.source.repository);
    const language = leaked.language.fixtures[0]! as any;
    language.clues = [language.clues[0], `Compare it with ${repository}.`];
    (leaked.language.publicRounds[0] as any).mode.clues[1].label = language.clues[1];
    expect(codeOf(() => composeExperimentArtifact(leaked))).toBe("PUBLIC_CONTAINMENT_REPOSITORY_IN_MODE");
  });
});
