import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { EventStore } from "../src/experiment/event-store.server";
import type { ExperimentEvent } from "../src/experiment/events";

// Rate limits (#98): the client key, the buckets and caps, where they are wired, and that no address is kept.
const ARTIFACT_PATH = fileURLToPath(new URL("../src/demo/generated/local-real-rounds.json", import.meta.url));
const SOURCE = fileURLToPath(new URL("../src", import.meta.url));
const { SESSION_DECK_IDS } = await import("../src/demo/local-real-experiment-domain.server");
const { parseEvent } = await import("../src/experiment/events");
const { storeSink } = await import("../src/experiment/event-store.server");

/** An event store in memory, holding to the same parser as the file store. */
const stored: ExperimentEvent[] = [];
const memoryStore: EventStore = {
  append: (event) => {
    if (parseEvent(event, SESSION_DECK_IDS) === null) throw new Error("EXPERIMENT_EVENT_REJECTED");
    stored.push(event);
  },
  read: () => stored,
  days: () => [],
  rollUp: () => [],
  totals: () => [],
};
const { loadLocalRealExperiment } = await import("../src/demo/local-real-experiment-loader.server");
const loaded = loadLocalRealExperiment({ artifactPath: ARTIFACT_PATH, events: storeSink(memoryStore, "synthetic") });
if (!loaded.ok) throw new Error("committed artifact unavailable");
const experiment = loaded.experiment;
vi.mock("../src/demo/local-real-experiment-loader.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/demo/local-real-experiment-loader.server")>();
  return { ...original, activeLocalRealExperiment: () => loaded };
});
let requestHeaders = new Headers({ host: "127.0.0.1:3000" });
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));

const { SHARED_KEY, clientKey, clientNetwork } = await import("../src/server/client-key.server");
const { BUCKET_CAPACITY, GENUI_CAPS, SURFACES, capped, limited, rateLimitScale, retryAfter, tooMany } = await import("../src/server/rate-limit.server");
const { authorizeLocalExperimentReveal, createDuelChallenge, issueDuelResult, revealLocalExperimentHint } = await import("../src/app/actions");
const { POST: beacon } = await import("../src/app/api/events/route");
const { POST: genui } = await import("../src/app/api/genui/route");
const { RATE_LIMITED_MESSAGE } = await import("../src/components/arcade/index");
const { CONTROL } = await import("../src/experiment/arms");
// @ts-expect-error The fake is plain JavaScript shared with the browser tests.
const { startFakeOpenRouter } = await import("../../../tests/e2e/fake-openrouter.mjs");
// Loaded by a computed path, so Next.js's own declarations stay out of the tests' typecheck.
const pagePath: string = "../src/app/page";
const { default: Page } = await import(pagePath) as {
  default: (props: { searchParams: Promise<Readonly<Record<string, string>>> }) => Promise<ReactElement>;
};

const LIMITS = Symbol.for("codeguessr.rate-limits");
const SALT = Symbol.for("codeguessr.client-key-salt");
const holder = globalThis as unknown as Record<symbol, { buckets?: Map<string, unknown>; counts?: Map<string, unknown> } | undefined>;
const forgetLimits = (): void => { delete holder[LIMITS]; };
const T0 = Date.parse("2026-10-21T12:00:00Z");
const ON = Object.freeze({ CODEGUESSR_RATE_LIMITS: "on" });
const keyOf = (value: string | null, env: Record<string, string> = { CODEGUESSR_CLIENT_IP_HEADER: "X-Forwarded-For" }) =>
  clientKey(new Headers(value === null ? {} : { "x-forwarded-for": value }), env);
const seeded = (seed: number) => () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const userMessage = (text: string) => ({ id: "m1", role: "user", parts: [{ type: "text", text }] });

beforeEach(forgetLimits);
afterEach(() => {
  vi.unstubAllEnvs();
  requestHeaders = new Headers({ host: "127.0.0.1:3000" });
});

