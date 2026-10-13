import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const modulePath: string = "../src/demo/local-real-experiment.server";
const authorityModule = await import(modulePath).catch(() => ({})) as Record<string, unknown>;
const createLocalRealExperiment = typeof authorityModule.createLocalRealExperiment === "function"
  ? authorityModule.createLocalRealExperiment as (input: unknown, expectedArtifactHash: string) => any
  : (): never => { throw new Error("LOCAL_REAL_EXPERIMENT_NOT_IMPLEMENTED"); };

import { COMPOSED_ARTIFACT_HASH, artifact, hash, hashValue } from "./support/local-real-artifact";

const create = (value = artifact(), expectedArtifactHash = hashValue(value)) =>
  createLocalRealExperiment(value, expectedArtifactHash);
const rehashed = (value: unknown) => create(value, hashValue(value));
const rejects = (value: unknown) => expect(() => rehashed(value)).toThrow(/LOCAL_REAL_EXPERIMENT_REJECTED/u);
const fixtureOf = (value: any, deck: number, round = 0): any => value.decks[deck].fixtures[round];
const requestFor = (experiment: any, deck: number, round = 0, overrides: Record<string, unknown> = {}) => {
  const publicRound = experiment.decks[deck].mode.rounds[round];
  return {
    roundId: publicRound.roundId,
    roundVersionId: publicRound.roundVersionId,
    candidateId: experiment.privateReveals[publicRound.roundId].correctCandidateId,
    completedRounds: round,
    currentScore: round * 1000,
    cluesUsed: 0,
    ...overrides,
  };
};

