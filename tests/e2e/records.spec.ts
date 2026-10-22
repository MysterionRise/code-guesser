import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Personal records (#63): a finished game's best and streak on the chooser, today's five's day streak, clearing them,
// and play that goes on where the browser refuses storage. Nothing here leaves the browser.
interface Fixture { roundId: string; candidates: { id: string; label: string }[]; correctCandidateId: string }
const artifact = JSON.parse(readFileSync(resolve(process.cwd(), "apps/game/src/demo/generated/local-real-rounds.json"), "utf8")) as
  { decks: { fixtures: Fixture[] }[] };
const fixtures = new Map(artifact.decks.flatMap(({ fixtures: deckFixtures }) => deckFixtures.map((fixture) => [fixture.roundId, fixture] as const)));
/** The round set records are kept under: the start of the pinned artifact hash. */
const ROUND_SET = /"([0-9a-f]{64})"/u.exec(readFileSync(resolve(process.cwd(), "apps/game/src/demo/local-real-experiment.pin.server.ts"), "utf8"))![1]!.slice(0, 16);
const points = (value: number): string => value.toLocaleString("en-US");
const violations = async (page: Page) => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations
  .map(({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.join(" ")).join(", ")}`);

/** Plays the game on screen, the first `right` rounds right and the rest missed; returns its score. */
const finishGame = async (page: Page, right: number): Promise<number> => {
  for (let round = 1; round <= 5; round += 1) {
    if (round > 1) await page.getByRole("button", { name: "Next round" }).click();
    await expect(page.getByText(`Round ${round} of 5`)).toBeVisible();
    const fixture = fixtures.get((await page.locator(".game-card").getAttribute("data-round-id"))!)!;
    const pick = fixture.candidates.find(({ id }) => (id === fixture.correctCandidateId) === (round <= right))!;
    await page.getByLabel(pick.label, { exact: true }).check();
    await page.getByRole("button", { name: "Lock in answer" }).click();
    await expect(page.getByRole("heading", { name: round <= right ? "Nice read." : "Not this time." })).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Your game" })).toBeVisible();
  return Number((await page.locator(".arcade-header .score").textContent())!.replace(/\D/gu, ""));
};
const playGame = async (page: Page, path: string, right: number): Promise<number> => {
  await page.goto(path);
  return finishGame(page, right);
};
const card = (page: Page, title: RegExp) => page.locator(".deck-card").filter({ has: page.locator(".deck-title", { hasText: title }) });

test("a finished game's score shows on its deck's card, a new best replaces it, and both survive a reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".deck-record")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear records" })).toHaveCount(0);
  const first = await playGame(page, "/?deck=language&design=off", 2);
  await page.goto("/");
  const language = card(page, /^Which language\?$/u);
  await expect(language.locator(".deck-record")).toHaveText(`Best ${points(first)}`);
  // Three or more right starts a streak, and a better score is the new best.
  const second = await playGame(page, "/?deck=language&design=off", 5);
  expect(second).toBeGreaterThan(first);
  await page.goto("/");
  await expect(language.locator(".deck-record")).toHaveText(`Best ${points(second)} · streak 1`);
  await expect(language).toHaveAccessibleName(new RegExp(`Best ${points(second)} · streak 1$`, "u"));
  await page.reload();
  await expect(language.locator(".deck-record")).toHaveText(`Best ${points(second)} · streak 1`);
  // Only the deck played has a record.
  await expect(page.locator(".deck-record")).toHaveCount(1);
  expect(await violations(page)).toEqual([]);
});

test("today's five keeps a day streak on its card", async ({ page }) => {
  await playGame(page, "/?deck=daily&design=off", 3);
  await page.goto("/");
  await expect(card(page, /^Today’s five$/u).locator(".deck-record")).toHaveText("Day streak 1");
  // Playing it again the same day counts for nothing.
  await playGame(page, "/?deck=daily&design=off", 5);
  await page.goto("/");
  await expect(card(page, /^Today’s five$/u).locator(".deck-record")).toHaveText("Day streak 1");
});

test("Clear records asks first, inline, keeps focus, and forgets every record", async ({ page }) => {
  await playGame(page, "/?deck=fix&design=off", 4);
  await page.goto("/");
  await expect(page.locator(".deck-record")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear records" }).click();
  await expect(page.getByText("Clear every best and streak kept in this browser?")).toBeVisible();
  await expect(page.getByRole("button", { name: "Keep them" })).toBeFocused();
  expect(await violations(page)).toEqual([]);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Clear records" })).toBeFocused();
  await expect(page.locator(".deck-record")).toHaveCount(1);
  await page.getByRole("button", { name: "Clear records" }).click();
  await page.getByRole("button", { name: "Clear them" }).click();
  await expect(page.getByRole("status")).toHaveText("Records cleared.");
  await expect(page.getByRole("status")).toBeFocused();
  await expect(page.locator(".deck-record")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("codeguessr.records"))).toBeNull();
  await page.reload();
  await expect(page.locator(".deck-record")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Clear records" })).toHaveCount(0);
});

test("a friend's game of a challenge joins the friend's records for its deck (#173)", async ({ browser, baseURL }) => {
  const player = async () => {
    const context = await browser.newContext({ ...(baseURL ? { baseURL } : {}) });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await context.addInitScript(() => { delete (Navigator.prototype as { share?: unknown }).share; });
    return { context, page: await context.newPage() };
  };
  const challenger = await player();
  await playGame(challenger.page, "/?deck=fix&design=off", 4);
  await challenger.page.getByRole("button", { name: "Challenge a friend" }).click();
  await challenger.page.getByRole("button", { name: "Copy challenge link" }).click();
  await expect(challenger.page.locator(".duel-share .share-status")).toHaveText("Challenge link copied");
  const link = (await challenger.page.evaluate(() => navigator.clipboard.readText())).split("\n").at(-1)!;
  const friend = await player();
  await friend.page.goto(link);
  await friend.page.getByRole("link", { name: "Play the same five" }).click();
  const score = await finishGame(friend.page, 5);
  await friend.page.goto("/");
  await expect(card(friend.page, /^Spot the fix$/u).locator(".deck-record")).toHaveText(`Best ${points(score)} · streak 1`);
  await Promise.all([challenger.context.close(), friend.context.close()]);
});

test("records kept on another round set don't show, and corrupt ones read as none", async ({ page }) => {
  const kept = (round: string) => JSON.stringify({ v: 1, artifact: round, decks: { fix: { best: 4000, played: 2, streak: 2, bestStreak: 2 } }, daily: null });
  for (const [stored, shown] of [[kept(ROUND_SET), 1], [kept("0000000000000000"), 0], ["{not json", 0], [kept(ROUND_SET).replace("\"v\":1", "\"v\":2"), 0]] as const) {
    await page.goto("/");
    await page.evaluate((value) => localStorage.setItem("codeguessr.records", value), stored);
    await page.reload();
    await expect(card(page, /^Spot the fix$/u).locator(".deck-record"), stored).toHaveCount(shown);
  }
  await expect(card(page, /^Spot the fix$/u)).not.toContainText("Best");
});

test("a browser that refuses storage still plays a whole game and shows the chooser", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    for (const method of ["getItem", "setItem", "removeItem"] as const) {
      Object.defineProperty(Storage.prototype, method, { configurable: true, value: () => { throw new DOMException("refused", "SecurityError"); } });
    }
  });
  await playGame(page, "/?deck=fix&design=off", 5);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Pick a deck" })).toBeVisible();
  await expect(page.locator(".deck-record")).toHaveCount(0);
  expect(errors).toEqual([]);
});