describe("the client key (#98)", () => {
  it("is one shared key when no header is configured, whatever the request says", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "203.0.113.7" }), {})).toBe(SHARED_KEY);
    expect(clientKey(new Headers({ "x-forwarded-for": "203.0.113.7" }), { CODEGUESSR_CLIENT_IP_HEADER: "" })).toBe(SHARED_KEY);
  });

  it("trusts the last entry of a forwarded list, the one the proxy appended", () => {
    const key = keyOf("203.0.113.7");
    expect(key).not.toBe(SHARED_KEY);
    expect(keyOf("198.51.100.1, 203.0.113.7")).toBe(key);
    expect(keyOf("10.0.0.1, 198.51.100.2,203.0.113.7")).toBe(key);
    expect(keyOf("203.0.113.7:51234")).toBe(key);
    expect(keyOf("203.0.113.7, 198.51.100.1")).not.toBe(key);
    expect(keyOf("203.0.113.8")).not.toBe(key);
  });

  it("counts an IPv6 client by its /64, and a mapped IPv4 address as that address", () => {
    const network = keyOf("2001:db8:85a3:8d3:1319:8a2e:370:7348");
    expect(keyOf("2001:db8:85a3:8d3::1")).toBe(network);
    expect(keyOf("[2001:db8:85a3:8d3:ffff::]:443")).toBe(network);
    expect(keyOf("2001:0db8:85a3:08d3:0:0:0:9")).toBe(network);
    expect(keyOf("2001:db8:85a3:8d4::1")).not.toBe(network);
    expect(keyOf("::ffff:203.0.113.7")).toBe(keyOf("203.0.113.7"));
    expect(clientNetwork("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(clientNetwork("fe80::1")).toBe("fe80:0:0:0::/64");
    expect(clientNetwork("::ffff:c000:0201")).toBe("192.0.2.1");
    expect(clientNetwork("::1")).toBe("0:0:0:0::/64");
    for (const junk of ["", "unknown", "203.0.113", "2001:db8::g", "1.2.3.4.5"]) expect(clientNetwork(junk), junk).toBeNull();
  });

  it("shares one key for a missing or unreadable header, so nonsense wins no fresh bucket", () => {
    expect(keyOf(null)).toBe(SHARED_KEY);
    expect(keyOf("unknown")).toBe(SHARED_KEY);
    expect(keyOf("203.0.113.7, not-an-address")).toBe(SHARED_KEY);
    expect(clientKey(new Headers({ "x-forwarded-for": "203.0.113.7" }), { CODEGUESSR_CLIENT_IP_HEADER: "bad header" })).toBe(SHARED_KEY);
  });

  it("is a short keyed hash that holds no address and changes with each process's salt", () => {
    const key = keyOf("203.0.113.7");
    expect(key).toMatch(/^[A-Za-z0-9_-]{22}$/u);
    expect(key).not.toMatch(/203|113/u);
    const salt = (globalThis as unknown as Record<symbol, unknown>)[SALT];
    delete (globalThis as unknown as Record<symbol, unknown>)[SALT];
    expect(keyOf("203.0.113.7")).not.toBe(key);
    (globalThis as unknown as Record<symbol, unknown>)[SALT] = salt;
    expect(keyOf("203.0.113.7")).toBe(key);
  });
});

