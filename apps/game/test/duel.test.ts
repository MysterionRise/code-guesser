import { createCipheriv, createDecipheriv, createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The duel actions read the request's headers for their rate limits (#98), which are off outside public mode.
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { artifact, hashValue } from "./support/local-real-artifact";

// Duel challenge links, the server side (#173): game state v3, the sealed challenge and result, the friend's re-deal,
// the plays ledger, and the verdict, against the committed artifact and its question layers.
const ARTIFACT_PATH = fileURLToPath(new URL("../src/demo/generated/local-real-rounds.json", import.meta.url));
const LAYERS_PATH = fileURLToPath(new URL("../src/demo/generated/question-layers.json", import.meta.url));
const { loadLocalRealExperiment } = await import("../src/demo/local-real-experiment-loader.server");
const load = (layers = LAYERS_PATH) => {
  const loaded = loadLocalRealExperiment({ artifactPath: ARTIFACT_PATH, layers: { path: layers } });
  if (!loaded.ok) throw new Error("committed artifact unavailable");
  return loaded;
};
const loaded = load();
const experiment = loaded.experiment;
let active: typeof loaded | Readonly<{ ok: false; reason: "MISSING" }> = loaded;
vi.mock("../src/demo/local-real-experiment-loader.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/demo/local-real-experiment-loader.server")>();
  return { ...original, activeLocalRealExperiment: () => active };
});

const { createDuelChallenge, issueDuelResult } = await import("../src/app/actions");
const { deriveKey } = await import("../src/demo/local-real-experiment-session.server");
const { createLocalRealExperiment } = await import("../src/demo/local-real-experiment.server");
const { duelVerdict } = await import("../src/components/duel/duel-contract");
const {
  CHALLENGE_CONTEXT, CHALLENGE_TTL_MS, MAX_TOKEN_LENGTH, RESULT_CONTEXT, RESULT_TTL_MS, openChallengeToken, openResultToken, parseChallenge,
  parseResult, sealChallenge, sealResult,
} = await import("../src/demo/local-real-experiment-duel-token.server");

interface Fixture {
  roundId: string; candidates: { id: string; label: string }[]; correctCandidateId: string; source: { authorName: string; repository: string };
}
const fixtures = new Map((JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as { decks: { fixtures: Fixture[] }[] })
  .decks.flatMap(({ fixtures: deckFixtures }) => deckFixtures.map((fixture) => [fixture.roundId, fixture] as const)));

