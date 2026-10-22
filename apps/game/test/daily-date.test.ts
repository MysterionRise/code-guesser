import { fileURLToPath } from "node:url";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { EventStore } from "../src/experiment/event-store.server";
import type { ExperimentEvent } from "../src/experiment/events";

// Today's five on the player's own date (#172): which dates the server deals, and what the page does without one.
const ARTIFACT_PATH = fileURLToPath(new URL("../src/demo/generated/local-real-rounds.json", import.meta.url));
const { SESSION_DECK_IDS } = await import("../src/demo/local-real-experiment-domain.server");
const { parseEvent } = await import("../src/experiment/events");
const { storeSink } = await import("../src/experiment/event-store.server");
const { dailyDateOf } = await import("../src/demo/local-real-experiment-deal.server");
const { localDate } = await import("../src/components/daily-link");
const { SURFACES } = await import("../src/server/rate-limit.server");

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
vi.mock("../src/demo/local-real-experiment-loader.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/demo/local-real-experiment-loader.server")>();
  return { ...original, activeLocalRealExperiment: () => loaded };
});
let requestHeaders = new Headers({ host: "127.0.0.1:3000" });
vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
// The game itself loads only in the browser; here it shows the props the page dealt it, functions aside.
vi.mock("../src/demo/demo-arcade", () => ({
  DemoArcade: (props: Record<string, unknown>) => createElement("pre", { "data-arcade": JSON.stringify(props) }),
}));
// Loaded by a computed path, so Next.js's own declarations stay out of the tests' typecheck.
const pagePath: string = "../src/app/page";
const { default: Page } = await import(pagePath) as {
  default: (props: { searchParams: Promise<Readonly<Record<string, string>>> }) => Promise<ReactElement>;
};

const DAY = 86_400_000;
/** A date as a time zone names it at an instant, `YYYY-MM-DD`. */
const zoneDate = (zone: string, at: number): string => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(at);
const utcDate = (at: number): string => new Date(at).toISOString().slice(0, 10);
/** The state a token carries, read the way any client could. */
const payloadOf = (token: string): any => JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString("utf8"));
const render = async (query: Record<string, string>): Promise<string> => renderToStaticMarkup(await Page({ searchParams: Promise.resolve(query) }));
/** The props the page dealt the game, or null when it dealt none. */
const arcadeOf = (html: string): Record<string, any> | null => {
  const match = /data-arcade="([^"]*)"/u.exec(html);
  return match ? JSON.parse(match[1]!.replaceAll("&quot;", "\"").replaceAll("&amp;", "&")) : null;
};
const dealtCount = () => stored.filter(({ type }) => type === "game_dealt").length;

afterEach(() => {
  vi.unstubAllEnvs();
  requestHeaders = new Headers({ host: "127.0.0.1:3000" });
});

describe("the date today's five is dealt for (#172)", () => {
  it("accepts a real date within a day of the server's UTC date, and nothing else", () => {
    for (const now of [Date.parse("2026-10-21T00:00:00Z"), Date.parse("2026-10-21T12:34:56Z"), Date.parse("2026-10-21T23:59:59.999Z")]) {
      for (const date of ["2026-10-20", "2026-10-21", "2026-10-22"]) expect(dailyDateOf({ date }, now), date).toBe(date);
      for (const date of ["2026-10-19", "2026-10-23", "2025-10-21", "2000-01-01"]) expect(dailyDateOf({ date }, now), date).toBeNull();
    }
    const now = Date.parse("2026-02-28T12:00:00Z");
    expect(dailyDateOf({ date: "2026-03-01" }, now)).toBe("2026-03-01");
    // A date that doesn't exist, or isn't written `YYYY-MM-DD`, or is given twice, is no date.
    for (const date of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-2-28", "28 February", "2026-02-28T00:00", ""]) {
      expect(dailyDateOf({ date }, now), date).toBeNull();
    }
    expect(dailyDateOf({ date: ["2026-02-28", "2026-02-28"] }, now)).toBeNull();
    expect(dailyDateOf({}, now)).toBeNull();
  });

  it("covers every time zone from UTC−12 to UTC+14, at every hour of a day", () => {
    const midnight = Date.parse("2026-10-21T00:00:00Z");
    for (let hour = 0; hour < 24; hour += 0.5) {
      const now = midnight + hour * DAY / 24;
      for (const zone of ["Etc/GMT+12", "Pacific/Pago_Pago", "UTC", "Asia/Kolkata", "Pacific/Chatham", "Pacific/Kiritimati"]) {
        expect(dailyDateOf({ date: zoneDate(zone, now) }, now), `${zone} at ${hour}h`).toBe(zoneDate(zone, now));
      }
    }
  });

  it("names a date as the player's machine does", () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localDate(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
  });
});