describe("the buckets (#98)", () => {
  it("apply in public mode or where CODEGUESSR_RATE_LIMITS is set, and nowhere else", () => {
    expect(rateLimitScale({})).toBeNull();
    expect(rateLimitScale({ CODEGUESSR_PUBLIC: "0" })).toBeNull();
    expect(rateLimitScale({ CODEGUESSR_PUBLIC: "1" })).toBe(1);
    expect(rateLimitScale(ON)).toBe(1);
    expect(rateLimitScale({ CODEGUESSR_RATE_LIMITS: "0.5" })).toBe(0.5);
    expect(rateLimitScale({ CODEGUESSR_RATE_LIMITS: "10" })).toBe(10);
    // A setting the boot check would refuse still limits, at the registry's rates.
    for (const setting of ["off", "0", "-1", "1e3", "lots"]) expect(rateLimitScale({ CODEGUESSR_RATE_LIMITS: setting }), setting).toBe(1);
    for (let request = 0; request < 1_000; request += 1) expect(limited("genui", "client", T0, {})).toBe(false);
    expect(holder[LIMITS]).toBeUndefined();
  });

  it("let a burst through, refuse the next, and refill at the surface's rate", () => {
    for (let deal = 0; deal < SURFACES.deal.burst; deal += 1) expect(limited("deal", "a", T0, ON)).toBe(false);
    expect(limited("deal", "a", T0, ON)).toBe(true);
    expect(limited("deal", "b", T0, ON)).toBe(false);
    // Twenty a minute is one every three seconds.
    expect(limited("deal", "a", T0 + 2_999, ON)).toBe(true);
    expect(limited("deal", "a", T0 + 3_000, ON)).toBe(false);
    expect(limited("deal", "a", T0 + 3_000, ON)).toBe(true);
    // A refused request takes nothing, so waiting is what refills a bucket, and it never holds more than its burst.
    expect(limited("deal", "a", T0 + 6_000, ON)).toBe(false);
    const later = T0 + 3_600_000;
    for (let deal = 0; deal < SURFACES.deal.burst; deal += 1) expect(limited("deal", "a", later, ON)).toBe(false);
    expect(limited("deal", "a", later, ON)).toBe(true);
  });

  it("hold every surface to its own burst, one client at a time, and the global surface to one bucket", () => {
    for (const [surface, { burst, global }] of Object.entries(SURFACES) as [keyof typeof SURFACES, (typeof SURFACES)[keyof typeof SURFACES]][]) {
      for (let request = 0; request < burst; request += 1) expect(limited(surface, "a", T0, ON), `${surface} ${request}`).toBe(false);
      expect(limited(surface, "a", T0, ON), surface).toBe(true);
      expect(limited(surface, "b", T0, ON), surface).toBe(global === true);
    }
    expect(Object.keys(SURFACES).sort()).toEqual(["beacon", "deal", "duel_create", "duel_open", "genui", "genui-all", "hint", "og", "reveal"]);
    expect([SURFACES.deal, SURFACES.genui, SURFACES["genui-all"]].map(({ perMinute, burst }) => [perMinute, burst])).toEqual([[20, 10], [10, 4], [120, 120]]);
    expect([SURFACES.hint, SURFACES.reveal, SURFACES.beacon].map(({ perMinute }) => perMinute)).toEqual([60, 60, 120]);
  });

  it("scale with the setting's multiplier, never below one request", () => {
    for (let deal = 0; deal < 5; deal += 1) expect(limited("deal", "a", T0, { CODEGUESSR_RATE_LIMITS: "0.5" })).toBe(false);
    expect(limited("deal", "a", T0, { CODEGUESSR_RATE_LIMITS: "0.5" })).toBe(true);
    expect(limited("genui", "b", T0, { CODEGUESSR_RATE_LIMITS: "0.01" })).toBe(false);
    expect(limited("genui", "b", T0, { CODEGUESSR_RATE_LIMITS: "0.01" })).toBe(true);
    for (let deal = 0; deal < 100; deal += 1) expect(limited("deal", "c", T0, { CODEGUESSR_RATE_LIMITS: "10" })).toBe(false);
    expect(limited("deal", "c", T0, { CODEGUESSR_RATE_LIMITS: "10" })).toBe(true);
  });

  it("forget a bucket once it is full again, at the next sweep", () => {
    limited("genui", "a", T0, ON);
    limited("deal", "b", T0, ON);
    expect([...holder[LIMITS]!.buckets!.keys()].map((id) => id.split(":")[0])).toEqual(["genui", "deal"]);
    // A genui token comes back in six seconds and a deal's in three; the sweep runs once a minute.
    limited("hint", "c", T0 + 30_000, ON);
    expect(holder[LIMITS]!.buckets!.size).toBe(3);
    limited("hint", "c", T0 + 60_000, ON);
    expect([...holder[LIMITS]!.buckets!.keys()].map((id) => id.split(":")[0])).toEqual(["hint"]);
  });

  it("remember a bounded number of buckets, forgetting the least recently used first", () => {
    limited("beacon", "first", T0, ON);
    for (let client = 0; client < BUCKET_CAPACITY; client += 1) limited("beacon", `client-${client}`, T0, ON);
    const buckets = holder[LIMITS]!.buckets!;
    expect(buckets.size).toBe(BUCKET_CAPACITY);
    expect(buckets.has("beacon:first")).toBe(false);
    expect(buckets.has(`beacon:client-${BUCKET_CAPACITY - 1}`)).toBe(true);
  });

  it("answer a limited request with 429, a stable code, and when to try again", async () => {
    const response = tooMany("deal", ON);
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ reason: "RATE_LIMITED" });
    expect([response.headers.get("retry-after"), response.headers.get("cache-control")]).toEqual(["3", "no-store"]);
    expect((["deal", "hint", "genui", "genui-all", "beacon"] as const).map((surface) => retryAfter(surface, ON))).toEqual([3, 1, 6, 1, 1]);
    expect(retryAfter("genui", { CODEGUESSR_RATE_LIMITS: "0.1" })).toBe(60);
  });
});

