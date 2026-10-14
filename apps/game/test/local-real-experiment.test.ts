import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const modulePath: string = "../src/demo/local-real-experiment.server";
const authorityModule = await import(modulePath).catch(() => ({})) as Record<string, unknown>;
const createLocalRealExperiment = typeof authorityModule.createLocalRealExperiment === "function"
  ? authorityModule.createLocalRealExperiment as (input: unknown, expectedArtifactHash: string) => any
  : (): never => { throw new Error("LOCAL_REAL_EXPERIMENT_NOT_IMPLEMENTED"); };

import { COMPOSED_ARTIFACT_HASH, artifact, curatedArtifact, hash, hashValue } from "./support/local-real-artifact";

const DECKS = ["project", "language", "before-after"] as const;
const create = (value = artifact(), expectedArtifactHash = hashValue(value)) =>
  createLocalRealExperiment(value, expectedArtifactHash);
const rejects = (value: unknown) => expect(() => create(value, hashValue(value))).toThrow(/LOCAL_REAL_EXPERIMENT_REJECTED/u);
const fixtureOf = (value: any, deck: number, round = 0): any => value.decks[deck].fixtures[round];
/** A deterministic source of randomness, so a test deals a known session. */
const seeded = (seed: number) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const NOW = 1_800_000_000_000;
const right = (experiment: any, round: any): string => experiment.privateReveals[round.roundId].correctCandidateId;
const wrong = (experiment: any, round: any): string =>
  round.mode.candidates.find(({ candidateId }: any) => candidateId !== right(experiment, round)).candidateId;
/** Answers the round being played, and returns the server's response. */
const answer = (experiment: any, token: string, round: any, candidateId = right(experiment, round), now = NOW) =>
  experiment.answer({ sessionToken: token, roundId: round.roundId, candidateId }, now);
const hint = (experiment: any, token: string, round: any, now = NOW) =>
  experiment.revealHint({ sessionToken: token, roundId: round.roundId }, now);
