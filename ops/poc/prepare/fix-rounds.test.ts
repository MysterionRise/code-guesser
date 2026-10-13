import { composeExperimentArtifact } from "./compose";
import { generateFixRounds } from "./fix-rounds";
import { ExperimentRecordError, FIX_CHANGE_HINTS, fixCandidateId, fixRanks, parseExperimentArtifact } from "./model";
import { balancedChoice } from "./round-helpers";
import { composeInput, fixCandidates, loadCuratedProfile, sha256, snapshotIdFor } from "./testdata/deck-builders";
import { parseArtifactDecks } from "../../../packages/artifact/src/index";
import { TOLERANCE, accuracy, chance } from "../../../packages/artifact/test/solvers";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const profile = loadCuratedProfile({}, { fix: true });
const snapshotId = snapshotIdFor(profile);
const pool = () => fixCandidates(profile, snapshotId);
const fixDeck = () => parseArtifactDecks(composeExperimentArtifact(composeInput(profile)).artifact).find(({ id }) => id === "fix")!;

describe("fix rounds", () => {
  it("offers four lines in order, hints at the kind of change and then two lines, and credits the fix's author", () => {
    const { fixtures } = generateFixRounds({ profile, candidates: pool() });
    expect(fixtures).toHaveLength(8);
    for (const fixture of fixtures) {
      const lines = fixture.candidates.map(({ label }) => Number(label.slice(5)));
      expect(lines).toEqual([...lines].sort((left, right) => left - right));
      const answer = Number(fixture.source.changedLine) - Number(fixture.source.windowStart) + 1;
      expect(fixture.correctCandidateId).toBe(fixCandidateId(answer));
      expect(Object.values(FIX_CHANGE_HINTS)).toContain(fixture.clues[0]);
      expect(fixture.clues[1]).toMatch(new RegExp(`\\bline ${answer}\\b`, "u"));
      expect(fixture.source.authorSourceUrl).toBe(`https://github.com/${String(fixture.source.repository)}/commit/${String(fixture.source.fixCommit)}`);
    }
    const java = fixtures.find(({ source }) => source.dataset === "defects4j")!;
    expect(java.clues[0]).toBe(FIX_CHANGE_HINTS.LITERAL);
    expect(java.evidence).toMatch(/^Defects4J records bug (?:Calc|Text)-\d in (?:calc\/calc|text\/text); the fix changed line \d+ of this excerpt\.$/u);
    expect(java.helpfulSignals[0]).toMatch(/^Line \d+ read “total = total \+ step \* \d+;”; the fix made it “total = total \+ step \* \d+;”\.$/u);
  });

  it("balances answers by position and centrality, and nearly by length, or finds that it cannot", () => {
    const candidates = pool();
    const ranks = candidates.map((candidate) => fixRanks(candidate.answer, [candidate.answer, ...candidate.decoys], candidate.excerpt.split("\n")));
    for (const order of [0, 1]) expect([0, 1, 2, 3].map((rank) => ranks.filter((vector) => vector[order] === rank).length)).toEqual([2, 2, 2, 2]);
    // The search keeps one choice per distinct vector, places constrained rounds first, and honours each order's slack.
    expect(balancedChoice([[[0, 0]], [[1, 1], [0, 0]], [[2, 2]], [[3, 3], [1, 1]]], 4)).toEqual([0, 0, 0, 0]);
    expect(balancedChoice([[[0, 0]], [[0, 1]], [[2, 2]], [[3, 3]]], 4)).toBeUndefined();
    expect(balancedChoice([[[0, 0]], [[1, 0]], [[2, 2]], [[3, 3]]], 4, [0, 1])).toEqual([0, 0, 0, 0]);
    expect(balancedChoice([[undefined, [0]], [[1]], [[2]]], 4)).toBeUndefined();
    // A pool whose answers all sit at one position is refused, and so is a fourth round from one repository.
    const moved = candidates.map((candidate) => {
      const [first, ...rest] = [...candidate.decoys, candidate.answer].sort((left, right) => left - right);
      return candidate.answer === first ? candidate : { ...candidate, decoys: [candidate.answer, ...rest.filter((line) => line !== candidate.answer)].sort((l, r) => l - r) };
    });
    expect(() => generateFixRounds({ profile, candidates: moved })).toThrow();
    const crowded = candidates.map((candidate, index) => index < 4 ? { ...candidate, repository: "calc/calc" } : candidate);
    expect(() => generateFixRounds({ profile, candidates: crowded })).toThrow();
  });

  it("gives code-blind solvers no edge: position, nearness to the middle, and line length", () => {
    const { fixtures } = fixDeck();
    const limit = chance(fixtures[0]!) + TOLERANCE;
    const lineOf = (label: string) => Number(label.slice("Line ".length));
    const paneOf = (fixture: typeof fixtures[number]) => fixture.panes[0]!.text.split("\n");
    const solvers = [
      ...[0, 1, 2, 3].map((index) => (fixture: typeof fixtures[number], label: string) => fixture.candidates.findIndex((option) => option.label === label) === index ? 1 : 0),
      (fixture: typeof fixtures[number], label: string) => -Math.abs(2 * lineOf(label) - paneOf(fixture).length - 1),
      (fixture: typeof fixtures[number], label: string) => Math.abs(2 * lineOf(label) - paneOf(fixture).length - 1),
      (fixture: typeof fixtures[number], label: string) => paneOf(fixture)[lineOf(label) - 1]!.trim().length,
      (fixture: typeof fixtures[number], label: string) => -paneOf(fixture)[lineOf(label) - 1]!.trim().length,
    ];
    for (const solver of solvers) expect(accuracy(fixtures, solver)).toBeLessThanOrEqual(limit);
  });

  it("parses only options on code lines, the line the fix changed, honest hints, a pinned dataset, and no address for an author", () => {
    const base = (): any => structuredClone(composeExperimentArtifact(composeInput(profile)).artifact);
    const round = (value: any) => value.decks.find(({ id }: any) => id === "fix").fixtures[0];
    const mutations: ((value: any) => void)[] = [
      (value) => { const fixture = round(value); fixture.correctCandidateId = fixture.candidates.find(({ id }: any) => id !== fixture.correctCandidateId).id; },
      (value) => { round(value).source.windowStart += 1; },
      (value) => { round(value).clues[0] = "The fix is near the top."; },
      (value) => { const fixture = round(value); const others = fixture.candidates.filter(({ id }: any) => id !== fixture.correctCandidateId)
        .map(({ label }: any) => Number(label.slice(5))); fixture.clues[1] = `It is line ${others[0]} or line ${others[1]}.`; },
      (value) => { const fixture = round(value); const text = fixture.panes[0].text.split("\n");
        const option = fixture.candidates.find(({ id }: any) => id !== fixture.correctCandidateId); text[Number(option.label.slice(5)) - 1] = "";
        fixture.panes[0].text = text.join("\n"); fixture.source.excerptHash = sha256(fixture.panes[0].text); },
      (value) => { round(value).source.dataset = "unknown"; },
      (value) => { round(value).source.authorName = "fix@example.org"; },
      (value) => { round(value).source.fixCommit = round(value).source.commit; },
    ];
    for (const mutate of mutations) {
      const changed = base();
      mutate(changed);
      expect(() => parseExperimentArtifact(changed)).toThrow(ExperimentRecordError);
    }
  });
});