const SECRET = "d".repeat(32);
const NOW = Date.parse("2026-10-20T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const SEED = "0a1b2c3d";
const ARMS = { design: "composer", theme: "paper", layer: "on" } as const;
const CONTROL = { design: "off", theme: "terminal", layer: "off" } as const;
const ON = { genuiEnabled: true, disabled: new Set<string>() };

type Arms = { readonly design: "off" | "catalog" | "composer" | "visualizer" | "host"; readonly theme: "terminal" | "paper" | "arcade" | "contrast"; readonly layer: "off" | "on" };
type Deal = { seed: string; game: number } | { date: string } | undefined;
type Dealt = ReturnType<typeof experiment.dealGame>;

/** The state a session token carries, read the way any client could. */
const payloadOf = (token: string): any => JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"));
const deal = (deck: string, at = NOW, arms: Arms = ARMS, how: Deal = { seed: SEED, game: 0 }, on = experiment) =>
  on.dealGame(deck as never, Math.random, at, { arms, record: true }, how);
/** Plays a dealt game through, round by round; `plan` says each round's hints and whether it is answered right. */
const play = (dealt: Dealt, plan = (index: number) => ({ hints: index % 3, right: index !== 1 }), at = NOW, rounds = 5, on = experiment) => {
  let token = dealt.sessionToken;
  dealt.mode.rounds.slice(0, rounds).forEach((round, index) => {
    const { hints, right } = plan(index);
    for (let hint = 0; hint < hints; hint += 1) token = (on.revealHint({ sessionToken: token, roundId: round.roundId }, at) as { sessionToken: string }).sessionToken;
    const fixture = fixtures.get(round.roundId)!;
    const candidateId = right ? fixture.correctCandidateId : fixture.candidates.find(({ id }) => id !== fixture.correctCandidateId)!.id;
    const answered = on.answer({ sessionToken: token, roundId: round.roundId, candidateId }, at);
    if (!answered.ok) throw new Error(`answer refused: ${answered.reason}`);
    token = answered.sessionToken;
  });
  return token;
};
const challengeOf = (token: string, at = NOW, on = experiment) => {
  const created = on.createChallenge(token, at);
  if (!created.ok) throw new Error(`challenge refused: ${created.reason}`);
  return created;
};
const dealChallenge = (challengeToken: string, at = NOW, switches = ON, on = experiment) => {
  const dealt = on.dealChallenge(challengeToken, at, true, switches);
  if (!dealt.ok) throw new Error(`challenge deal refused: ${dealt.reason}`);
  return dealt;
};
/** What a mode shows of each round: its id, its options in order, and its scaffold. */
const shown = (mode: Dealt["mode"]) => mode.rounds.map(({ roundId, mode: { candidates }, scaffold }) => ({ roundId, candidates, scaffold }));

/** A link's plaintext, opened as the format says: base64url of a 12-byte IV, the ciphertext, and a 16-byte tag. */
const plaintextOf = (token: string, context: string): string => {
  const bytes = Buffer.from(token, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(context), bytes.subarray(0, 12), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(bytes.subarray(bytes.length - 16));
  return Buffer.concat([decipher.update(bytes.subarray(12, bytes.length - 16)), decipher.final()]).toString("utf8");
};
/** Seals any value the way the server seals a link, so a test can hand it claims the server would never write. */
const sealRaw = (context: string, value: unknown): string => {
  const iv = Buffer.alloc(12, 7);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(context), iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
};

/** What a restart forgets: the session's secret and ledgers, the plays in memory, and the open store. */
const restart = (): void => {
  const holder = globalThis as Record<symbol, any>;
  holder[Symbol.for("codeguessr.state-store")]?.store?.close();
  for (const name of ["codeguessr.state-store", "codeguessr.game-session", "codeguessr.plays"]) delete holder[Symbol.for(name)];
};

let seedCounter = 0;
/** A seed no other test has dealt, so each test counts its own plays. */
const freshSeed = (): string => (0x10000000 + (seedCounter += 1)).toString(16);

beforeEach(() => {
  restart();
  vi.stubEnv("CODEGUESSR_SESSION_SECRET", SECRET);
  vi.stubEnv("CODEGUESSR_STATE_DIR", "");
  active = loaded;
});
afterEach(() => {
  restart();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("game state v3 (#173)", () => {
  it("seals how a game was dealt, its digest, its outcomes, and its prior plays, nested keys and all", () => {
    const seed = freshSeed();
    const dealt = deal("language", NOW, ARMS, { seed, game: 3 });
    expect(payloadOf(dealt.sessionToken)).toMatchObject({
      version: 3, deal: { kind: "series", seed, game: 3 }, dealDigest: expect.stringMatching(/^[0-9a-f]{32}$/u), outcomes: [], priorPlays: 0,
    });
    expect(payloadOf(deal("daily", NOW, ARMS, { date: "2026-10-20" }).sessionToken).deal).toEqual({ kind: "daily", date: "2026-10-20" });
    expect(payloadOf(experiment.dealGame("project", Math.random, NOW).sessionToken).deal).toEqual({ kind: "unseeded" });
    const token = play(dealt, (index) => ({ hints: 0, right: index !== 1 }), NOW, 3);
    expect(payloadOf(token)).toMatchObject({ outcomes: [true, false, true], correct: 2, hintsByRound: [0, 0, 0] });
    // A date for any deck but today's five, or a malformed seed or date, deals nothing.
    expect(() => deal("language", NOW, ARMS, { date: "2026-10-20" })).toThrow();
    expect(() => deal("mixed", NOW, ARMS, { seed: "nothex!!", game: 0 })).toThrow();
    expect(() => deal("daily", NOW, ARMS, { date: "20 October" })).toThrow();
  });

  it("deals today's five from a date the same as from the date's own randomness", async () => {
    const { dailyRandom } = await import("../src/demo/local-real-experiment-deal.server");
    const fromDate = deal("daily", NOW, CONTROL, { date: "2026-10-20" });
    const fromRandom = experiment.dealGame("daily", dailyRandom(experiment.artifactHash, "2026-10-20"), NOW, { arms: CONTROL, record: true });
    expect(fromDate.mode).toEqual(fromRandom.mode);
  });

  it("ends a v2 game, and any game signed under the v2 context", () => {
    const dealt = deal("fix", NOW, CONTROL);
    const v3 = payloadOf(dealt.sessionToken);
    const v2Token = (state: unknown): string => {
      const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
      return `${payload}.${createHmac("sha256", Buffer.from(SECRET, "utf8")).update(`codeguessr-game-session.v2.${payload}`).digest("base64url")}`;
    };
    const { deal: _deal, dealDigest: _digest, outcomes: _outcomes, priorPlays: _prior, ...v2 } = v3;
    const round = dealt.mode.rounds[0]!;
    for (const token of [v2Token({ ...v2, version: 2 }), v2Token(v3)]) {
      const request = { sessionToken: token, roundId: round.roundId, candidateId: fixtures.get(round.roundId)!.correctCandidateId };
      expect(experiment.answer(request, NOW)).toEqual({ ok: false, reason: "SESSION_ENDED" });
    }
    expect(experiment.answer({ sessionToken: dealt.sessionToken, roundId: round.roundId, candidateId: fixtures.get(round.roundId)!.correctCandidateId }, NOW).ok)
      .toBe(true);
  });

  it("refuses a signed state whose outcomes, deal, digest, or prior plays are malformed", () => {
    const dealt = deal("fix", NOW, CONTROL);
    const token = play(dealt, () => ({ hints: 0, right: true }), NOW, 2);
    // Signed as this server signs, so only the state's own checks can refuse it.
    const signed = (state: unknown): string => {
      const payload = Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
      return `${payload}.${createHmac("sha256", Buffer.from(SECRET, "utf8")).update(`codeguessr-game-session.v3.${payload}`).digest("base64url")}`;
    };
    const state = payloadOf(token);
    const round = dealt.mode.rounds[2]!;
    const answer = (sessionToken: string) =>
      experiment.answer({ sessionToken, roundId: round.roundId, candidateId: fixtures.get(round.roundId)!.correctCandidateId }, NOW);
    for (const edited of [
      { ...state, outcomes: [true, false] }, { ...state, outcomes: [true] }, { ...state, outcomes: [1, 1] },
      { ...state, deal: { kind: "series", seed: state.deal.seed } }, { ...state, deal: { kind: "duel", challenge: "x" } }, { ...state, deal: null },
      { ...state, dealDigest: "0".repeat(31) }, { ...state, priorPlays: 1_000 }, { ...state, priorPlays: -1 },
    ]) expect(answer(signed(edited)), JSON.stringify(edited)).toEqual({ ok: false, reason: "SESSION_ENDED" });
    expect(answer(signed(state)).ok).toBe(true);
  });
});

/**
 * Each deck's digest for game 0 of seed `0a1b2c3d` (today's five for 2026-10-21), dealt without layers, and the two
 * layered decks with them. A new artifact or new question layers deal other games: regenerate these from a run of
 * this test.
 */
const GOLDEN_DIGESTS: Readonly<Record<string, string>> = {
  mixed: "7867d7a6bcbb33e088cb33fa1026913b",
  project: "5303a7a85659234eeed99c2830633d8c",
  language: "2e83e51cfe0b147f4256b0503bad70d5",
  "before-after": "7da4d500aff9914052dc029cfa4abeb6",
  algorithm: "24df8fd25256e6ef6895d826a74a5150",
  output: "a858105d9c179e142233d006ce4437c2",
  fix: "9f5e019dbe2535b997611199480f2427",
  "missing-line": "0990f0975b024a3f3be9eeaed6daf2f2",
  "name-function": "675e5e9d5b5b94994561d312d7d6fcbf",
  framework: "b9f653b90564baf4f8ad16a2bbbe497b",
  exercise: "9d49c71b817fca9400ce7e56d4141bd8",
  daily: "1f3c2fc460ff6ffcdfa8a9729f23556c",
  "algorithm+layers": "b768358d88825d96ba8dacff46227fea",
  "language+layers": "857757c2205732515a58a2d2d1c346ac",
};

describe("the deal digest (#173)", () => {
  it("matches the golden digest of every deck's game against the committed artifact", () => {
    const digests: Record<string, string> = {};
    for (const deck of ["mixed", ...experiment.decks.map(({ id }) => id)]) {
      digests[deck] = payloadOf(deal(deck, NOW, CONTROL, { seed: SEED, game: 0 }).sessionToken).dealDigest;
    }
    digests.daily = payloadOf(deal("daily", NOW, CONTROL, { date: "2026-10-21" }).sessionToken).dealDigest;
    for (const deck of ["algorithm", "language"]) digests[`${deck}+layers`] = payloadOf(deal(deck, NOW, { ...CONTROL, layer: "on" }).sessionToken).dealDigest;
    expect(digests).toEqual(GOLDEN_DIGESTS);
  });

  it("hashes only round and option ids, and the layers through their hashes", async () => {
    const { dealDigest } = await import("../src/demo/local-real-experiment-deal.server");
    const dealt = deal("algorithm", NOW, CONTROL);
    const digest = dealDigest(dealt.mode, null);
    expect(digest).toBe(payloadOf(dealt.sessionToken).dealDigest);
    const reordered = { ...dealt.mode, rounds: [dealt.mode.rounds[1]!, dealt.mode.rounds[0]!, ...dealt.mode.rounds.slice(2)] };
    expect(dealDigest(reordered, null)).not.toBe(digest);
    expect(dealDigest(dealt.mode, [null, null, null, null, null])).not.toBe(digest);
  });
});

describe("challenge and result tokens (#173)", () => {
  const finished = () => play(deal("project", NOW, ARMS, { seed: freshSeed(), game: 0 }));

  it("round-trips a challenge and a result, each in its own context", () => {
    const created = challengeOf(finished());
    const claims = openChallengeToken(created.challengeToken, experiment.artifactHash, NOW);
    expect(JSON.parse(plaintextOf(created.challengeToken, CHALLENGE_CONTEXT))).toEqual(claims);
    expect(openChallengeToken(sealChallenge(claims), experiment.artifactHash, NOW)).toEqual(claims);
    expect(created.challengeToken.length).toBeLessThanOrEqual(MAX_TOKEN_LENGTH);
    const result = { v: 1 as const, id: claims.id, artifact: claims.artifact, deck: claims.deck, date: null, max: claims.max,
      challenger: { rounds: claims.rounds, firstPlay: claims.firstPlay }, challenged: { rounds: claims.rounds, play: 2 }, at: NOW };
    const resultToken = sealResult(result);
    expect(openResultToken(resultToken, experiment.artifactHash, NOW)).toEqual(result);
    expect(JSON.parse(plaintextOf(resultToken, RESULT_CONTEXT))).toEqual(result);
    // A challenge can't pass for a result, nor a result for a challenge.
    expect(experiment.openResult(created.challengeToken, NOW)).toEqual({ ok: false, reason: "INVALID" });
    expect(experiment.openChallenge(resultToken, NOW)).toEqual({ ok: false, reason: "INVALID" });
    expect(experiment.dealChallenge(resultToken, NOW)).toEqual({ ok: false, reason: "INVALID" });
    expect(experiment.openChallenge(sealRaw(RESULT_CONTEXT, claims), NOW)).toEqual({ ok: false, reason: "INVALID" });
  });

  it("refuses a token with any one byte flipped", () => {
    const { challengeToken } = challengeOf(finished());
    const bytes = Buffer.from(challengeToken, "base64url");
    for (const position of [0, 11, 12, 40, bytes.length - 17, bytes.length - 1]) {
      const flipped = Buffer.from(bytes);
      flipped[position] = flipped[position]! ^ 1;
      expect(experiment.openChallenge(flipped.toString("base64url"), NOW), String(position)).toEqual({ ok: false, reason: "INVALID" });
    }
  });

  it("refuses a token too long, of other characters, too short, or not a string, before decoding it", () => {
    const { challengeToken } = challengeOf(finished());
    for (const token of ["A".repeat(MAX_TOKEN_LENGTH + 1), `${challengeToken}=`, `${challengeToken.slice(0, 20)}.${challengeToken.slice(20)}`, "",
      challengeToken.slice(0, 37), 42, null, { token: challengeToken }]) {
      expect(experiment.openChallenge(token, NOW)).toEqual({ ok: false, reason: "INVALID" });
    }
  });

  it("refuses sealed claims with a key missing, unknown, or extra, or any value out of bounds", () => {
    const claims = openChallengeToken(challengeOf(finished()).challengeToken, experiment.artifactHash, NOW);
    const round = claims.rounds.find(([correct]) => correct === 1)!;
    const at = (index: number, value: unknown) => claims.rounds.map((entry, other) => other === index ? value : entry);
    const index = claims.rounds.indexOf(round);
    const { at: _at, ...withoutAt } = claims;
    for (const edited of [
      withoutAt, { ...claims, name: "Ana" }, { ...claims, deal: { ...claims.deal, extra: 1 } }, { ...claims, arms: { ...claims.arms, seat: "a" } },
      { ...claims, v: 2 }, { ...claims, deck: "poker" }, { ...claims, deal: { kind: "duel", challenge: claims.id } }, { ...claims, deal: { kind: "unseeded" } },
      { ...claims, firstPlay: "shared" }, { ...claims, firstPlay: "maybe" }, { ...claims, max: 5_001 }, { ...claims, max: 0 },
      { ...claims, max: claims.rounds.reduce((total, [, , points]) => total + points, 0) - 1 }, { ...claims, rounds: claims.rounds.slice(0, 4) },
      { ...claims, rounds: at(index, [round[0], round[1], 300]) }, { ...claims, rounds: at(index, [0, round[1], round[2]]) },
      { ...claims, rounds: at(index, [1, 3, round[2]]) }, { ...claims, rounds: at(index, [1, round[1], 0]) }, { ...claims, rounds: at(index, [...round, 1]) },
      { ...claims, id: claims.id.toUpperCase() }, { ...claims, digest: "0".repeat(64) }, { ...claims, at: 0 },
    ]) {
      expect(parseChallenge(edited), JSON.stringify(edited)).toBeNull();
      expect(experiment.openChallenge(sealRaw(CHALLENGE_CONTEXT, edited), NOW)).toEqual({ ok: false, reason: "INVALID" });
    }
    const result = { v: 1, id: claims.id, artifact: claims.artifact, deck: "daily", date: "2026-10-20", max: claims.max,
      challenger: { rounds: claims.rounds, firstPlay: "shared" }, challenged: { rounds: claims.rounds, play: 1 }, at: NOW };
    expect(parseResult(result)).not.toBeNull();
    for (const edited of [
      { ...result, deck: "project" }, { ...result, date: null }, { ...result, challenged: { ...result.challenged, play: 0 } },
      { ...result, challenged: { ...result.challenged, play: 1_001 } }, { ...result, challenged: { ...result.challenged, name: "Ana" } },
      { ...result, verdict: { winner: "challenged", decidedBy: "score" } },
    ]) expect(parseResult(edited), JSON.stringify(edited)).toBeNull();
  });

  it("expires a challenge after seven days, and a result after thirty", () => {
    const created = challengeOf(finished());
    expect(experiment.openChallenge(created.challengeToken, NOW + CHALLENGE_TTL_MS).ok).toBe(true);
    expect(experiment.openChallenge(created.challengeToken, NOW + CHALLENGE_TTL_MS + 1)).toEqual({ ok: false, reason: "EXPIRED" });
    expect(experiment.dealChallenge(created.challengeToken, NOW + CHALLENGE_TTL_MS + 1)).toEqual({ ok: false, reason: "EXPIRED" });
    expect(experiment.openChallenge(created.challengeToken, NOW - 1)).toEqual({ ok: false, reason: "INVALID" });
    // A friend dealt an hour before it expired may still finish, and take the result, after it has.
    const dealtLate = dealChallenge(created.challengeToken, NOW + CHALLENGE_TTL_MS - 3_600_000);
    const finishedAt = NOW + CHALLENGE_TTL_MS + 60_000;
    const issued = experiment.issueResult(play(dealtLate.game, undefined, finishedAt), created.challengeToken, finishedAt);
    if (!issued.ok) throw new Error(issued.reason);
    expect(experiment.openResult(issued.resultToken, finishedAt + RESULT_TTL_MS).ok).toBe(true);
    expect(experiment.openResult(issued.resultToken, finishedAt + RESULT_TTL_MS + 1)).toEqual({ ok: false, reason: "EXPIRED" });
  });

  it("names an earlier round set only for a link it can read, and its deck only while the round set offers it", () => {
    const { challengeToken } = challengeOf(finished());
    const other = createLocalRealExperiment(artifact(), hashValue(artifact()));
    expect(other.openChallenge(challengeToken, NOW)).toEqual({ ok: false, reason: "ROUND_SET", deck: "project" });
    expect(other.dealChallenge(challengeToken, NOW)).toEqual({ ok: false, reason: "ROUND_SET", deck: "project" });
    const gone = challengeOf(play(deal("exercise", NOW, ARMS, { seed: freshSeed(), game: 0 }))).challengeToken;
    expect(other.openChallenge(gone, NOW)).toEqual({ ok: false, reason: "ROUND_SET" });
    const flipped = Buffer.from(challengeToken, "base64url");
    flipped[20] = flipped[20]! ^ 1;
    expect(other.openChallenge(flipped.toString("base64url"), NOW)).toEqual({ ok: false, reason: "INVALID" });
    // Under another secret, the same link is no link at all.
    restart();
    vi.stubEnv("CODEGUESSR_SESSION_SECRET", "e".repeat(32));
    expect(experiment.openChallenge(challengeToken, NOW)).toEqual({ ok: false, reason: "INVALID" });
  });
});

describe("creating a challenge (#173)", () => {
  it("challenges only a finished game of a seeded deal or of today's five", () => {
    const series = deal("fix", NOW, CONTROL, { seed: freshSeed(), game: 0 });
    expect(experiment.createChallenge(play(series, undefined, NOW, 4), NOW)).toEqual({ ok: false, reason: "NOT_ELIGIBLE" });
    expect(experiment.createChallenge(play(experiment.dealGame("fix", Math.random, NOW)), NOW)).toEqual({ ok: false, reason: "NOT_ELIGIBLE" });
    const daily = challengeOf(play(deal("daily", NOW, CONTROL, { date: "2026-10-20" })));
    expect(daily.challenge).toMatchObject({ deck: "daily", deckTitle: "Today’s five", date: "2026-10-20", challenger: { firstPlay: "shared" } });
    const friend = play(dealChallenge(daily.challengeToken).game);
    expect(experiment.createChallenge(friend, NOW)).toEqual({ ok: false, reason: "NOT_ELIGIBLE" });
    // A spent token, or one no server issued, challenges nothing.
    expect(experiment.createChallenge(series.sessionToken, NOW)).toEqual({ ok: false, reason: "NOT_ELIGIBLE" });
    expect(experiment.createChallenge("not.a-token", NOW)).toEqual({ ok: false, reason: "SESSION_ENDED" });
  });

  it("keeps one challenge id per game, which is not the game's id", () => {
    const token = play(deal("output", NOW, ARMS, { seed: freshSeed(), game: 0 }));
    const first = challengeOf(token);
    const again = challengeOf(token, NOW + 60_000);
    expect(first.firstIssue).toBe(true);
    expect(again.firstIssue).toBe(false);
    expect(again.challengeToken).not.toBe(first.challengeToken);
    const id = (challengeToken: string) => openChallengeToken(challengeToken, experiment.artifactHash, NOW + 60_000).id;
    expect(id(again.challengeToken)).toBe(id(first.challengeToken));
    expect(id(first.challengeToken)).not.toBe(payloadOf(token).gameId);
    expect(id(challengeOf(play(deal("output", NOW, ARMS, { seed: freshSeed(), game: 0 }))).challengeToken)).not.toBe(id(first.challengeToken));
  });

  it("shows how the challenger did, scored from the server's own rounds", () => {
    const dealt = deal("before-after", NOW, CONTROL, { seed: freshSeed(), game: 0 });
    const plan = (index: number) => ({ hints: [0, 1, 2, 1, 0][index]!, right: index !== 3 });
    const token = play(dealt, plan);
    const { challenge } = challengeOf(token);
    const expected = dealt.mode.rounds.map((round, index) => {
      const { hints, right } = plan(index);
      return [right ? 1 : 0, hints, right ? round.points[hints] : 0];
    });
    expect(challenge).toEqual({
      deck: "before-after", deckTitle: experiment.decks.find(({ id }) => id === "before-after")!.title, date: null,
      max: dealt.mode.rounds.reduce((total, round) => total + round.points[0], 0),
      challenger: { rounds: expected, score: payloadOf(token).score, hints: 4, correct: 4, firstPlay: "yes" }, theme: "terminal",
      expiresAt: NOW + CHALLENGE_TTL_MS,
    });
  });
});

describe("the friend's game (#173)", () => {
  for (const [deck, how] of [["algorithm", { seed: SEED, game: 2 }], ["mixed", { seed: SEED, game: 0 }], ["language", { seed: SEED, game: 1 }]] as const) {
    it(`deals the friend the challenger's ${deck} game: its rounds, option order, and scaffolds`, () => {
      const dealt = deal(deck, NOW, ARMS, how);
      const { challengeToken } = challengeOf(play(dealt));
      const friend = dealChallenge(challengeToken, NOW + 2 * DAY);
      expect(friend.game.mode).toEqual(dealt.mode);
      expect(shown(friend.game.mode)).toEqual(shown(dealt.mode));
      if (deck === "algorithm") expect(friend.game.mode.rounds.some(({ scaffold }) => scaffold !== undefined)).toBe(true);
      expect(payloadOf(friend.game.sessionToken).dealDigest).toBe(payloadOf(dealt.sessionToken).dealDigest);
    });
  }

  it("deals today's five of the challenger's date on another day", () => {
    const dealt = deal("daily", NOW, ARMS, { date: "2026-10-20" });
    const { challengeToken } = challengeOf(play(dealt));
    const friend = dealChallenge(challengeToken, NOW + DAY);
    expect(friend.game.mode).toEqual(dealt.mode);
    expect(friend.game.mode).not.toEqual(deal("daily", NOW + DAY, ARMS, { date: "2026-10-21" }).mode);
    expect(friend.challenge.date).toBe("2026-10-20");
  });

  it("copies the challenger's arms, and plays the design static where generative UI is off or the design switched off", () => {
    const { challengeToken } = challengeOf(play(deal("algorithm", NOW, ARMS, { seed: freshSeed(), game: 0 })));
    expect(dealChallenge(challengeToken).game.arms).toEqual(ARMS);
    expect(dealChallenge(challengeToken, NOW, { genuiEnabled: false, disabled: new Set() }).game.arms).toEqual({ ...ARMS, design: "off" });
    expect(dealChallenge(challengeToken, NOW, { genuiEnabled: true, disabled: new Set(["design:composer", "theme:paper", "layer:on"]) }).game.arms)
      .toEqual({ ...ARMS, design: "off" });
    // Without switches it reads the server's own.
    vi.stubEnv("GENUI_ENABLED", "1");
    vi.stubEnv("EXPERIMENT_DISABLED", "");
    const configured = experiment.dealChallenge(challengeToken, NOW);
    expect(configured.ok && configured.game.arms).toEqual(ARMS);
    vi.stubEnv("GENUI_ENABLED", "0");
    const off = experiment.dealChallenge(challengeToken, NOW);
    expect(off.ok && off.game.arms).toEqual({ ...ARMS, design: "off" });
  });

  it("seals the friend's game with its challenge and no seed, and records none of its events", () => {
    const seed = freshSeed();
    const { challengeToken } = challengeOf(play(deal("framework", NOW, ARMS, { seed, game: 4 })));
    const friend = dealChallenge(challengeToken);
    const state = payloadOf(friend.game.sessionToken);
    expect(state.deal).toEqual({ kind: "duel", challenge: openChallengeToken(challengeToken, experiment.artifactHash, NOW).id });
    expect(state.record).toBe(false);
    expect(Buffer.from(friend.game.sessionToken.split(".")[0]!, "base64url").toString("utf8")).not.toMatch(new RegExp(`${seed}|"seed"|"game":`, "u"));
  });

  it("refuses a challenge whose re-deal drifted from the challenger's game, and logs only the code", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const seed = freshSeed();
    const { challengeToken } = challengeOf(play(deal("algorithm", NOW, ARMS, { seed, game: 0 })));
    const claims = openChallengeToken(challengeToken, experiment.artifactHash, NOW);
    const right = claims.rounds.findIndex(([correct]) => correct === 1);
    const edited = [
      // The points table moved: a right answer that scored other points, or another best score.
      { ...claims, rounds: claims.rounds.map((round, index) => index === right ? [1, round[1], round[2] === 800 ? 1000 : 800] as const : round) },
      { ...claims, max: claims.max - 500 },
      // The pool or its order moved: the deal no longer deals the digest.
      { ...claims, deal: { kind: "series" as const, seed, game: 1 } },
      { ...claims, digest: "0".repeat(32) },
    ];
    // The refusal names the deck, so the page can deal it afresh.
    const drift = { ok: false, reason: "DEAL_DRIFT", deck: "algorithm" };
    for (const value of edited) expect(experiment.dealChallenge(sealChallenge(value), NOW, true, ON)).toEqual(drift);
    // The same artifact without its question layers sells other hints, so the layered game drifted too.
    const bare = load("/no/such/question-layers.json").experiment;
    logged.mockClear();
    expect(bare.dealChallenge(challengeToken, NOW, true, ON)).toEqual(drift);
    expect(logged.mock.calls).toEqual([["DUEL_REFUSED DEAL_DRIFT"]]);
    expect(dealChallenge(challengeToken).ok).toBe(true);
  });
});

describe("the result (#173)", () => {
  it("compares both games, works the verdict out again, and names which play of the link it was", () => {
    const dealt = deal("exercise", NOW, CONTROL, { seed: freshSeed(), game: 0 });
    const { challengeToken, challenge } = challengeOf(play(dealt, (index) => ({ hints: 0, right: index < 3 })));
    const friend = dealChallenge(challengeToken, NOW + DAY);
    const token = play(friend.game, (index) => ({ hints: index === 0 ? 1 : 0, right: index !== 4 }), NOW + DAY);
    const issued = experiment.issueResult(token, challengeToken, NOW + DAY);
    if (!issued.ok) throw new Error(issued.reason);
    expect(issued.comparison).toMatchObject({
      deck: "exercise", date: null, max: challenge.max, challenger: challenge.challenger,
      challenged: { correct: 4, hints: 1, play: 1 }, verdict: duelVerdict(challenge.challenger.rounds, issued.comparison.challenged.rounds),
    });
    expect(issued.comparison.verdict.winner).toBe("challenged");
    const opened = experiment.openResult(issued.resultToken, NOW + 2 * DAY);
    expect(opened).toEqual({ ok: true, comparison: issued.comparison });
    // A result's verdict is never read from the link: there is none in it.
    expect(Object.keys(JSON.parse(plaintextOf(issued.resultToken, RESULT_CONTEXT))).sort())
      .toEqual(["artifact", "at", "challenged", "challenger", "date", "deck", "id", "max", "v"]);
    expect(issued.comparison.earlierRoundSet).toBe(false);
  });

  it("still shows a result once its round set is gone, under a generic title when its deck went too", () => {
    const other = createLocalRealExperiment(artifact(), hashValue(artifact()));
    const resultOf = (deck: string) => {
      const { challengeToken } = challengeOf(play(deal(deck, NOW, CONTROL, { seed: freshSeed(), game: 0 })));
      const issued = experiment.issueResult(play(dealChallenge(challengeToken).game), challengeToken, NOW);
      if (!issued.ok) throw new Error(issued.reason);
      return issued;
    };
    const kept = resultOf("language");
    expect(other.openResult(kept.resultToken, NOW + DAY)).toEqual({ ok: true, comparison: { ...kept.comparison, earlierRoundSet: true } });
    const gone = resultOf("exercise");
    expect(other.openResult(gone.resultToken, NOW + DAY)).toEqual({ ok: true,
      comparison: { ...gone.comparison, deckTitle: "A deck from an earlier round set", earlierRoundSet: true } });
  });

  it("takes a result only for the friend's finished game of that very challenge", () => {
    const first = challengeOf(play(deal("missing-line", NOW, CONTROL, { seed: freshSeed(), game: 0 })));
    const second = challengeOf(play(deal("missing-line", NOW, CONTROL, { seed: freshSeed(), game: 0 })));
    const friend = dealChallenge(first.challengeToken);
    expect(experiment.issueResult(play(friend.game, undefined, NOW, 4), first.challengeToken, NOW)).toEqual({ ok: false, reason: "NOT_ELIGIBLE" });
    const finished = play(dealChallenge(first.challengeToken).game);
    expect(experiment.issueResult(finished, second.challengeToken, NOW)).toEqual({ ok: false, reason: "NOT_ELIGIBLE" });
    const own = play(deal("missing-line", NOW, CONTROL, { seed: freshSeed(), game: 0 }));
    expect(experiment.issueResult(own, first.challengeToken, NOW)).toEqual({ ok: false, reason: "NOT_ELIGIBLE" });
    expect(experiment.issueResult("ended.game", first.challengeToken, NOW)).toEqual({ ok: false, reason: "SESSION_ENDED" });
    expect(experiment.issueResult(finished, "junk", NOW)).toEqual({ ok: false, reason: "INVALID" });
    expect(experiment.issueResult(finished, first.challengeToken, NOW).ok).toBe(true);
  });

  it("decides on score, then fewer hints, then more rounds right, and otherwise draws", () => {
    const rounds = (...entries: (readonly [0 | 1, 0 | 1 | 2, number])[]) => entries;
    const a = rounds([1, 0, 1000], [1, 1, 800], [0, 0, 0], [1, 2, 500], [0, 2, 0]);
    expect(duelVerdict(a, rounds([1, 0, 1000], [1, 0, 1000], [0, 0, 0], [0, 0, 0], [0, 0, 0]))).toEqual({ winner: "challenger", decidedBy: "score" });
    expect(duelVerdict(rounds([1, 0, 1000], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]), a)).toEqual({ winner: "challenged", decidedBy: "score" });
    // Level on 2,300: fewer hints wins.
    const fewerHints = rounds([1, 0, 1000], [1, 1, 800], [1, 2, 500], [0, 0, 0], [0, 0, 0]);
    expect(duelVerdict(a, fewerHints)).toEqual({ winner: "challenged", decidedBy: "hints" });
    expect(duelVerdict(fewerHints, a)).toEqual({ winner: "challenger", decidedBy: "hints" });
    // Level on score and hints: more rounds right wins.
    const moreRight = rounds([1, 0, 500], [1, 0, 500], [1, 0, 500], [1, 0, 500], [0, 0, 0]);
    const fewerRight = rounds([1, 0, 1000], [1, 0, 1000], [0, 0, 0], [0, 0, 0], [0, 0, 0]);
    expect(duelVerdict(fewerRight, moreRight)).toEqual({ winner: "challenged", decidedBy: "correct" });
    expect(duelVerdict(moreRight, fewerRight)).toEqual({ winner: "challenger", decidedBy: "correct" });
    expect(duelVerdict(a, a)).toEqual({ winner: null, decidedBy: "draw" });
  });
});

describe("what a link holds (#173)", () => {
  it("never holds a dealt round, option id or label, the challenger's game id, or a name", () => {
    for (const deck of ["fix", "language", "mixed", "daily"] as const) {
      const dealt = deal(deck, NOW, ARMS, deck === "daily" ? { date: "2026-10-20" } : { seed: freshSeed(), game: 0 });
      const token = play(dealt);
      const { challengeToken } = challengeOf(token);
      const friend = play(dealChallenge(challengeToken).game);
      const issued = experiment.issueResult(friend, challengeToken, NOW);
      if (!issued.ok) throw new Error(issued.reason);
      const challengeText = plaintextOf(challengeToken, CHALLENGE_CONTEXT);
      for (const text of [challengeText, plaintextOf(issued.resultToken, RESULT_CONTEXT)]) {
        for (const round of dealt.mode.rounds) {
          const fixture = fixtures.get(round.roundId)!;
          expect(text).not.toContain(round.roundId);
          for (const { candidateId, label } of round.mode.candidates) {
            expect(text).not.toContain(candidateId);
            expect(text).not.toContain(JSON.stringify(label));
          }
          expect(text).not.toContain(JSON.stringify(fixture.source.authorName));
          expect(text).not.toContain(fixture.source.repository);
        }
        expect(text).not.toContain(payloadOf(token).gameId);
        expect(text).not.toContain(payloadOf(friend).gameId);
      }
      expect(Object.keys(JSON.parse(challengeText)).sort()).toEqual(["arms", "artifact", "at", "deal", "deck", "digest", "firstPlay", "id", "max", "rounds", "v"]);
    }
  });
});

describe("the plays ledger (#173)", () => {
  it("marks a challenge as a second try once a game of its deal has revealed a round, even mid-game", () => {
    const seed = freshSeed();
    const first = deal("project", NOW, CONTROL, { seed, game: 0 });
    const firstToken = play(first, undefined, NOW, 1);
    // A reload of the same deal, after the first game revealed a round.
    const reload = deal("project", NOW, CONTROL, { seed, game: 0 });
    expect(payloadOf(reload.sessionToken).priorPlays).toBe(1);
    expect(challengeOf(play(reload)).challenge.challenger.firstPlay).toBe("no");
    // The first game finishes, and is still the deal's first try.
    let token = firstToken;
    first.mode.rounds.slice(1).forEach((round) => {
      const answered = experiment.answer({ sessionToken: token, roundId: round.roundId, candidateId: fixtures.get(round.roundId)!.correctCandidateId }, NOW);
      token = (answered as { sessionToken: string }).sessionToken;
    });
    expect(challengeOf(token).challenge.challenger.firstPlay).toBe("yes");
  });

  it("counts a deal nobody played for nothing, and catches up a game dealt beside one that played first", () => {
    const seed = freshSeed();
    // Two tabs dealt before either revealed a round, and a load that never played.
    const tabs = [deal("fix", NOW, CONTROL, { seed, game: 0 }), deal("fix", NOW, CONTROL, { seed, game: 0 })];
    deal("fix", NOW, CONTROL, { seed, game: 0 });
    expect(tabs.map(({ sessionToken }) => payloadOf(sessionToken).priorPlays)).toEqual([0, 0]);
    expect(challengeOf(play(tabs[1]!)).challenge.challenger.firstPlay).toBe("yes");
    expect(challengeOf(play(tabs[0]!)).challenge.challenger.firstPlay).toBe("no");
  });

  it("numbers a group's plays of one link from 1, counting only games that revealed a round", () => {
    const { challengeToken } = challengeOf(play(deal("name-function", NOW, CONTROL, { seed: freshSeed(), game: 0 })));
    // A friend who opens the link and never plays.
    dealChallenge(challengeToken);
    const plays = [1, 2, 3].map(() => {
      const issued = experiment.issueResult(play(dealChallenge(challengeToken).game), challengeToken, NOW);
      return issued.ok ? issued.comparison.challenged.play : issued.reason;
    });
    expect(plays).toEqual([1, 2, 3]);
  });

  it("forgets the counts touched longest ago past its capacity", async () => {
    const { countPlay, playsOf, playsKey } = await import("../src/demo/local-real-experiment-plays.server");
    const games = [freshSeed(), freshSeed(), freshSeed()].map((seed) => payloadOf(deal("fix", NOW, CONTROL, { seed, game: 0 }).sessionToken));
    for (const game of games) countPlay(game, NOW, 2);
    expect(games.map((game) => playsOf(playsKey(game)))).toEqual([0, 1, 1]);
  });

  describe("with a state store (#164)", () => {
    let directory: string;
    beforeEach(() => {
      directory = mkdtempSync(join(tmpdir(), "codeguessr-plays-"));
      vi.stubEnv("CODEGUESSR_STATE_DIR", directory);
    });
    afterEach(() => {
      restart();
      rmSync(directory, { recursive: true, force: true });
    });

    it("keeps a deal's plays and a link's across a restart", () => {
      const seed = freshSeed();
      const { challengeToken } = challengeOf(play(deal("output", NOW, CONTROL, { seed, game: 0 })));
      const friend = play(dealChallenge(challengeToken).game);
      expect(experiment.issueResult(friend, challengeToken, NOW)).toMatchObject({ ok: true, comparison: { challenged: { play: 1 } } });
      restart();
      expect(payloadOf(deal("output", NOW, CONTROL, { seed, game: 0 }).sessionToken).priorPlays).toBe(1);
      const later = play(dealChallenge(challengeToken).game);
      expect(experiment.issueResult(later, challengeToken, NOW)).toMatchObject({ ok: true, comparison: { challenged: { play: 2 } } });
      expect(challengeOf(play(deal("output", NOW, CONTROL, { seed, game: 0 }))).firstIssue).toBe(true);
    });
  });
});

describe("the duel actions (#173)", () => {
  it("issues a challenge and a result through the server actions, and ends both without an artifact", async () => {
    const token = play(deal("algorithm", Date.now(), CONTROL, { seed: freshSeed(), game: 0 }), undefined, Date.now());
    const created = await createDuelChallenge(token);
    if (!created.ok) throw new Error(created.reason);
    const friend = play(dealChallenge(created.challengeToken, Date.now()).game, undefined, Date.now());
    const issued = await issueDuelResult({ sessionToken: friend, challengeToken: created.challengeToken });
    expect(issued).toMatchObject({ ok: true, comparison: { challenged: { play: 1 }, verdict: { winner: null, decidedBy: "draw" } } });
    expect(await issueDuelResult(null as never)).toEqual({ ok: false, reason: "SESSION_ENDED" });
    active = { ok: false, reason: "MISSING" };
    expect(await createDuelChallenge(token)).toEqual({ ok: false, reason: "SESSION_ENDED" });
    expect(await issueDuelResult({ sessionToken: friend, challengeToken: created.challengeToken })).toEqual({ ok: false, reason: "SESSION_ENDED" });
  });
});
