import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { E2E_EVENTS_DIR } from "../../playwright.config";
import { buildReport, readStore } from "../../ops/experiment/report";

// The anonymous event log (#107): what a played game leaves in the store, read back from its files.
const fake = `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 3000) + 1}`;
interface Fixture { roundId: string; candidates: { id: string; label: string }[]; correctCandidateId: string }
const artifact = JSON.parse(readFileSync(resolve(process.cwd(), "apps/game/src/demo/generated/local-real-rounds.json"), "utf8")) as { decks: { fixtures: Fixture[] }[] };
const fixtures = new Map(artifact.decks.flatMap(({ fixtures: deckFixtures }) => deckFixtures.map((fixture) => [fixture.roundId, fixture] as const)));

type StoredEvent = Readonly<Record<string, unknown> & { type: string; game: string }>;
const today = (): string => new Date().toISOString().slice(0, 10);
const storedEvents = (): StoredEvent[] => {
  const path = join(E2E_EVENTS_DIR, `events-${today()}.jsonl`);
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as StoredEvent) : [];
};
/** Events written since `from`, the count before the test; the browser tests run one at a time. */
const eventsSince = (from: number): StoredEvent[] => storedEvents().slice(from);

const answerRound = async (page: Page): Promise<void> => {
  const fixture = fixtures.get((await page.locator(".game-card").getAttribute("data-round-id"))!)!;
  await page.getByLabel(fixture.candidates.find(({ id }) => id === fixture.correctCandidateId)!.label, { exact: true }).check();
  await page.getByRole("button", { name: "Lock in answer" }).click();
  await expect(page.getByRole("heading", { name: "Nice read." })).toBeVisible();
};

test.beforeEach(async ({ request }) => {
  await request.post(`${fake}/control`, { data: {} });
});

test("a played game leaves its events under its sealed arms, with nothing that identifies the player", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // Without Web Share the result goes to the clipboard (#171), whichever browser runs the test.
  await page.addInitScript(() => { delete (Navigator.prototype as { share?: unknown }).share; });
  const from = storedEvents().length;
  await page.goto("/?deck=fix&design=off");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  await page.getByRole("button", { name: "Reveal hint 1" }).click();
  await expect(page.getByRole("button", { name: "Reveal hint 2" })).toBeVisible();
  for (let round = 1; round <= 5; round += 1) {
    await answerRound(page);
    if (round < 5) await page.getByRole("button", { name: "Next round" }).click();
  }
  await page.getByRole("button", { name: "Copy result" }).click();
  await expect(page.locator(".share-status")).toHaveText("Result copied");
  await page.getByRole("link", { name: "Choose another deck" }).click();
  await expect(page.getByRole("heading", { name: "Pick a deck" })).toBeVisible();

  await expect.poll(() => eventsSince(from).some(({ type }) => type === "deal_again")).toBe(true);
  const events = eventsSince(from);
  const game = events.find(({ type }) => type === "game_dealt")!.game;
  const mine = events.filter((event) => event.game === game);
  expect(mine.map(({ type }) => type).sort()).toEqual([
    "deal_again", "game_completed", "game_dealt", "game_viewed", "hint_revealed",
    "result_shared", "round_revealed", "round_revealed", "round_revealed", "round_revealed", "round_revealed",
  ]);
  expect(mine.find(({ type }) => type === "result_shared")).toMatchObject({ via: "clipboard" });
  for (const event of mine) {
    expect(event).toMatchObject({ v: 2, source: "synthetic", origin: "deal", deck: "fix", design: "off", theme: "terminal", layer: "off", day: today() });
  }
  expect(mine.find(({ type }) => type === "game_completed")).toMatchObject({ correct: 5, hints: 1 });
  expect(mine.find(({ type }) => type === "deal_again")).toMatchObject({ to: "chooser" });
  expect(JSON.stringify(mine)).not.toMatch(/127\.0\.0\.1|Mozilla|HeadlessChrome|Nice read/u);

  // The experiment report (#108) reads the same store: every line passes its parser, and this game counts.
  const report = buildReport({ read: readStore(E2E_EVENTS_DIR, "synthetic"), source: "synthetic", to: today(), layerDecks: [] });
  expect(report.refused).toBe(0);
  expect(report.completed).toBeGreaterThan(0);
  expect(report.factors.find(({ factor }) => factor === "design")!.levels[0]!.primary.successes).toBeGreaterThan(0);
});