describe("today's five's address (#172)", () => {
  it("has the browser add its date to a bare address, and deals nothing there", async () => {
    const before = dealtCount();
    const html = await render({ deck: "daily" });
    expect(html).toContain("Dealing today’s five…");
    expect(arcadeOf(html)).toBeNull();
    expect(dealtCount()).toBe(before);
  });

  it("refuses a date it won't deal, and deals nothing", async () => {
    const before = dealtCount();
    for (const date of ["2000-01-01", utcDate(Date.now() + 2 * DAY), "tomorrow", ""]) {
      const html = await render({ deck: "daily", date });
      expect(html, date).toContain("That day’s five isn’t open");
      expect(html).toContain('href="/?deck=daily"');
      expect(arcadeOf(html)).toBeNull();
    }
    expect(dealtCount()).toBe(before);
  });

  it("deals the player's date, names it, seals it, and shares it", async () => {
    for (const date of [utcDate(Date.now() - DAY), utcDate(Date.now()), utcDate(Date.now() + DAY)]) {
      const before = dealtCount();
      const arcade = arcadeOf(await render({ deck: "daily", date }))!;
      expect(arcade.deckTitle).toBe(`Today’s five, ${date}`);
      expect(payloadOf(arcade.sessionToken)).toMatchObject({ deck: "daily", deal: { kind: "daily", date }, record: true });
      expect(arcade.shareHref).toBe(`http://127.0.0.1:3000/?deck=daily&date=${date}`);
      expect(arcade.replayHref).toBe(`/?deck=daily&date=${date}&replay=1`);
      expect(arcade.newGameHref).toBe("/?deck=mixed");
      expect(dealtCount()).toBe(before + 1);
    }
  });

  it("makes a finished game a challenge on the player's date (#173)", async () => {
    const date = utcDate(Date.now() + DAY);
    const arcade = arcadeOf(await render({ deck: "daily", date }))!;
    let token: string = arcade.sessionToken;
    for (const round of arcade.mode.rounds as { roundId: string; mode: { candidates: { candidateId: string }[] } }[]) {
      const answered = loaded.experiment.answer({ sessionToken: token, roundId: round.roundId, candidateId: round.mode.candidates[0]!.candidateId });
      if (!answered.ok) throw new Error("answer refused");
      token = answered.sessionToken;
    }
    const challenge = loaded.experiment.createChallenge(token);
    expect(challenge).toMatchObject({ ok: true, challenge: { deck: "daily", date } });
  });

  it("deals the same five on every load of a date, so a shared link deals a friend the same game", async () => {
    const date = utcDate(Date.now());
    const rounds = async () => (arcadeOf(await render({ deck: "daily", date }))!.mode.rounds as { roundId: string }[]).map(({ roundId }) => roundId);
    expect(await rounds()).toEqual(await rounds());
  });

  it("plays again recording nothing, and shares the plain date", async () => {
    const date = utcDate(Date.now());
    const before = dealtCount();
    const arcade = arcadeOf(await render({ deck: "daily", date, replay: "1" }))!;
    expect(payloadOf(arcade.sessionToken)).toMatchObject({ deal: { kind: "daily", date }, record: false });
    expect(arcade.shareHref).toBe(`http://127.0.0.1:3000/?deck=daily&date=${date}`);
    expect(arcade.replayHref).toBe(`/?deck=daily&date=${date}&replay=1`);
    expect(dealtCount()).toBe(before);
    // A seeded deal's game has no replay, and takes no record flag from one.
    const seeded = arcadeOf(await render({ deck: "fix", deal: "0badcafe", game: "0", replay: "1" }))!;
    expect(payloadOf(seeded.sessionToken).record).toBe(true);
    expect(seeded).not.toHaveProperty("replayHref");
  });

  it("spends no deal on a bare address or a refused date (#98)", async () => {
    for (const [name, value] of Object.entries({ CODEGUESSR_RATE_LIMITS: "on", CODEGUESSR_CLIENT_IP_HEADER: "X-Forwarded-For" })) vi.stubEnv(name, value);
    requestHeaders = new Headers({ host: "127.0.0.1:3000", "x-forwarded-for": "203.0.113.172" });
    for (let visit = 0; visit <= SURFACES.deal.burst; visit += 1) {
      expect(await render({ deck: "daily" })).toContain("Dealing today’s five…");
      expect(await render({ deck: "daily", date: "2000-01-01" })).toContain("That day’s five isn’t open");
    }
    // Each game of the date spends one, as any deal does.
    for (let game = 0; game < SURFACES.deal.burst; game += 1) expect(arcadeOf(await render({ deck: "daily", date: utcDate(Date.now()) }))).not.toBeNull();
    expect(await render({ deck: "daily", date: utcDate(Date.now()) })).toContain("Too many new games — wait a minute");
  });
});