describe("a game's generative caps (#98)", () => {
  it("allow a dozen explainer calls a game and eight host turns a round, then refuse", () => {
    for (let call = 0; call < GENUI_CAPS.explainer; call += 1) expect(capped("explainer", "game-a", T0 + 1_000, T0, ON)).toBe(false);
    expect(capped("explainer", "game-a", T0 + 1_000, T0, ON)).toBe(true);
    expect(capped("explainer", "game-b", T0 + 1_000, T0, ON)).toBe(false);
    for (let turn = 0; turn < GENUI_CAPS.host; turn += 1) expect(capped("host", "game-a:round-1", T0 + 1_000, T0, ON)).toBe(false);
    expect(capped("host", "game-a:round-1", T0 + 1_000, T0, ON)).toBe(true);
    expect(capped("host", "game-a:round-2", T0 + 1_000, T0, ON)).toBe(false);
    expect([GENUI_CAPS.explainer, GENUI_CAPS.host]).toEqual([12, 8]);
  });

  it("forget a game's counts once it expires, and count nothing where limits don't apply", () => {
    capped("explainer", "game-a", T0 + 1_000, T0, ON);
    capped("explainer", "game-b", T0 + 120_000, T0, ON);
    capped("host", "game-c:round-1", T0 + 120_000, T0 + 61_000, ON);
    expect([...holder[LIMITS]!.counts!.keys()]).toEqual(["explainer:game-b", "host:game-c:round-1"]);
    forgetLimits();
    for (let call = 0; call < 100; call += 1) expect(capped("explainer", "game-a", T0 + 1_000, T0, {})).toBe(false);
    expect(holder[LIMITS]).toBeUndefined();
  });
});