/** The state a token carries, read the way any client could. */
const payloadOf = (token: string): any => JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"));
const withPayload = (token: string, payload: unknown): string =>
  `${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}.${token.split(".")[1]}`;

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
    expect(experiment.decks.map((deck: any) => `${deck.id}:${deck.poolSize}`)).toEqual(["project:24", "language:24", "before-after:10"]);
    expect(Object.keys(experiment.privateReveals)).toHaveLength(58);
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

  it("plays all six decks, and keeps a fix round's lines in line order while reshuffling other four-option rounds", () => {
    const experiment = create(curatedArtifact());
    expect(experiment.decks.map((deck: any) => `${deck.id}:${deck.poolSize}`))
      .toEqual(["project:24", "language:24", "before-after:10", "algorithm:8", "output:8", "fix:8"]);
    for (let seed = 1; seed <= 6; seed += 1) {
      for (const round of experiment.dealSession("fix", seeded(seed)).rounds) {
        const lines = round.mode.candidates.map(({ label }: any) => Number(label.slice("Line ".length)));
        expect(lines).toEqual([...lines].sort((left: number, right: number) => left - right));
      }
    }
    const orders = new Set(Array.from({ length: 6 }, (_, seed) => experiment.dealSession("algorithm", seeded(seed + 1)))
      .flatMap((mode: any) => mode.rounds.map((round: any) => round.mode.candidates.map(({ candidateId }: any) => candidateId).join("|"))));
    expect(orders.size).toBeGreaterThan(5);
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

  it("keeps protected fields and hint text out of every dealt game, allowing repository names only as project labels", () => {
    const input = artifact();
    const experiment = create(input);
    const publicText = JSON.stringify(DECKS.map((id) => {
      const { mode, sessionToken } = experiment.dealGame(id, seeded(2), NOW);
      return { mode, session: payloadOf(sessionToken) };
    }));
    expect(publicText).not.toMatch(/correctCandidateId|answerCandidateId|privateReveals|evidence|explanation|attribution|"source"/iu);
    for (const fixture of input.decks.flatMap((deck: any) => deck.fixtures)) {
      for (const clue of fixture.clues) expect(publicText).not.toContain(JSON.stringify(clue).slice(1, -1));
    }
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
      (value: any) => { fixtureOf(value, 2).explanation = "An AI detector agrees."; },
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

  it("scores each answer from the server's own hint count and running score", () => {
    const experiment = create();
    for (const id of DECKS) {
      const { mode, sessionToken } = experiment.dealGame(id, seeded(11), NOW);
      const points = mode.rounds[0].points;
      const bought = hint(experiment, sessionToken, mode.rounds[0]);
      expect(bought).toEqual({ ok: true, hint: expect.any(String), sessionToken: expect.any(String) });
      const fixtures = artifact().decks[DECKS.indexOf(id)].fixtures;
      expect(bought.hint).toBe(fixtures.find(({ roundId }: any) => roundId === mode.rounds[0].roundId).clues[0]);
      const first = answer(experiment, bought.sessionToken, mode.rounds[0]);
      expect(first.ok).toBe(true);
      expect(first.reveal.correct).toBe(true);
      expect(first.reveal.answerCandidateId).toBe(right(experiment, mode.rounds[0]));
      expect(first.reveal.score).toBe(points[1]);
      expect(first.reveal.result).toEqual({ score: points[1], attainableMaximum: 5 * points[0], completedRounds: 1, resultVersionId: expect.stringMatching(/^local-experiment:/u) });
      const second = answer(experiment, first.sessionToken, mode.rounds[1]);
      expect(second.reveal.result.score).toBe(points[1] + points[0]);
      expect(second.reveal.attribution).toContain("github.com");
      expect(Object.isFrozen(second.reveal)).toBe(true);
      const missed = answer(experiment, second.sessionToken, mode.rounds[2], wrong(experiment, mode.rounds[2]));
      expect(missed.reveal.correct).toBe(false);
      expect(missed.reveal.score).toBe(0);
      expect(missed.reveal.result.score).toBe(points[1] + points[0]);
      expect(payloadOf(missed.sessionToken)).toMatchObject({ roundIndex: 3, hints: 0, score: points[1] + points[0], step: 4 });
    }
  });

  it("gives each round's hints in order, two at most, from the server", () => {
    const input = artifact();
    const experiment = create(input);
    const { mode, sessionToken } = experiment.dealGame("project", seeded(4), NOW);
    const fixture = input.decks[0].fixtures.find(({ roundId }: any) => roundId === mode.rounds[0].roundId);
    const first = hint(experiment, sessionToken, mode.rounds[0]);
    const second = hint(experiment, first.sessionToken, mode.rounds[0]);
    expect([first.hint, second.hint]).toEqual(fixture.clues);
    expect(hint(experiment, second.sessionToken, mode.rounds[0])).toEqual({ ok: false, reason: "REJECTED" });
    expect(answer(experiment, second.sessionToken, mode.rounds[0]).reveal.score).toBe(mode.rounds[0].points[2]);
  });

  it("takes one answer per round and refuses replayed, forged, foreign, expired, and finished games", () => {
    const experiment = create();
    const { mode, sessionToken } = experiment.dealGame("language", seeded(5), NOW);
    const first = answer(experiment, sessionToken, mode.rounds[0], wrong(experiment, mode.rounds[0]));
    expect(first.ok).toBe(true);
    // The token from before the answer is spent: the round cannot be answered again, nor a hint bought on it.
    expect(answer(experiment, sessionToken, mode.rounds[0])).toEqual({ ok: false, reason: "REJECTED" });
    expect(hint(experiment, sessionToken, mode.rounds[0])).toEqual({ ok: false, reason: "REJECTED" });
    // Only the round being played may be answered.
    expect(answer(experiment, first.sessionToken, mode.rounds[0])).toEqual({ ok: false, reason: "REJECTED" });
    expect(answer(experiment, first.sessionToken, mode.rounds[2])).toEqual({ ok: false, reason: "REJECTED" });

    const forged = withPayload(first.sessionToken, { ...payloadOf(first.sessionToken), score: 4000 });
    expect(answer(experiment, forged, mode.rounds[1])).toEqual({ ok: false, reason: "SESSION_ENDED" });
    expect(answer(experiment, "not-a-token", mode.rounds[1])).toEqual({ ok: false, reason: "SESSION_ENDED" });
    const foreign = create(curatedArtifact());
    expect(foreign.answer({ sessionToken: first.sessionToken, roundId: mode.rounds[1].roundId, candidateId: right(experiment, mode.rounds[1]) }, NOW))
      .toEqual({ ok: false, reason: "SESSION_ENDED" });
    expect(answer(experiment, first.sessionToken, mode.rounds[1], right(experiment, mode.rounds[1]), NOW + 6 * 60 * 60 * 1000 + 1))
      .toEqual({ ok: false, reason: "SESSION_ENDED" });

    let token = first.sessionToken;
    for (let index = 1; index < 5; index += 1) token = answer(experiment, token, mode.rounds[index]).sessionToken;
    expect(payloadOf(token)).toMatchObject({ roundIndex: 5, step: 5 });
    expect(answer(experiment, token, mode.rounds[4])).toEqual({ ok: false, reason: "REJECTED" });
    expect(hint(experiment, token, mode.rounds[4])).toEqual({ ok: false, reason: "REJECTED" });
  });

  it("continues a game the ledger has forgotten from its latest token, as after a restart with the same secret", async () => {
    const experiment = create();
    const { mode, sessionToken } = experiment.dealGame("project", seeded(6), NOW);
    const session = await import("../src/demo/local-real-experiment-session.server");
    session.forgetAllGames();
    expect(answer(experiment, sessionToken, mode.rounds[0]).ok).toBe(true);
  });

  it("rejects malformed requests without returning protected data", () => {
    const experiment = create();
    const { mode, sessionToken } = experiment.dealGame("language", seeded(5), NOW);
    const valid = { sessionToken, roundId: mode.rounds[0].roundId, candidateId: right(experiment, mode.rounds[0]) };
    const invalid = [
      { ...valid, unexpected: true },
      { ...valid, roundId: "unknown-round" },
      { ...valid, candidateId: "unknown" },
      { ...valid, candidateId: experiment.dealSession("project", seeded(5)).rounds[0].mode.candidates[0].candidateId },
      { ...valid, sessionToken: 7 },
      { roundId: valid.roundId, candidateId: valid.candidateId },
      null,
    ];
    for (const value of invalid) {
      const response = experiment.answer(value, NOW);
      expect(response.ok).toBe(false);
      expect(JSON.stringify(response)).not.toMatch(/github\.com|Author|correct/iu);
    }
    expect(experiment.revealHint({ ...valid }, NOW)).toEqual({ ok: false, reason: "REJECTED" });
    // None of those spent the game: the valid request still answers the round.
    expect(experiment.answer(valid, NOW).ok).toBe(true);
  });
});
