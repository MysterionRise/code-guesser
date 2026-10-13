import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const modulePath: string = "../src/demo/local-real-experiment.server";
const authorityModule = await import(modulePath).catch(() => ({})) as Record<string, unknown>;
const createLocalRealExperiment = typeof authorityModule.createLocalRealExperiment === "function"
  ? authorityModule.createLocalRealExperiment as (input: unknown, expectedArtifactHash: string) => any
  : (): never => { throw new Error("LOCAL_REAL_EXPERIMENT_NOT_IMPLEMENTED"); };

import { COMPOSED_ARTIFACT_HASH, artifact, hash, hashValue } from "./support/local-real-artifact";

const DECKS = ["project", "language", "before-after"] as const;
const create = (value = artifact(), expectedArtifactHash = hashValue(value)) =>
  createLocalRealExperiment(value, expectedArtifactHash);
const rejects = (value: unknown) => expect(() => create(value, hashValue(value))).toThrow(/LOCAL_REAL_EXPERIMENT_REJECTED/u);
const fixtureOf = (value: any, deck: number, round = 0): any => value.decks[deck].fixtures[round];
/** A deterministic source of randomness, so a test deals a known session. */
const seeded = (seed: number) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const requestFor = (experiment: any, mode: any, round = 0, overrides: Record<string, unknown> = {}) => {
  const publicRound = mode.rounds[round];
  return {
    roundId: publicRound.roundId,
    roundVersionId: publicRound.roundVersionId,
    candidateId: experiment.privateReveals[publicRound.roundId].correctCandidateId,
    completedRounds: round,
    currentScore: 0,
    cluesUsed: 0,
    ...overrides,
  };
};

