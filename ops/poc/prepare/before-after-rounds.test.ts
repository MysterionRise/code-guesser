import { beforeAfterSubject, BeforeAfterRoundsError, generateBeforeAfterRounds } from "./before-after-rounds";
import { BEFORE_AFTER_CANDIDATE_IDS } from "./model";
import { sha256 } from "./round-helpers";
import { commitCandidate, deckCandidates, loadDeckProfile, snapshotIdFor } from "./testdata/deck-builders";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const profile = loadDeckProfile();
const snapshotId = snapshotIdFor(profile);
const pool = () => deckCandidates(profile, snapshotId).beforeAfter;

describe("before-or-after rounds", () => {
  it("shows each commit's before and after code as panes A and B, the later one named by the answer", () => {
    const { fixtures } = generateBeforeAfterRounds({ profile, candidates: pool() });
    expect(fixtures).toHaveLength(10);
    for (const fixture of fixtures) {
      expect(fixture.panes.map(({ label }) => label)).toEqual(["A", "B"]);
      expect(fixture.candidates.map(({ id }) => id)).toEqual([...BEFORE_AFTER_CANDIDATE_IDS]);
      const later = fixture.correctCandidateId === BEFORE_AFTER_CANDIDATE_IDS[0] ? fixture.panes[0]! : fixture.panes[1]!;
      const earlier = later === fixture.panes[0] ? fixture.panes[1]! : fixture.panes[0]!;
      expect(sha256(later.text)).toBe(fixture.source.excerptHash);
      expect(sha256(earlier.text)).toBe(fixture.source.parentExcerptHash);
    }
  });

  it("splits the pool evenly between pane A and pane B being the later version", () => {
    const { fixtures } = generateBeforeAfterRounds({ profile, candidates: pool() });
    const aLater = fixtures.filter(({ correctCandidateId }) => correctCandidateId === BEFORE_AFTER_CANDIDATE_IDS[0]).length;
    expect(aLater).toBe(5);
  });

  it("quotes the commit subject and the line counts as its two hints", () => {
    const { fixtures } = generateBeforeAfterRounds({ profile, candidates: pool() });
    expect(fixtures[0]!.clues[0]).toMatch(/^The commit message begins: “Refactor compute helper \d+”$/u);
    expect(fixtures[0]!.clues[1]).toBe("The commit removed 5 of these lines and added 1.");
  });

  it("quotes only a subject that is short, plain, and names no address, handle, or the repository", () => {
    expect(beforeAfterSubject("Extract the retry loop (#1234)\n\nLonger body", "acme/widget", 90)).toBe("Extract the retry loop");
    expect(beforeAfterSubject("Fix", "acme/widget", 90)).toBeUndefined();
    expect(beforeAfterSubject("Refactor widget internals", "acme/widget", 90)).toBeUndefined();
    expect(beforeAfterSubject("Thanks @someone for the review", "acme/widget", 90)).toBeUndefined();
    expect(beforeAfterSubject("See https://example.test/issue", "acme/widget", 90)).toBeUndefined();
    expect(beforeAfterSubject("x".repeat(91), "acme/widget", 90)).toBeUndefined();
  });

  it("rejects an unusable subject, a pool of the wrong size, or a repeated repository", () => {
    const candidates = pool();
    expect(() => generateBeforeAfterRounds({ profile, candidates: candidates.slice(0, 9) })).toThrow(BeforeAfterRoundsError);
    const badSubject = [...candidates.slice(0, 9), commitCandidate({ profile, snapshotId, index: 9, message: "Fix" })];
    expect(() => generateBeforeAfterRounds({ profile, candidates: badSubject })).toThrow(BeforeAfterRoundsError);
    const repeated = [...candidates.slice(0, 9), commitCandidate({ profile, snapshotId, index: 9, repository: "acme0/widget-0" })];
    expect(() => generateBeforeAfterRounds({ profile, candidates: repeated })).toThrow(BeforeAfterRoundsError);
  });
});