describe("server-only local real experiment authority v2", () => {
  it("keeps every production source in the local-real authority set at 500 lines or fewer", () => {
    const sourceDirectory = new URL("../src/demo/", import.meta.url);
    const oversized = readdirSync(sourceDirectory)
      .filter((name) => /^local-real-experiment.*\.ts$/u.test(name))
      .map((name) => ({ name, lines: readFileSync(new URL(name, sourceDirectory), "utf8").split("\n").length }))
      .filter(({ lines }) => lines > 500);
    expect(oversized).toEqual([]);
  });

  it("requires the trusted artifact hash as a separate consumption input and agrees with the preparer's hash", () => {
    const factory = authorityModule.createLocalRealExperiment as (value: unknown, expectedArtifactHash: string) => unknown;
    const value = artifact();
    expect(factory.length).toBe(2);
    expect(hashValue(value)).toBe(COMPOSED_ARTIFACT_HASH);
    expect(() => factory(value, COMPOSED_ARTIFACT_HASH)).not.toThrow();
    expect(() => factory(value, hash("f"))).toThrow(/LOCAL_REAL_EXPERIMENT_REJECTED/u);
  });

  it("derives three decks of five single-kind rounds with titles, descriptions, and the AI notice", () => {
    const experiment = create();
    expect(experiment.kind).toBe("LOCAL_UNREVIEWED_EXPERIMENT");
    expect(experiment.decks.map((deck: any) => `${deck.id}:${deck.mode.rounds.map((round: any) => round.mode.kind).join(",")}`)).toEqual([
      "project:project,project,project,project,project",
      "language:language,language,language,language,language",
      "ai:ai,ai,ai,ai,ai",
    ]);
    expect(experiment.decks.map((deck: any) => deck.title)).toEqual(artifact().decks.map((deck: any) => deck.title));
    expect(experiment.decks.map((deck: any) => deck.notice === null)).toEqual([true, true, false]);
    expect(Object.keys(experiment.privateReveals)).toHaveLength(15);
    expect(new Set(experiment.decks.map((deck: any) => deck.mode.sessionContractVersionId)).size).toBe(3);
    expect(Object.isFrozen(experiment)).toBe(true);
    expect(Object.isFrozen(experiment.decks[2].mode.rounds[0].mode.candidates)).toBe(true);
    expect(Object.isFrozen(experiment.privateReveals)).toBe(true);
  });

  it("keeps protected fields out of every deck's public projection, allowing repository names only as project labels", () => {
    const input = artifact();
    const experiment = create(input);
    const publicText = JSON.stringify(experiment.decks);
    expect(publicText).not.toMatch(/correctCandidateId|privateReveals|evidence|explanation|attribution|"source"/iu);
    const projectLabels = new Set(input.decks[0].fixtures.flatMap((fixture: any) => fixture.candidates.map(({ label }: any) => label)));
    for (const fixture of input.decks.flatMap((deck: any) => deck.fixtures)) {
      if (!projectLabels.has(fixture.source.repository)) expect(publicText).not.toContain(fixture.source.repository);
      expect(publicText).not.toContain(fixture.source.commit);
      expect(publicText).not.toContain(fixture.source.authorName);
      expect(publicText).not.toContain(fixture.attribution);
    }
  });

  it("rejects stale or edited content even when the caller supplies an object", () => {
    const original = artifact();
    const stale = structuredClone(original);
    fixtureOf(stale, 1).excerpt = "const edited = true;";
    expect(() => create(stale, hashValue(original))).toThrow(/LOCAL_REAL_EXPERIMENT_REJECTED/u);
    rejects(stale);
  });

  it("rejects the revision 11 schema, wrong deck order or size, and missing or extra notices", () => {
    for (const mutate of [
      (value: any) => { value.schemaVersion = "local-experiment-artifact.v1"; },
      (value: any) => { value.decks.reverse(); },
      (value: any) => { value.decks.pop(); },
      (value: any) => { value.decks[0].fixtures.pop(); },
      (value: any) => { value.decks[2].fixtures.push(structuredClone(value.decks[2].fixtures[0])); },
      (value: any) => { value.decks[2].notice = null; },
      (value: any) => { value.decks[0].notice = "Extra notice."; },
      (value: any) => { value.decks[1].extra = true; },
      (value: any) => { value.approvalId = "controlled-approval"; },
      (value: any) => { value.crawlSnapshot.stack.configurations = ["Python", "TypeScript"]; },
      (value: any) => { value.crawlSnapshot.profileVersion = "local-real-rounds.v1"; },
      (value: any) => { delete value.crawlSnapshot.github.queries[0].role; },
    ]) {
      const changed = artifact();
      mutate(changed);
      rejects(changed);
    }
  });

  it("binds each kind's answer to its recorded source", () => {
    for (const mutate of [
      (value: any) => { const fixture = fixtureOf(value, 0); fixture.correctCandidateId = fixture.candidates.find(({ id }: any) => id !== fixture.correctCandidateId).id; },
      (value: any) => { fixtureOf(value, 0).candidates[0].id = "local-experiment.project.0000000000000000.v2"; },
      (value: any) => { fixtureOf(value, 0).source.queryId = "ai-copilot-github"; },
      (value: any) => { const fixture = fixtureOf(value, 1); fixture.correctCandidateId = fixture.candidates.find(({ id }: any) => id !== fixture.correctCandidateId).id; },
      (value: any) => { fixtureOf(value, 1).candidates.pop(); },
      (value: any) => { fixtureOf(value, 1).source.configuration = "Java"; },
      (value: any) => { const fixture = fixtureOf(value, 2); fixture.correctCandidateId = fixture.candidates.find(({ id }: any) => id !== fixture.correctCandidateId).id; },
      (value: any) => { fixtureOf(value, 2).candidates.reverse(); },
      (value: any) => { const credited = value.decks[2].fixtures.find((fixture: any) => fixture.source.aiCreditRecorded); credited.source.queryId = "ordinary-github"; },
      (value: any) => { const absent = value.decks[2].fixtures.find((fixture: any) => !fixture.source.aiCreditRecorded); absent.source.aiAssistant = "Claude"; },
    ]) {
      const changed = artifact();
      mutate(changed);
      rejects(changed);
    }
  });

  it("requires at least two of each AI outcome and five distinct languages", () => {
    const lopsided = artifact();
    for (const fixture of lopsided.decks[2].fixtures) {
      if (fixture.source.aiCreditRecorded) continue;
      fixture.source.aiCreditRecorded = true;
      fixture.source.aiAssistant = "Claude";
      fixture.source.queryId = "ai-claude-github";
      fixture.correctCandidateId = "local-experiment.ai-credit-recorded.v2";
    }
    rejects(lopsided);
    const repeatedLanguage = artifact();
    const first = fixtureOf(repeatedLanguage, 1, 0);
    const second = fixtureOf(repeatedLanguage, 1, 1);
    second.source.configuration = first.source.configuration;
    second.source.detectedLanguage = first.source.configuration;
    rejects(repeatedLanguage);
  });

  it("rejects AI authorship or detection claims and candidate names in public text", () => {
    for (const mutate of [
      (value: any) => { fixtureOf(value, 2).evidence = "The commit message credits no AI assistant, so it is human-written."; },
      (value: any) => { fixtureOf(value, 2).explanation = "An AI detector agrees."; },
      (value: any) => { const fixture = fixtureOf(value, 0); fixture.clues[0] = `Compare it with ${fixture.candidates[1].label}.`; },
      (value: any) => { const fixture = fixtureOf(value, 1); fixture.clues[1] = `Unlike ${fixture.candidates.find(({ id }: any) => id !== fixture.correctCandidateId).label}, it is typed.`; },
      (value: any) => { fixtureOf(value, 2).clues[0] = `Commit subject: “${fixtureOf(value, 2).source.authorName}”`; },
    ]) {
      const changed = artifact();
      mutate(changed);
      rejects(changed);
    }
  });

  it("deduplicates within each deck and across decks", () => {
    const sameRepository = artifact();
    fixtureOf(sameRepository, 0, 1).source.repository = fixtureOf(sameRepository, 0, 0).source.repository;
    rejects(sameRepository);
    const crossDeck = artifact();
    fixtureOf(crossDeck, 2, 0).source.blob = fixtureOf(crossDeck, 0, 0).source.blob;
    rejects(crossDeck);
    const sameRound = artifact();
    fixtureOf(sameRound, 2, 0).roundId = fixtureOf(sameRound, 0, 0).roundId.toUpperCase();
    rejects(sameRound);
  });

  it("routes a reveal to its own deck and applies order, score, and clue checks within that deck", () => {
    const experiment = create();
    for (const deck of [0, 1, 2]) {
      const first = experiment.createReveal(requestFor(experiment, deck, 0, { cluesUsed: 1 }));
      expect(first.correct).toBe(true);
      expect(first.score).toBe(800);
      expect(first.result).toEqual({ score: 800, attainableMaximum: 5000, completedRounds: 1, resultVersionId: expect.stringMatching(/^local-experiment:/u) });
      const second = experiment.createReveal(requestFor(experiment, deck, 1, { currentScore: 800 }));
      expect(second.result.score).toBe(1800);
      expect(second.attribution).toContain("github.com");
      expect(Object.isFrozen(second)).toBe(true);
    }
  });

  it("rejects malformed and cross-deck reveal requests without returning protected data", () => {
    const experiment = create();
    const valid = requestFor(experiment, 1, 0);
    const otherDeckRound = experiment.decks[0].mode.rounds[1];
    const invalid = [
      { ...valid, unexpected: true },
      { ...valid, completedRounds: 1 },
      { ...valid, roundId: otherDeckRound.roundId },
      { ...valid, roundId: "unknown-round" },
      { ...valid, roundVersionId: "stale" },
      { ...valid, candidateId: "unknown" },
      { ...valid, cluesUsed: 3 },
      { ...valid, currentScore: 1 },
      { ...valid, completedRounds: 5 },
    ];
    for (const value of invalid) {
      let serialized = "";
      try {
        experiment.createReveal(value);
      } catch (error) {
        serialized = JSON.stringify(error instanceof Error ? error.message : error);
      }
      expect(serialized).toMatch(/LOCAL_REAL_EXPERIMENT_REJECTED/u);
      expect(serialized).not.toMatch(/github\.com|Author/iu);
    }
  });
});