test("a duel leaves its challenge on the challenger's game and the friend's game as a duel's, with nothing that links them (#173)", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const players = await Promise.all([0, 1].map(async () => {
    const context = await browser.newContext(baseURL ? { baseURL } : {});
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    // Without Web Share every link goes to the clipboard.
    await context.addInitScript(() => { delete (Navigator.prototype as { share?: unknown }).share; });
    return { context, page: await context.newPage() };
  }));
  const [ana, ben] = players.map(({ page }) => page) as [Page, Page];
  const from = storedEvents().length;

  // The challenger buys a hint in the first round, so the friend, who buys none, wins on score.
  await ana.goto("/?deck=fix&design=off");
  for (let round = 1; round <= 5; round += 1) {
    if (round > 1) await ana.getByRole("button", { name: "Next round" }).click();
    if (round === 1) await ana.getByRole("button", { name: "Reveal hint 1" }).click();
    await answerRound(ana);
  }
  await ana.getByRole("button", { name: "Challenge a friend" }).click();
  await ana.getByLabel("Your name (stays in the link)").fill("Ana");
  await ana.getByRole("button", { name: "Copy challenge link" }).click();
  await expect(ana.locator(".duel-share .share-status")).toHaveText("Challenge link copied");
  const link = (await ana.evaluate(() => navigator.clipboard.readText())).split("\n").at(-1)!;

  await ben.goto(link.replace("#", "&play=1#"));
  for (let round = 1; round <= 5; round += 1) {
    if (round > 1) await ben.getByRole("button", { name: "Next round" }).click();
    await answerRound(ben);
  }
  await expect(ben.locator(".duel-comparison").getByRole("heading", { level: 3 })).toHaveText(/^You win by/u);
  await ben.getByLabel("Your name (stays in the link)").fill("Ben");
  await ben.getByRole("button", { name: "Copy result link" }).click();
  await expect(ben.locator(".duel-share .share-status")).toHaveText("Result link copied");
  await ben.getByRole("link", { name: "Rematch" }).click();
  await expect(ben).toHaveURL(/\?deck=fix&deal=[0-9a-f]{8}&game=0$/u);

  await expect.poll(() => eventsSince(from).some(({ type, to }) => type === "deal_again" && to === "rematch")).toBe(true);
  const events = eventsSince(from);
  const dealt = events.filter(({ type }) => type === "game_dealt");
  const challenger = dealt.find(({ origin }) => origin === "deal")!.game;
  const friend = dealt.find(({ origin }) => origin === "duel")!.game;
  const ofGame = (game: string) => events.filter((event) => event.game === game);
  expect(ofGame(challenger).filter(({ type }) => type.startsWith("duel_"))).toMatchObject([
    { type: "duel_created", origin: "deal", firstPlay: "yes" }, { type: "duel_link_copied", origin: "deal", link: "challenge", via: "clipboard" },
  ]);
  const friendEvents = ofGame(friend);
  expect(friendEvents.map(({ type }) => type).sort()).toEqual([
    "deal_again", "duel_completed", "duel_link_copied", "game_completed", "game_dealt", "game_viewed",
    "round_revealed", "round_revealed", "round_revealed", "round_revealed", "round_revealed",
  ]);
  for (const event of friendEvents) expect(event).toMatchObject({ v: 2, origin: "duel", deck: "fix", design: "off", theme: "terminal", layer: "off" });
  expect(friendEvents.find(({ type }) => type === "duel_completed")).toMatchObject({ outcome: "won", decidedBy: "score" });
  expect(friendEvents.find(({ type }) => type === "duel_link_copied")).toMatchObject({ link: "result", via: "clipboard" });
  expect(friendEvents.find(({ type }) => type === "deal_again")).toMatchObject({ to: "rematch" });
  // No event names the challenge, its link, either player, or the other side's game.
  const token = new URL(link).searchParams.get("duel")!;
  const stored = JSON.stringify(events);
  for (const value of [token, token.slice(0, 24), "Ana", "Ben"]) expect(stored).not.toContain(value);
  expect(JSON.stringify(friendEvents)).not.toContain(challenger);

  // The report keeps the friend's game out of every comparison and describes it under Duels.
  const read = readStore(E2E_EVENTS_DIR, "synthetic");
  const report = buildReport({ read, source: "synthetic", to: today(), layerDecks: [] });
  const games = (origin: string) => new Set(read.events.filter((event) => event.origin === origin && event.type === "game_dealt").map(({ game }) => game));
  expect(report.refused).toBe(0);
  expect(report.games).toBe(new Set(read.events.filter(({ origin }) => origin === "deal").map(({ game }) => game)).size);
  expect(report.duels.dealt).toBe(games("duel").size);
  expect(games("duel").has(friend)).toBe(true);
  expect(report.duels.outcomes.won).toBeGreaterThan(0);
  for (const { context } of players) await context.close();
});

test("a generative panel's use and its model call land in the same game", async ({ page }) => {
  const from = storedEvents().length;
  await page.goto("/?deck=language&design=catalog");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  await answerRound(page);
  const panel = page.getByRole("region", { name: "Explainer" });
  await panel.getByRole("button", { name: "Explain this round" }).click();
  await expect(panel.locator(".genui-takeaway")).toBeVisible();

  await expect.poll(() => eventsSince(from).some(({ type }) => type === "genui_call")).toBe(true);
  const events = eventsSince(from);
  const game = events.find(({ type }) => type === "game_dealt")!.game;
  const mine = events.filter((event) => event.game === game);
  expect(mine.find(({ type }) => type === "genui_interaction")).toMatchObject({ round: 1, action: "explain", design: "catalog" });
  expect(mine.find(({ type }) => type === "genui_call")).toMatchObject({ round: 1, phase: "after-lock", ok: true, status: 0, design: "catalog" });
});

test("a browser that sends Sec-GPC: 1 plays a game that records nothing", async ({ page }) => {
  await page.setExtraHTTPHeaders({ "Sec-GPC": "1" });
  const from = storedEvents().length;
  await page.goto("/?deck=project&design=off");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  await answerRound(page);
  await page.getByRole("button", { name: "Next round" }).click();
  await expect(page.getByText("Round 2 of 5")).toBeVisible();
  // Give any stray beacon time to land before checking that none did.
  await page.waitForTimeout(500);
  expect(eventsSince(from)).toEqual([]);
});
