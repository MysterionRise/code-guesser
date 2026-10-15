import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { E2E_EVENTS_DIR } from "../../playwright.config";

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
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  await page.getByRole("link", { name: "Choose another deck" }).click();
  await expect(page.getByRole("heading", { name: "Pick a deck" })).toBeVisible();

  await expect.poll(() => eventsSince(from).some(({ type }) => type === "deal_again")).toBe(true);
  const events = eventsSince(from);
  const game = events.find(({ type }) => type === "game_dealt")!.game;
  const mine = events.filter((event) => event.game === game);
  expect(mine.map(({ type }) => type).sort()).toEqual([
    "deal_again", "game_completed", "game_dealt", "game_viewed", "hint_revealed",
    "result_copied", "round_revealed", "round_revealed", "round_revealed", "round_revealed", "round_revealed",
  ]);
  for (const event of mine) {
    expect(event).toMatchObject({ v: 1, source: "synthetic", deck: "fix", design: "off", theme: "terminal", layer: "off", day: today() });
  }
  expect(mine.find(({ type }) => type === "game_completed")).toMatchObject({ correct: 5, hints: 1 });
  expect(mine.find(({ type }) => type === "deal_again")).toMatchObject({ to: "chooser" });
  expect(JSON.stringify(mine)).not.toMatch(/127\.0\.0\.1|Mozilla|HeadlessChrome|Nice read/u);
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