describe("where the limits are wired (#98)", () => {
  let fake: Awaited<ReturnType<typeof startFakeOpenRouter>>;
  beforeAll(async () => { fake = await startFakeOpenRouter(); });
  afterAll(async () => { await fake.close(); });
  // The clock stands still, so no bucket refills while a test spends it, however slowly the machine runs.
  beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"], now: T0 }); });
  afterEach(() => { vi.useRealTimers(); });
  /** Turns the limits on for clients named by `X-Forwarded-For`, with generative UI against the fake provider. */
  const limitsOn = (env: Record<string, string> = {}) => {
    for (const [name, value] of Object.entries({
      CODEGUESSR_RATE_LIMITS: "on", CODEGUESSR_CLIENT_IP_HEADER: "X-Forwarded-For", GENUI_ENABLED: "1",
      OPENROUTER_API_KEY: "test-key-not-real", OPENROUTER_BASE_URL: `http://127.0.0.1:${fake.port}/api/v1`, ...env,
    })) vi.stubEnv(name, value);
  };
  const from = (address: string) => { requestHeaders = new Headers({ host: "127.0.0.1:3000", "x-forwarded-for": address }); };
  const render = async (query: Record<string, string>): Promise<string> => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(query) }));
  /** A game of the given design, its first round answered for the explainer and still open for the host. */
  const answeredGame = (design: "catalog" | "host" = "catalog") => {
    const { mode, sessionToken } = experiment.dealGame("language", seeded(5), Date.now(), { arms: { ...CONTROL, design }, record: true });
    const round = mode.rounds[0]!;
    if (design === "host") return { round, token: sessionToken };
    const answered = experiment.answer({ sessionToken, roundId: round.roundId, candidateId: round.mode.candidates[0]!.candidateId }) as { sessionToken: string };
    return { round, token: answered.sessionToken };
  };
  /** One generative request from `address`, its answer read to the end so a streamed model call completes. */
  const explain = async (body: Record<string, unknown>, address = "203.0.113.50") => {
    const response = await genui(new Request("http://127.0.0.1/api/genui", { method: "POST", headers: { "x-forwarded-for": address }, body: JSON.stringify(body) }));
    return { status: response.status, text: await response.text(), retryAfter: response.headers.get("retry-after") };
  };

  it("tells a player past the deal limit to wait, and deals nothing", async () => {
    limitsOn();
    from("203.0.113.10");
    // A deck's address redirects to a fresh seed's game and spends nothing; each game dealt spends one deal.
    await expect(render({ deck: "fix" })).rejects.toThrow("NEXT_REDIRECT");
    const dealtBefore = stored.filter(({ type }) => type === "game_dealt").length;
    // The game itself renders in the browser only, so the page shows no round here; the count below says it was dealt.
    for (let game = 0; game < SURFACES.deal.burst; game += 1) {
      expect(await render({ deck: "fix", deal: "0badcafe", game: String(game) })).not.toContain("Too many new games");
    }
    expect(stored.filter(({ type }) => type === "game_dealt").length).toBe(dealtBefore + SURFACES.deal.burst);
    const refused = await render({ deck: "fix", deal: "0badcafe", game: "10" });
    expect(refused).toContain("Too many new games — wait a minute");
    expect(refused).toContain('href="/?deck=fix&amp;deal=0badcafe&amp;game=10"');
    // Past the limit a deck's address still redirects; the game it leads to is the one refused.
    await expect(render({ deck: "fix" })).rejects.toThrow("NEXT_REDIRECT");
    expect(stored.filter(({ type }) => type === "game_dealt").length).toBe(dealtBefore + SURFACES.deal.burst);
    // Another client, and the deck chooser, are untouched.
    from("203.0.113.11");
    expect(await render({ deck: "fix", deal: "0badcafe", game: "0" })).not.toContain("Too many new games");
    from("203.0.113.10");
    expect(await render({})).toContain("Pick a deck");
  });

  it("refuses a hint or an answer past its limit with a refusal the shell explains", async () => {
    limitsOn();
    from("203.0.113.20");
    for (let request = 0; request < SURFACES.hint.burst; request += 1) {
      expect(await revealLocalExperimentHint({ sessionToken: "forged.token", roundId: "round" })).toEqual({ ok: false, reason: "SESSION_ENDED" });
    }
    expect(await revealLocalExperimentHint({ sessionToken: "forged.token", roundId: "round" })).toEqual({ ok: false, reason: "RATE_LIMITED" });
    for (let request = 0; request < SURFACES.reveal.burst; request += 1) {
      await authorizeLocalExperimentReveal({ sessionToken: "forged.token", roundId: "round", candidateId: "a" });
    }
    expect(await authorizeLocalExperimentReveal({ sessionToken: "forged.token", roundId: "round", candidateId: "a" }))
      .toEqual({ ok: false, reason: "RATE_LIMITED" });
    const shell = readFileSync(new URL("../src/components/arcade/arcade-shell.tsx", import.meta.url), "utf8");
    expect(shell.match(/response\.reason === "RATE_LIMITED" \? RATE_LIMITED_MESSAGE/gu)).toHaveLength(2);
    expect(RATE_LIMITED_MESSAGE).toMatch(/^That was too many requests at once\./u);
  });

  it("refuses duel links past their limits: making one spends a duel create, opening one a duel open (#173)", async () => {
    limitsOn();
    from("203.0.113.25");
    for (let request = 0; request < SURFACES.duel_create.burst; request += 1) {
      expect((await (request % 2 === 0 ? createDuelChallenge("forged.token") : issueDuelResult({ sessionToken: "forged.token", challengeToken: "x" }))).ok)
        .toBe(false);
    }
    expect(await createDuelChallenge("forged.token")).toEqual({ ok: false, reason: "RATE_LIMITED" });
    expect(await issueDuelResult({ sessionToken: "forged.token", challengeToken: "x" })).toEqual({ ok: false, reason: "RATE_LIMITED" });
    for (let request = 0; request < SURFACES.duel_open.burst; request += 1) expect(await render({ duel: "forged" })).toContain("isn’t valid");
    expect(await render({ duel: "forged" })).toContain("Too many duel links at once");
    expect(await render({ "duel-result": "forged" })).toContain("Too many duel links at once");
    const game = readFileSync(new URL("../src/components/duel/duel-game.tsx", import.meta.url), "utf8");
    expect(game.match(/response\.reason === "RATE_LIMITED" \? RATE_LIMITED_MESSAGE/gu)).toHaveLength(2);
  });

  it("refuses beacons past the limit before reading them", async () => {
    limitsOn();
    const send = (body: string) => beacon(new Request("http://127.0.0.1/api/events", { method: "POST", headers: { "x-forwarded-for": "203.0.113.30" }, body }));
    for (let request = 0; request < SURFACES.beacon.burst; request += 1) expect((await send("{}")).status).toBe(400);
    const refused = await send("x".repeat(5_000));
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ reason: "RATE_LIMITED" });
  });

  it("refuses generative calls past the client's limit before reading them, and past a game's caps after", async () => {
    limitsOn();
    const { round, token } = answeredGame();
    const valid = { sessionToken: token, roundId: round.roundId, design: "catalog", messages: [userMessage("Explain this round.")] };
    for (let call = 0; call < SURFACES.genui.burst; call += 1) expect((await explain(valid)).status).toBe(200);
    const refused = await explain({ junk: true });
    expect([refused.status, JSON.parse(refused.text), refused.retryAfter]).toEqual([429, { reason: "RATE_LIMITED" }, "6"]);
    expect(fake.requests).toHaveLength(SURFACES.genui.burst);
    // A game's caps hold whatever its clients' buckets allow.
    limitsOn({ CODEGUESSR_RATE_LIMITS: "100" });
    for (let call = SURFACES.genui.burst; call < GENUI_CAPS.explainer; call += 1) expect((await explain(valid, `203.0.113.${60 + call}`)).status).toBe(200);
    const spent = await explain(valid, "203.0.113.99");
    expect([spent.status, JSON.parse(spent.text)]).toEqual([429, { reason: "GAME_CAP" }]);
    const host = answeredGame("host");
    const turn = { sessionToken: host.token, roundId: host.round.roundId, design: "host", messages: [userMessage("Any tips?")] };
    for (let call = 0; call < GENUI_CAPS.host; call += 1) expect((await explain(turn, "203.0.113.100")).status).toBe(200);
    expect((await explain(turn, "203.0.113.100")).status).toBe(429);
    expect(fake.requests).toHaveLength(GENUI_CAPS.explainer + GENUI_CAPS.host);
  });

  it("limits the server's own generative calls across every client", async () => {
    limitsOn();
    const { round, token } = answeredGame();
    // The server's allowance, spent as many clients would spend it; a client with its own allowance intact is refused.
    const before = fake.requests.length;
    for (let call = 0; call < SURFACES["genui-all"].burst; call += 1) expect(limited("genui-all", `client-${call}`, Date.now())).toBe(false);
    const refused = await explain({ sessionToken: token, roundId: round.roundId, design: "catalog", messages: [userMessage("Explain this round.")] });
    expect([refused.status, JSON.parse(refused.text)]).toEqual([429, { reason: "RATE_LIMITED" }]);
    expect(fake.requests).toHaveLength(before);
  });
});

