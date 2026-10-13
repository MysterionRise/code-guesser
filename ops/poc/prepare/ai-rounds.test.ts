import { generateAiRounds } from "./ai-rounds";
import { AI_CANDIDATE_IDS } from "./model";
import {
  CLAUDE_TRAILER,
  COPILOT_TRAILER,
  deckCandidates,
  githubCandidate,
  loadV2Profile,
  snapshotIdFor,
} from "./testdata/v2-builders";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;
const profile = loadV2Profile();
const snapshotId = snapshotIdFor(profile);
const aiCandidates = () => [...deckCandidates(profile, snapshotId).ai];

describe("FR-024 AI-credit round generation", () => {
  it("asks the signed question with honest answers and evidence for both outcomes", () => {
    const deck = generateAiRounds({ profile, candidates: aiCandidates() });

    expect(deck.fixtures).toHaveLength(5);
    for (const fixture of deck.fixtures) {
      expect(fixture.prompt).toBe("Is this AI-generated?");
      expect(fixture.candidates).toEqual([
        { id: AI_CANDIDATE_IDS[0], label: "Yes, the commit credits an AI assistant" },
        { id: AI_CANDIDATE_IDS[1], label: "No AI credit on this commit" },
      ]);
      expect(fixture.explanation).toBe("The answer comes from the commit's AI credit, not from analyzing the code.");
      expect(`${fixture.prompt} ${fixture.evidence} ${fixture.explanation}`).not.toMatch(/human[- ]written|a human wrote|detector|detection/iu);
    }
    const recorded = deck.fixtures.filter(({ source }) => source.aiCreditRecorded === true);
    const absent = deck.fixtures.filter(({ source }) => source.aiCreditRecorded === false);
    expect(recorded).toHaveLength(3);
    expect(absent).toHaveLength(2);
    expect(recorded.map(({ evidence }) => evidence).sort()).toEqual([
      "The commit message credits Claude.", "The commit message credits GitHub Copilot.", "The commit message credits GitHub Copilot.",
    ]);
    for (const fixture of absent) {
      expect(fixture.correctCandidateId).toBe(AI_CANDIDATE_IDS[1]);
      expect(fixture.evidence).toBe("The commit message credits no AI assistant. That does not show the code was written without AI.");
      expect(fixture.source.aiAssistant).toBeNull();
    }
  });

  it("states the changed-file count and quotes a safe subject, falling back to line totals", () => {
    const deck = generateAiRounds({ profile, candidates: aiCandidates() });
    const byMessage = new Map(deck.fixtures.map((fixture) => [fixture.source.commit, fixture]));
    const layout = [...byMessage.values()].find(({ clues }) => clues[1]!.includes("Fix layout spacing"))!;
    expect(layout.clues[1]).toBe("Commit subject: “Fix layout spacing”");
    expect(layout.clues[0]).toMatch(/^The commit changed \d+ files?\.$/u);

    const unsafe = aiCandidates();
    unsafe[0] = githubCandidate({ profile, snapshotId, index: 10, queryId: "ai-copilot-github", message: `Use Copilot suggestion\n\n${COPILOT_TRAILER}` });
    const fallback = generateAiRounds({ profile, candidates: unsafe }).fixtures.find(({ source }) => source.repository === "acme10/widget-10")!;
    expect(fallback.clues[1]).toBe("The change added 20 lines and removed 10 lines.");
  });

  it("rejects a credited commit from an ordinary query, an uncredited one from an ai-credit query, and lopsided decks", () => {
    const misfiled = aiCandidates();
    misfiled[3] = githubCandidate({ profile, snapshotId, index: 13, queryId: "ordinary-github", message: `Refactor\n\n${CLAUDE_TRAILER}` });
    const uncredited = aiCandidates();
    uncredited[0] = githubCandidate({ profile, snapshotId, index: 10, queryId: "ai-copilot-github", message: "No trailer here" });
    const lopsided = aiCandidates();
    lopsided[3] = githubCandidate({ profile, snapshotId, index: 13, queryId: "ai-claude-vercel", message: `x\n\n${CLAUDE_TRAILER}` });
    lopsided[4] = githubCandidate({ profile, snapshotId, index: 14, queryId: "ai-claude-vercel", message: `y\n\n${CLAUDE_TRAILER}` });
    for (const candidates of [misfiled, uncredited, lopsided, aiCandidates().slice(0, 4)]) {
      expect(() => generateAiRounds({ profile, candidates })).toThrow("AI_ROUNDS_REJECTED");
    }
  });

  it("is byte-stable and does not order rounds by outcome", () => {
    const first = generateAiRounds({ profile, candidates: aiCandidates() });
    const second = generateAiRounds({ profile, candidates: aiCandidates().reverse() });
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    expect(first.fixtures.map(({ roundId }) => roundId)).toEqual([...first.fixtures.map(({ roundId }) => roundId)].sort());
  });
});
