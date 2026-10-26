import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { GameEvent } from "../src/experiment/event-store.server";

const ARTIFACT_PATH = fileURLToPath(new URL("../src/demo/generated/local-real-rounds.json", import.meta.url));
const captured: { event: GameEvent; now: number }[] = [];
const sink = (event: GameEvent, now: number) => { captured.push({ event, now }); };

const { loadLocalRealExperiment } = await import("../src/demo/local-real-experiment-loader.server");
const loaded = loadLocalRealExperiment({ artifactPath: ARTIFACT_PATH, events: sink });
if (!loaded.ok) throw new Error("committed artifact unavailable");
const experiment = loaded.experiment;
vi.mock("../src/demo/local-real-experiment-loader.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/demo/local-real-experiment-loader.server")>();
  return { ...original, activeLocalRealExperiment: () => loaded };
});
const { POST } = await import("../src/app/api/events/route");
const { CLIENT_EVENTS_PER_GAME } = await import("../src/demo/local-real-experiment-events.server");

interface Fixture { roundId: string; correctCandidateId: string; candidates: { id: string }[] }
const fixtures = new Map((JSON.parse(readFileSync(ARTIFACT_PATH, "utf8")) as { decks: { fixtures: Fixture[] }[] })
  .decks.flatMap(({ fixtures: deckFixtures }) => deckFixtures.map((fixture) => [fixture.roundId, fixture] as const)));
const seeded = (seed: number) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const ARMS = { design: "catalog", theme: "terminal", layer: "off" } as const;
const T0 = Date.parse("2026-10-15T12:00:00Z");

/** Plays a dealt game through: a hint in round one, round two answered wrong unless `allRight`, the rest right. */
const playDealt = (dealt: { mode: { rounds: readonly { roundId: string }[] }; sessionToken: string }, t0: number, allRight = false) => {
  let token = dealt.sessionToken;
  dealt.mode.rounds.forEach((round, index) => {
    const at = t0 + (index + 1) * 60_000;
    if (index === 0) token = (experiment.revealHint({ sessionToken: token, roundId: round.roundId }, at - 30_000) as { sessionToken: string }).sessionToken;
    const fixture = fixtures.get(round.roundId)!;
    const candidateId = index === 1 && !allRight ? fixture.candidates.find(({ id }) => id !== fixture.correctCandidateId)!.id : fixture.correctCandidateId;
    token = (experiment.answer({ sessionToken: token, roundId: round.roundId, candidateId }, at) as { sessionToken: string }).sessionToken;
  });
  return token;
};

/** Plays a whole game: a hint in round one, round two answered wrong, the rest right. */
const playGame = (record: boolean, t0 = T0) => {
  captured.length = 0;
  const dealt = experiment.dealGame("fix", seeded(3), t0, { arms: ARMS, record });
  return { dealt, token: playDealt(dealt, t0) };
};

