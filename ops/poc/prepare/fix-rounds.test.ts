import { composeExperimentArtifact } from "./compose";
import { generateFixRounds } from "./fix-rounds";
import {
  ExperimentRecordError, FIX_CHANGE_HINTS, fixCandidateId, fixExtremeLimits, fixExtremeScores, fixRanks, pairLongerScore, parseExperimentArtifact,
} from "./model";
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
const v6 = loadCuratedProfile({}, { fix: true }, "local-real-rounds.v6");

describe("fix rounds", () => {
  it("from profile v6 on, offers one round per file, and v5 does not ask (#84)", () => {
    // The second Calc round moved into the first one's file, as luigi's scheduler held two rounds.
    const sameFile = (candidates: ReturnType<typeof pool>) => candidates.map((candidate, index) => index === 1 ? { ...candidate, path: candidates[0]!.path } : candidate);
    expect(pool()[0]!.repository).toBe(pool()[1]!.repository);
    expect(() => generateFixRounds({ profile: v6, candidates: sameFile(fixCandidates(v6, snapshotIdFor(v6))) })).toThrow("FIX_FILE_REPEATED");
    expect(generateFixRounds({ profile, candidates: sameFile(pool()) }).fixtures).toHaveLength(8);
    // The parser holds a v6 deck to it too.
    const composed = new Map([profile, v6].map((from) => [from, composeExperimentArtifact(composeInput(from)).artifact] as const));
    const moved = (from: typeof profile): any => {
      const value: any = structuredClone(composed.get(from));
      const fixtures = value.decks.find(({ id }: any) => id === "fix").fixtures;
      const [first, second] = fixtures.filter(({ source }: any) => source.repository === fixtures[0].source.repository);
      const fixture = fixtures.indexOf(second);
      fixtures[fixture] = JSON.parse(JSON.stringify(second).replaceAll(second.source.path, first.source.path));
      return value;
    };
    expect(() => parseExperimentArtifact(composed.get(v6))).not.toThrow();
    expect(() => parseExperimentArtifact(moved(v6))).toThrow(ExperimentRecordError);
    expect(() => parseExperimentArtifact(moved(profile))).not.toThrow();
  });

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
    // A budget caps what the chosen rounds score in total: the cheaper of two equal-ranked choices, or none at all.
    const budgetRounds = [[[0], [0]], [[1]], [[2]], [[3]]];
    const costs = [[[1], [0.5]], [[0.5]], [[0]], [[0]]];
    expect(balancedChoice(budgetRounds, 4, [], { costs, limits: [1] })).toEqual([1, 0, 0, 0]);
    expect(balancedChoice(budgetRounds, 4, [], { costs, limits: [0.9] })).toBeUndefined();
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

  it("caps every line-feature extreme and pairs the second hint so the longer line is the answer in half the pool", () => {
    const { fixtures } = generateFixRounds({ profile, candidates: pool() });
    const lineOf = (label: string) => Number(label.slice("Line ".length));
    const totals = fixExtremeLimits(fixtures.length).map(() => 0);
    let longer = 0;
    for (const fixture of fixtures) {
      const lines = fixture.candidates.map(({ label }) => lineOf(label));
      const answer = lines[fixture.candidates.findIndex(({ id }) => id === fixture.correctCandidateId)]!;
      const pane = fixture.panes[0]!.text.split("\n");
      fixExtremeScores(answer, lines, pane).forEach((score, index) => { totals[index]! += score; });
      const partner = /line (\d+) or line (\d+)/u.exec(fixture.clues[1]!)!.slice(1).map(Number).find((line) => line !== answer)!;
      longer += pairLongerScore(answer, partner, pane);
    }
    totals.forEach((total, index) => expect(total).toBeLessThanOrEqual(fixExtremeLimits(fixtures.length)[index]!));
    expect(longer).toBe(fixtures.length / 2);
    // Pairing every answer with a shorter line instead is refused.
    const shorterPairs = (value: any) => {
      for (const fixture of value.decks.find(({ id }: any) => id === "fix").fixtures) {
        const pane = fixture.panes[0].text.split("\n");
        const answer = lineOf(fixture.candidates.find(({ id }: any) => id === fixture.correctCandidateId).label);
        const shorter = fixture.candidates.map(({ label }: any) => lineOf(label)).find((line: number) => line !== answer && pairLongerScore(answer, line, pane) === 1);
        if (shorter !== undefined) fixture.clues[1] = `It is line ${Math.min(answer, shorter)} or line ${Math.max(answer, shorter)}.`;
      }
    };
    const changed: any = structuredClone(composeExperimentArtifact(composeInput(profile)).artifact);
    shorterPairs(changed);
    expect(() => parseExperimentArtifact(changed)).toThrow(ExperimentRecordError);
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
