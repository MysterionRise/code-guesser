import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { E2E_EVENTS_DIR } from "../../playwright.config";

// Today's five on the player's own date (#172): each time zone deals its own date, a bare address has the browser add
// the date and deals nothing itself, a date the server won't deal is refused, and playing again records nothing.
interface Fixture { roundId: string; candidates: { id: string; label: string }[]; correctCandidateId: string }
const artifact = JSON.parse(readFileSync(resolve(process.cwd(), "apps/game/src/demo/generated/local-real-rounds.json"), "utf8")) as
  { decks: { fixtures: Fixture[] }[] };
const answers = new Map(artifact.decks.flatMap(({ fixtures }) => fixtures.map((fixture) =>
  [fixture.roundId, fixture.candidates.find(({ id }) => id === fixture.correctCandidateId)!.label] as const)));

/** A date as a time zone names it now, `YYYY-MM-DD`. */
const zoneDate = (zone: string): string => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(new Date());
const utcDate = (offsetDays = 0): string => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);
const dealtGames = (): number => {
  const path = join(E2E_EVENTS_DIR, `events-${utcDate()}.jsonl`);
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter((line) => line.includes('"type":"game_dealt"')).length : 0;
};
const violations = async (page: Page) => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations
  .map(({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.join(" ")).join(", ")}`);
/** The first round as dealt: its id and its options in order. */
const firstRound = async (page: Page) => {
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  return { round: await page.locator(".game-card").getAttribute("data-round-id"), options: await page.locator(".candidate").allTextContents() };
};

// Kiritimati is UTC+14 and Etc/GMT+12 is UTC−12, so the two always name different dates, each within a day of UTC's.
for (const zone of ["Pacific/Kiritimati", "Etc/GMT+12"]) {
  test.describe(`in ${zone}`, () => {
    test.use({ timezoneId: zone });

    test("the chooser and a bare address deal the zone's own date, the same five each time", async ({ page }) => {
      const date = zoneDate(zone);
      await page.goto("/");
      const card = page.getByRole("link", { name: /^Today’s five/u });
      await expect(card).toContainText(date);
      await expect(card).toHaveAttribute("href", `/?deck=daily&date=${date}`);
      await card.click();
      await expect(page).toHaveURL(new RegExp(`\\?deck=daily&date=${date}$`, "u"));
      const dealt = await firstRound(page);
      // A bare address renders no game: the browser replaces it with its date's, so Back skips it.
      await page.goto("/");
      await page.goto("/?deck=daily");
      await expect(page).toHaveURL(new RegExp(`\\?deck=daily&date=${date}$`, "u"));
      expect(await firstRound(page)).toEqual(dealt);
      await page.goBack();
      await expect(page.getByRole("heading", { level: 1, name: "Pick a deck" })).toBeVisible();
    });
  });
}

test("a link deals its own date's five wherever it's opened", async ({ browser }) => {
  const games = await Promise.all(["Pacific/Kiritimati", "Etc/GMT+12"].map(async (zone) => {
    const context = await browser.newContext({ timezoneId: zone });
    const page = await context.newPage();
    await page.goto("/?deck=daily");
    await expect(page).toHaveURL(new RegExp(`date=${zoneDate(zone)}$`, "u"));
    return { context, page, date: zoneDate(zone), dealt: await firstRound(page) };
  }));
  expect(games[0]!.date).not.toBe(games[1]!.date);
  // Each zone opens the other's link and is dealt the other's game, not its own date's.
  for (const [index, { page }] of games.entries()) {
    const other = games[1 - index]!;
    await page.goto(`/?deck=daily&date=${other.date}`);
    expect(await firstRound(page)).toEqual(other.dealt);
  }
  await Promise.all(games.map(({ context }) => context.close()));
});

test("a date the server won't deal is refused, deals nothing, and passes axe", async ({ page }) => {
  const before = dealtGames();
  for (const date of ["2000-01-01", utcDate(2), utcDate(-2), "2026-02-30", "today"]) {
    await page.goto(`/?deck=daily&date=${date}`);
    await expect(page.getByRole("heading", { level: 1, name: "That day’s five isn’t open" }), date).toBeVisible();
    await expect(page.getByText("Round 1 of 5")).toHaveCount(0);
  }
  expect(await violations(page)).toEqual([]);
  expect(dealtGames()).toBe(before);
  // Its way on is today's five, on the browser's date.
  await page.getByRole("link", { name: "Play today’s five" }).click();
  await expect(page).toHaveURL(/\?deck=daily&date=\d{4}-\d{2}-\d{2}$/u);
  await firstRound(page);
  expect(dealtGames()).toBe(before + 1);
});

test("a bare address deals nothing without JavaScript, under the notice that the game needs it", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const before = dealtGames();
  await page.goto("/?deck=daily");
  await expect(page.getByRole("heading", { level: 1, name: "Dealing today’s five…" })).toBeVisible();
  expect(await page.locator("body").innerText()).toContain("CodeGuessr needs JavaScript to accept answers and reveal progressive evidence.");
  await expect(page).toHaveURL(/\?deck=daily$/u);
  expect(dealtGames()).toBe(before);
  await context.close();
});

test("once today's five is done, playing it again deals the same five and records nothing", async ({ page }) => {
  await page.goto("/?deck=daily");
  await expect(page).toHaveURL(/date=\d{4}-\d{2}-\d{2}$/u);
  const date = new URL(page.url()).searchParams.get("date")!;
  const dealt = await firstRound(page);
  for (let round = 1; round <= 5; round += 1) {
    if (round > 1) await page.getByRole("button", { name: "Next round" }).click();
    await expect(page.getByText(`Round ${round} of 5`)).toBeVisible();
    await page.getByLabel(answers.get((await page.locator(".game-card").getAttribute("data-round-id"))!)!, { exact: true }).check();
    await page.getByRole("button", { name: "Lock in answer" }).click();
    await expect(page.getByRole("heading", { name: "Nice read." })).toBeVisible();
  }
  await expect(page.getByRole("link", { name: "Deal new rounds" })).toHaveAttribute("href", "/?deck=mixed");
  const again = page.getByRole("link", { name: "Play again" });
  await expect(again).toHaveAttribute("href", `/?deck=daily&date=${date}&replay=1`);
  const before = dealtGames();
  await again.click();
  await expect(page).toHaveURL(new RegExp(`\\?deck=daily&date=${date}&replay=1$`, "u"));
  expect(await firstRound(page)).toEqual(dealt);
  expect(dealtGames()).toBe(before);
});
