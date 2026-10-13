import { generateProjectRounds, mentionsRepository, projectCandidateId } from "./project-rounds";
import { DISTRACTOR_POOL, githubCandidate, loadV2Profile, snapshotIdFor } from "./testdata/v2-builders";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;
const profile = loadV2Profile();
const snapshotId = snapshotIdFor(profile);
const candidates = (overrides: Record<number, Partial<Parameters<typeof githubCandidate>[0]>> = {}) =>
  [0, 1, 2, 3, 4].map((index) => githubCandidate({ profile, snapshotId, index, queryId: "ordinary-facebook", ...overrides[index] }));

describe("FR-032 project round generation", () => {
  it("produces five rounds with four distinct repository candidates and the pinned answer", () => {
    const deck = generateProjectRounds({ profile, candidates: candidates(), distractorPool: DISTRACTOR_POOL });

    expect(deck.fixtures).toHaveLength(5);
    for (const fixture of deck.fixtures) {
      expect(fixture.kind).toBe("PROJECT");
      expect(fixture.prompt).toBe("Which project is this code from?");
      expect(fixture.candidates).toHaveLength(4);
      expect(new Set(fixture.candidates.map(({ label }) => label)).size).toBe(4);
      expect(fixture.correctCandidateId).toBe(projectCandidateId(String(fixture.source.repository)));
      expect(fixture.candidates.map(({ label }) => label)).toContain(fixture.source.repository);
      expect(fixture.clues[0]).toBe("The changed file's extension is .ts.");
      expect(fixture.clues[1]).toBe(`The project belongs to ${String(fixture.source.repository).split("/")[0]}.`);
      expect(fixture.evidence).toBe(`This change was committed to ${String(fixture.source.repository)}.`);
      for (const { label } of fixture.candidates) {
        expect(mentionsRepository(fixture.excerpt, label)).toBe(false);
        if (label !== fixture.source.repository) expect(DISTRACTOR_POOL).toContain(label);
      }
    }
    expect(deck.publicRounds.map(({ mode }) => mode.kind)).toEqual(Array(5).fill("project"));
  });

  it("is byte-stable for the same inputs and orders rounds and candidates by identity, not source order", () => {
    const first = generateProjectRounds({ profile, candidates: candidates(), distractorPool: DISTRACTOR_POOL });
    const second = generateProjectRounds({ profile, candidates: [...candidates()].reverse(), distractorPool: [...DISTRACTOR_POOL].reverse() });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.fixtures.map(({ roundId }) => roundId)).toEqual([...first.fixtures.map(({ roundId }) => roundId)].sort());
  });

  it("never offers a distractor the excerpt names, and rejects excerpts naming the answer", () => {
    const naming = candidates({ 0: { excerpt: "import { engine } from 'orbit';\nexport const speed = engine.run(10) + 1000;" } });
    const deck = generateProjectRounds({ profile, candidates: naming, distractorPool: DISTRACTOR_POOL });
    const fixture = deck.fixtures.find(({ excerpt }) => excerpt.includes("orbit"))!;
    expect(fixture.candidates.some(({ label }) => label.startsWith("orbit/"))).toBe(false);

    const answerNamed = candidates({ 2: { excerpt: "// widget-2 entry point\nexport const value = compute(2) + 1000;" } });
    expect(() => generateProjectRounds({ profile, candidates: answerNamed, distractorPool: DISTRACTOR_POOL })).toThrow("PROJECT_ROUNDS_REJECTED");
  });

  it("rejects duplicate repositories, the wrong count, ai-credit sources, and a too-small distractor pool", () => {
    const duplicate = candidates({ 1: { repository: "acme0/widget-0" } });
    for (const options of [
      { candidates: duplicate, distractorPool: DISTRACTOR_POOL },
      { candidates: candidates().slice(0, 4), distractorPool: DISTRACTOR_POOL },
      { candidates: candidates({ 3: { queryId: "ai-copilot-github" } }), distractorPool: DISTRACTOR_POOL },
      { candidates: candidates(), distractorPool: DISTRACTOR_POOL.slice(0, 2) },
    ]) {
      expect(() => generateProjectRounds({ profile, ...options })).toThrow("PROJECT_ROUNDS_REJECTED");
    }
  });
});