describe("no client address is kept (#98)", () => {
  /** Documentation addresses (RFC 5737, RFC 3849), each written the ways a proxy might. */
  const ADDRESSES = ["203.0.113.77", "198.51.100.5, 203.0.113.78", "2001:db8:85a3:8d3:1319:8a2e:370:7348", "[2001:db8:1:2::9]:443", "::ffff:198.51.100.200"];
  const IP_SHAPED = /\b(?:\d{1,3}\.){3}\d{1,3}\b|203\.0\.113|198\.51\.100|2001:0?db8/iu;
  let fake: Awaited<ReturnType<typeof startFakeOpenRouter>>;
  beforeAll(async () => { fake = await startFakeOpenRouter(); });
  afterAll(async () => { await fake.close(); });

  it("never reaches a log line or a stored event, on any path, limited or not", async () => {
    for (const [name, value] of Object.entries({
      CODEGUESSR_RATE_LIMITS: "on", CODEGUESSR_CLIENT_IP_HEADER: "X-Forwarded-For", GENUI_ENABLED: "1",
      OPENROUTER_API_KEY: "test-key-not-real", OPENROUTER_BASE_URL: `http://127.0.0.1:${fake.port}/api/v1`,
    })) vi.stubEnv(name, value);
    const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;
    const spies = methods.map((method) => vi.spyOn(console, method).mockImplementation(() => undefined));
    stored.length = 0;
    try {
      for (const address of ADDRESSES) {
        requestHeaders = new Headers({ host: "127.0.0.1:3000", "x-forwarded-for": address });
        for (let game = 0; game <= SURFACES.deal.burst; game += 1) {
          renderToStaticMarkup(createElement("div", null, await Page({ searchParams: Promise.resolve({ deck: "fix", deal: "0badcafe", game: String(game) }) })));
        }
        const { mode, sessionToken } = experiment.dealGame("fix", seeded(7), Date.now(), { arms: { ...CONTROL, design: "catalog" }, record: true });
        const round = mode.rounds[0]!;
        let token = sessionToken;
        for (let request = 0; request <= SURFACES.hint.burst; request += 1) {
          const response = await revealLocalExperimentHint({ sessionToken: token, roundId: round.roundId });
          if (response.ok) token = response.sessionToken;
        }
        for (let request = 0; request <= SURFACES.reveal.burst; request += 1) {
          const response = await authorizeLocalExperimentReveal({ sessionToken: token, roundId: round.roundId, candidateId: round.mode.candidates[0]!.candidateId });
          if (response.ok) token = response.sessionToken;
        }
        const headers = { "x-forwarded-for": address };
        for (let request = 0; request <= SURFACES.beacon.burst; request += 1) {
          await beacon(new Request("http://127.0.0.1/api/events", { method: "POST", headers,
            body: JSON.stringify({ sessionToken: token, event: { type: "genui_fallback", round: 1, reason: "limited" } }) }));
        }
        for (let request = 0; request <= SURFACES.genui.burst; request += 1) {
          await (await genui(new Request("http://127.0.0.1/api/genui", { method: "POST", headers,
            body: JSON.stringify({ sessionToken: token, roundId: round.roundId, design: "catalog", messages: [userMessage("Explain this round.")] }) }))).text();
        }
      }
      expect(stored.map(({ type }) => type)).toEqual(expect.arrayContaining(["game_dealt", "hint_revealed", "round_revealed", "genui_call", "genui_fallback"]));
      expect(spies.some((spy) => spy.mock.calls.length > 0)).toBe(true);
      for (const spy of spies) for (const call of spy.mock.calls) expect(call.map(String).join(" ")).not.toMatch(IP_SHAPED);
      for (const event of stored) expect(JSON.stringify(event)).not.toMatch(IP_SHAPED);
      expect(JSON.stringify([...holder[LIMITS]!.buckets!.keys(), ...holder[LIMITS]!.counts!.keys()])).not.toMatch(IP_SHAPED);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  it("is read by one module alone: only the client key names the header or reads an address", () => {
    const files = (directory: string): string[] => readdirSync(directory, { withFileTypes: true })
      .flatMap((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
    const code = (path: string) => readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gmu, "");
    const sources = files(SOURCE).filter((path) => /\.[cm]?[jt]sx?$/u.test(path));
    const naming = (pattern: RegExp) => sources.filter((path) => pattern.test(code(path))).map((path) => relative(SOURCE, path)).sort();
    // The boot check names the variable to validate it, and never sees a request.
    expect(naming(/CODEGUESSR_CLIENT_IP_HEADER/u)).toEqual(["server/client-key.server.ts", "server/environment.server.ts"]);
    expect(code(join(SOURCE, "server", "environment.server.ts"))).not.toMatch(/\bheaders\b|\.get\(/u);
    const addressHeaders = /["'`](?:x-forwarded-for|x-real-ip|forwarded|fly-client-ip|cf-connecting-ip|true-client-ip|x-client-ip|x-cluster-client-ip|fastly-client-ip)["'`]/iu;
    expect(naming(addressHeaders)).toEqual([]);
    expect(naming(/\bremoteAddress\b|\bsocket\b|\brequest\.ip\b/u)).toEqual([]);
    expect(naming(/server\/client-key\.server"/u)).toEqual(["app/actions.ts", "app/api/events/route.ts", "app/api/genui/route.ts", "app/page.tsx"]);
    // The key leaves the module only as a hash, and the module logs nothing.
    const clientKeyModule = code(join(SOURCE, "server", "client-key.server.ts"));
    expect(clientKeyModule).not.toMatch(/console\.|appendFile|writeFile|stateStore/u);
    expect(code(join(SOURCE, "server", "rate-limit.server.ts"))).not.toMatch(/console\.|appendFile|writeFile|stateStore/u);
  });
});