const beacon = (body: unknown) => POST(new Request("http://127.0.0.1/api/events", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("game events (#107)", () => {
  it("reports a game from deal to completion under its sealed arms, with server-side times", () => {
    const { dealt } = playGame(true);
    expect(dealt.arms).toEqual(ARMS);
    expect(captured.map(({ event }) => event.type)).toEqual([
      "game_dealt", "hint_revealed", "round_revealed", "round_revealed", "round_revealed", "round_revealed", "round_revealed", "game_completed",
    ]);
    const game = captured[0]!.event.game;
    for (const { event } of captured) {
      expect({ game: event.game, origin: event.origin, deck: event.deck, arms: event.arms }).toEqual({ game, origin: "deal", deck: "fix", arms: ARMS });
    }
    expect(captured[1]!.event.fields).toEqual({ round: 1, hint: 1, ms: 30_000 });
    expect(captured[2]!.event.fields).toEqual({ round: 1, correct: true, hints: 1, ms: 60_000 });
    expect(captured[3]!.event.fields).toEqual({ round: 2, correct: false, hints: 0, ms: 60_000 });
    const points = dealt.mode.rounds[0]!.points;
    expect(captured.at(-1)!.event.fields).toEqual({ score: points[1]! + 3 * points[0]!, correct: 4, hints: 1, ms: 300_000 });
  });

  it("records nothing about a game dealt to a browser that sent Sec-GPC: 1", () => {
    playGame(false);
    expect(captured).toEqual([]);
  });

  it("seals the arms, so a client that edits them ends its own game", () => {
    const dealt = experiment.dealGame("fix", seeded(7), Date.now(), { arms: ARMS, record: true });
    const [payload, signature] = dealt.sessionToken.split(".") as [string, string];
    const state = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    const edited = `${Buffer.from(JSON.stringify({ ...state, arms: { ...state.arms, design: "host" } }), "utf8").toString("base64url")}.${signature}`;
    expect(experiment.modelContext({ sessionToken: edited, roundId: dealt.mode.rounds[0]!.roundId })).toEqual({ ok: false, reason: "SESSION_ENDED" });
  });

  it("gives a generative panel's model call to the game it belongs to", () => {
    captured.length = 0;
    const dealt = experiment.dealGame("fix", seeded(4), T0, { arms: ARMS, record: true });
    const round = dealt.mode.rounds[0]!;
    const context = experiment.modelContext({ sessionToken: dealt.sessionToken, roundId: round.roundId }, T0 + 1_000);
    if (!context.ok) throw new Error("context refused");
    expect(context.arms).toEqual(ARMS);
    context.recordCall({ ok: false, status: 402, calls: 0, tokensIn: 0, tokensOut: 0, ms: 800 }, T0 + 2_000);
    expect(captured.at(-1)!.event).toMatchObject({ type: "genui_call", fields: { round: 1, phase: "before-lock", ok: false, status: 402, ms: 800 } });
  });
});

describe("duel events (#173)", () => {
  const SWITCHES = { genuiEnabled: true, disabled: new Set<string>() };
  /** A challenger's finished game of a seeded deal, and its challenge link. */
  const challenge = (seed: string, record = true) => {
    const dealt = experiment.dealGame("fix", seeded(9), T0, { arms: ARMS, record }, { seed, game: 0 });
    const token = playDealt(dealt, T0);
    const created = experiment.createChallenge(token, T0 + 400_000);
    if (!created.ok) throw new Error(`challenge refused: ${created.reason}`);
    return { token, game: captured.find(({ event }) => event.type === "game_dealt")!.event.game, challengeToken: created.challengeToken };
  };

  it("records a challenge once, on the challenger's game, with only whether it was the deal's first try", () => {
    captured.length = 0;
    const { token, game } = challenge("d0e1f2a3");
    expect(experiment.createChallenge(token, T0 + 500_000).ok).toBe(true);
    const created = captured.filter(({ event }) => event.type === "duel_created");
    expect(created.map(({ event }) => event)).toEqual([{ type: "duel_created", game, origin: "deal", deck: "fix", arms: ARMS, fields: { firstPlay: "yes" } }]);
  });

  it("records a friend's game as a duel's, under the friend's own Sec-GPC, and its result once, from the friend's side", () => {
    captured.length = 0;
    const { challengeToken, game: challenger } = challenge("d0e1f2a4");
    captured.length = 0;
    const friend = experiment.dealChallenge(challengeToken, T0 + 600_000, true, SWITCHES);
    if (!friend.ok) throw new Error(`friend refused: ${friend.reason}`);
    // The friend answers every round right where the challenger missed one, so the friend wins on score.
    const token = playDealt(friend.game, T0 + 600_000, true);
    for (const at of [T0 + 1_000_000, T0 + 1_100_000]) expect(experiment.issueResult(token, challengeToken, at).ok).toBe(true);
    const game = captured[0]!.event.game;
    expect(game).not.toBe(challenger);
    expect(captured.map(({ event }) => event.type)).toEqual([
      "game_dealt", "hint_revealed", ...Array(5).fill("round_revealed"), "game_completed", "duel_completed",
    ]);
    for (const { event } of captured) expect({ game: event.game, origin: event.origin, arms: event.arms }).toEqual({ game, origin: "duel", arms: ARMS });
    expect(captured.at(-1)!.event.fields).toEqual({ outcome: "won", decidedBy: "score" });
    // Nothing in the friend's events names the challenge, its link, or the challenger's game or score.
    const claims = JSON.stringify(captured);
    for (const value of [challengeToken, challenger, ...challengeToken.match(/.{12}/gu)!]) expect(claims).not.toContain(value);

    captured.length = 0;
    const quiet = experiment.dealChallenge(challengeToken, T0 + 700_000, false, SWITCHES);
    if (!quiet.ok) throw new Error(`friend refused: ${quiet.reason}`);
    expect(experiment.issueResult(playDealt(quiet.game, T0 + 700_000), challengeToken, T0 + 1_200_000).ok).toBe(true);
    expect(captured).toEqual([]);
  });

  it("takes a friend's link copies and rematch through the beacon, on the friend's game", async () => {
    const seed = "d0e1f2a5";
    const dealt = experiment.dealGame("fix", seeded(9), Date.now() - 900_000, { arms: ARMS, record: true }, { seed, game: 0 });
    const created = experiment.createChallenge(playDealt(dealt, Date.now() - 900_000), Date.now() - 400_000);
    if (!created.ok) throw new Error(`challenge refused: ${created.reason}`);
    const friend = experiment.dealChallenge(created.challengeToken, Date.now() - 350_000, true, SWITCHES);
    if (!friend.ok) throw new Error(`friend refused: ${friend.reason}`);
    const token = playDealt(friend.game, Date.now() - 350_000);
    captured.length = 0;
    expect((await beacon({ sessionToken: token, event: { type: "duel_link_copied", link: "result", via: "share" } })).status).toBe(204);
    expect((await beacon({ sessionToken: token, event: { type: "deal_again", to: "rematch" } })).status).toBe(204);
    expect((await beacon({ sessionToken: token, event: { type: "duel_link_copied", link: "result", via: "share", vs: "Ben" } })).status).toBe(400);
    expect((await beacon({ sessionToken: token, event: { type: "duel_created", firstPlay: "yes" } })).status).toBe(400);
    expect(captured.map(({ event }) => [event.type, event.origin, event.fields])).toEqual([
      ["duel_link_copied", "duel", { link: "result", via: "share" }], ["deal_again", "duel", { to: "rematch" }],
    ]);
  });
});

describe("the event beacon (#107)", () => {
  it("records a browser event for a live game, and refuses anything else", async () => {
    // Played in the last minutes, since the route checks the token against the real clock.
    const { token } = playGame(true, Date.now() - 400_000);
    captured.length = 0;
    expect((await beacon({ sessionToken: token, event: { type: "result_shared", via: "share" } })).status).toBe(204);
    expect((await beacon({ sessionToken: token, event: { type: "deal_again", to: "chooser" } })).status).toBe(204);
    expect((await beacon({ sessionToken: token, event: { type: "genui_interaction", round: 5, action: "explain" } })).status).toBe(204);
    expect(captured.map(({ event }) => [event.type, event.fields])).toEqual([
      ["result_shared", { via: "share" }], ["deal_again", { to: "chooser" }], ["genui_interaction", { round: 5, action: "explain" }],
    ]);
    captured.length = 0;
    // Server events can't be sent from a browser, nor retired ones, and no field outside the schema gets through.
    expect((await beacon({ sessionToken: token, event: { type: "round_revealed", round: 1, correct: true, hints: 0, ms: 1 } })).status).toBe(400);
    expect((await beacon({ sessionToken: token, event: { type: "result_copied" } })).status).toBe(400);
    expect((await beacon({ sessionToken: token, event: { type: "result_shared", via: "share", text: "my answer was A" } })).status).toBe(400);
    expect((await beacon({ sessionToken: token, event: { type: "result_shared", via: "clipboard" }, ip: "127.0.0.1" })).status).toBe(400);
    expect((await beacon({ sessionToken: "forged.token", event: { type: "result_shared", via: "clipboard" } })).status).toBe(410);
    expect((await beacon("{not json")).status).toBe(400);
    expect((await beacon("x".repeat(3_000))).status).toBe(413);
    expect(captured).toEqual([]);
  });

  it("takes the longest beacon of any deck's finished game, with room to spare (#173)", async () => {
    // The largest token: a finished game of a seeded deal's last game, both hints bought every round, the longest arms.
    for (const deck of ["daily", "mixed", ...experiment.decks.map(({ id }) => id)] as const) {
      const dealt = experiment.dealGame(deck, Math.random, Date.now(), { arms: { design: "visualizer", theme: "contrast", layer: "on" }, record: false },
        deck === "daily" ? { date: "2026-10-21" } : { seed: "ffffffff", game: 999 });
      let token = dealt.sessionToken;
      for (const round of dealt.mode.rounds) {
        for (let hint = 0; hint < 2; hint += 1) token = (experiment.revealHint({ sessionToken: token, roundId: round.roundId }) as { sessionToken: string }).sessionToken;
        token = (experiment.answer({ sessionToken: token, roundId: round.roundId, candidateId: fixtures.get(round.roundId)!.correctCandidateId }) as { sessionToken: string })
          .sessionToken;
      }
      const body = JSON.stringify({ sessionToken: token, event: { type: "genui_interaction", round: 5, action: "offer_hint" } });
      expect(body.length, deck).toBeLessThan(1_536);
      expect((await beacon(body)).status, deck).toBe(204);
    }
  });

  it("refuses an event about a round the game hasn't reached", async () => {
    const dealt = experiment.dealGame("fix", seeded(5), Date.now(), { arms: ARMS, record: true });
    expect((await beacon({ sessionToken: dealt.sessionToken, event: { type: "genui_interaction", round: 1, action: "explain" } })).status).toBe(204);
    expect((await beacon({ sessionToken: dealt.sessionToken, event: { type: "genui_interaction", round: 2, action: "explain" } })).status).toBe(400);
  });

  it("caps the events one game may send, and answers a game that records nothing the same way", async () => {
    const dealt = experiment.dealGame("fix", seeded(6), Date.now(), { arms: ARMS, record: false });
    captured.length = 0;
    const statuses = [];
    for (let index = 0; index <= CLIENT_EVENTS_PER_GAME; index += 1) {
      statuses.push((await beacon({ sessionToken: dealt.sessionToken, event: { type: "game_viewed", viewport: "desktop" } })).status);
    }
    expect(statuses.slice(0, -1).every((status) => status === 204)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    expect(captured).toEqual([]);
  });
});