describe("server-only local real experiment authority v3", () => {
  it("keeps every production source in the local-real authority set at 500 lines or fewer", () => {
    const sourceDirectory = new URL("../src/demo/", import.meta.url);
    const oversized = readdirSync(sourceDirectory)
      .filter((name) => /^local-real-experiment.*\.ts$/u.test(name))
      .map((name) => ({ name, lines: readFileSync(new URL(name, sourceDirectory), "utf8").split("\n").length }))
      .filter(({ lines }) => lines > 500);
    expect(oversized).toEqual([]);
  });

  it("requires the trusted artifact hash as a separate input and agrees with the preparer's hash", () => {
    const value = artifact();
    expect(createLocalRealExperiment.length).toBe(2);
    expect(hashValue(value)).toBe(COMPOSED_ARTIFACT_HASH);
    expect(() => createLocalRealExperiment(value, COMPOSED_ARTIFACT_HASH)).not.toThrow();
    expect(() => createLocalRealExperiment(value, hash("f"))).toThrow(/LOCAL_REAL_EXPERIMENT_REJECTED/u);
  });

  it("lists each deck with its pool size and keeps every reveal private", () => {
    const experiment = create();
    expect(experiment.kind).toBe("LOCAL_UNREVIEWED_EXPERIMENT");
    expect(experiment.decks.map((deck: any) => `${deck.id}:${deck.poolSize}`)).toEqual(["project:10", "language:10", "before-after:10"]);
    expect(Object.keys(experiment.privateReveals)).toHaveLength(30);
    expect(Object.isFrozen(experiment)).toBe(true);
    expect(Object.isFrozen(experiment.privateReveals)).toBe(true);
  });

  it("deals five different rounds of one deck per session, reshuffling four options but not two", () => {
    const experiment = create();
    for (const id of DECKS) {
      const mode = experiment.dealSession(id, seeded(7));
      expect(mode.rounds).toHaveLength(5);
      expect(new Set(mode.rounds.map((round: any) => round.roundId)).size).toBe(5);
      expect(new Set(mode.rounds.map((round: any) => round.mode.kind))).toEqual(new Set([id]));
      expect(Object.isFrozen(mode.rounds[0].mode.candidates)).toBe(true);
    }
    const sessions = Array.from({ length: 6 }, (_, index) => experiment.dealSession("language", seeded(index + 1)));
    expect(new Set(sessions.map((mode: any) => mode.rounds.map((round: any) => round.roundId).join("|"))).size).toBeGreaterThan(1);
    const orders = new Set(sessions.flatMap((mode: any) => mode.rounds.map((round: any) => round.mode.candidates.map(({ candidateId }: any) => candidateId).join("|"))));
    expect(orders.size).toBeGreaterThan(5);
    const pairs = experiment.dealSession("before-after", seeded(3)).rounds.map((round: any) => round.mode.candidates.map(({ label }: any) => label));
    expect(pairs.every((labels: string[]) => labels[0]!.startsWith("A ") && labels[1]!.startsWith("B "))).toBe(true);
    expect(experiment.dealSession("before-after", seeded(3)).rounds[0].content.panes.map((pane: any) => pane.label)).toEqual(["A", "B"]);
  });

  it("shows two panes for before-or-after rounds, details for project options, and points that equalise chance", () => {
    const experiment = create();
    const project = experiment.dealSession("project", seeded(1)).rounds[0];
    expect(project.content.panes).toHaveLength(1);
    expect(project.mode.candidates.every((candidate: any) => typeof candidate.detail === "string")).toBe(true);
    expect(project.points).toEqual([1000, 800, 500]);
    const beforeAfter = experiment.dealSession("before-after", seeded(1)).rounds[0];
    expect(beforeAfter.content.panes).toHaveLength(2);
    expect(beforeAfter.points).toEqual([500, 400, 250]);
  });

  it("keeps protected fields out of every dealt session, allowing repository names only as project labels", () => {
    const input = artifact();
    const experiment = create(input);
    const publicText = JSON.stringify(DECKS.map((id) => experiment.dealSession(id, seeded(2))));
    expect(publicText).not.toMatch(/correctCandidateId|answerCandidateId|privateReveals|evidence|explanation|attribution|"source"/iu);
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
    fixtureOf(stale, 1).panes[0].text = "const edited = true;";
    expect(() => create(stale, hashValue(original))).toThrow(/LOCAL_REAL_EXPERIMENT_REJECTED/u);
    rejects(stale);
  });

  it("plays any one to three decks a run could fill, in deck order", () => {
    for (const kept of [[0], [1], [2], [0, 2], [1, 2]]) {
      const partial = artifact();
      partial.decks = kept.map((index: number) => partial.decks[index]);
      expect(create(partial).decks.map((deck: any) => deck.id)).toEqual(kept.map((index) => DECKS[index]));
    }
    expect(() => create(Object.assign(artifact(), {})).dealSession("ai")).toThrow(/LOCAL_REAL_EXPERIMENT_REJECTED/u);
  });

  it("rejects an older schema, wrong deck order or size, and unknown fields", () => {
    for (const mutate of [
      (value: any) => { value.schemaVersion = "local-experiment-artifact.v2"; },
      (value: any) => { value.decks.reverse(); },
      (value: any) => { value.decks = []; },
      (value: any) => { value.decks.push(structuredClone(value.decks[0])); },
      (value: any) => { value.decks[1].id = "ai"; },
      (value: any) => { value.decks[0].fixtures = value.decks[0].fixtures.slice(0, 4); },
      (value: any) => { value.decks[1].extra = true; },
      (value: any) => { value.approvalId = "controlled-approval"; },
      (value: any) => { value.crawlSnapshot.profileVersion = "local-real-rounds.v2"; },
    ]) {
      const changed = artifact();
      mutate(changed);
      rejects(changed);
    }
  });

  it("binds each kind's answer to its recorded source", () => {
    for (const mutate of [
      (value: any) => { const fixture = fixtureOf(value, 0); fixture.correctCandidateId = fixture.candidates.find(({ id }: any) => id !== fixture.correctCandidateId).id; },
      (value: any) => { fixtureOf(value, 0).candidates[0].id = "local-experiment.project.0000000000000000.v3"; },
      (value: any) => { const fixture = fixtureOf(value, 1); fixture.correctCandidateId = fixture.candidates.find(({ id }: any) => id !== fixture.correctCandidateId).id; },
      (value: any) => { fixtureOf(value, 1).source.configuration = "Java"; },
      (value: any) => { const fixture = fixtureOf(value, 2); fixture.correctCandidateId = fixture.candidates.find(({ id }: any) => id !== fixture.correctCandidateId).id; },
      (value: any) => { fixtureOf(value, 2).candidates.reverse(); },
    ]) {
      const changed = artifact();
      mutate(changed);
      rejects(changed);
    }
  });

  it("rejects authorship or detection claims and candidate names in public text", () => {
    for (const mutate of [
      (value: any) => { fixtureOf(value, 2).evidence = "The later version is human-written."; },
      (value: any) => { fixtureOf(value, 2).explanation = "A detector agrees."; },
      (value: any) => { const fixture = fixtureOf(value, 0); fixture.clues[0] = `Compare it with ${fixture.candidates[1].label}.`; },
      (value: any) => { const fixture = fixtureOf(value, 1); fixture.clues[1] = `Unlike ${fixture.candidates.find(({ id }: any) => id !== fixture.correctCandidateId).label}, it is typed.`; },
      (value: any) => { fixtureOf(value, 2).clues[0] = `The commit message begins: “${fixtureOf(value, 2).source.authorName}”`; },
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

  it("scores a reveal from its round's points table and accepts rounds in any dealt order", () => {
    const experiment = create();
    for (const id of DECKS) {
      const mode = experiment.dealSession(id, seeded(11));
      const points = mode.rounds[0].points;
      const first = experiment.createReveal(requestFor(experiment, mode, 0, { cluesUsed: 1 }));
      expect(first.correct).toBe(true);
      expect(first.answerCandidateId).toBe(experiment.privateReveals[mode.rounds[0].roundId].correctCandidateId);
      expect(first.score).toBe(points[1]);
      expect(first.result).toEqual({ score: points[1], attainableMaximum: 5 * points[0], completedRounds: 1, resultVersionId: expect.stringMatching(/^local-experiment:/u) });
      const second = experiment.createReveal(requestFor(experiment, mode, 1, { currentScore: points[1] }));
      expect(second.result.score).toBe(points[1] + points[0]);
      expect(second.attribution).toContain("github.com");
      expect(Object.isFrozen(second)).toBe(true);
      const wrong = experiment.createReveal(requestFor(experiment, mode, 2, {
        currentScore: points[1] + points[0],
        candidateId: mode.rounds[2].mode.candidates.find(({ candidateId }: any) => candidateId !== experiment.privateReveals[mode.rounds[2].roundId].correctCandidateId).candidateId,
      }));
      expect(wrong.correct).toBe(false);
      expect(wrong.score).toBe(0);
    }
  });

  it("rejects malformed reveal requests without returning protected data", () => {
    const experiment = create();
    const mode = experiment.dealSession("language", seeded(5));
    const valid = requestFor(experiment, mode, 0);
    const invalid = [
      { ...valid, unexpected: true },
      { ...valid, roundId: "unknown-round" },
      { ...valid, roundVersionId: "stale" },
      { ...valid, candidateId: "unknown" },
      { ...valid, candidateId: experiment.dealSession("project", seeded(5)).rounds[0].mode.candidates[0].candidateId },
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
