import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Visual themes (#125), each scanned by axe on real pages (#45): a round, a revealed round, and the chooser.
interface Fixture { roundId: string; candidates: { id: string; label: string }[]; correctCandidateId: string }
const artifact = JSON.parse(readFileSync(resolve(process.cwd(), "apps/game/src/demo/generated/local-real-rounds.json"), "utf8")) as { decks: { fixtures: Fixture[] }[] };
const fixtures = new Map(artifact.decks.flatMap(({ fixtures: deckFixtures }) => deckFixtures.map((fixture) => [fixture.roundId, fixture] as const)));

const THEMES = { terminal: "rgb(7, 18, 15)", paper: "rgb(247, 243, 234)", arcade: "rgb(18, 3, 38)", contrast: "rgb(0, 0, 0)" } as const;

/** Every WCAG 2 A and AA rule axe checks, contrast among them. */
const violations = async (page: Page) => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations
  .map(({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.join(" ")).slice(0, 3).join(", ")}`);

for (const [theme, background] of Object.entries(THEMES)) {
  test(`the ${theme} theme colours the whole page and passes axe before and after the answer`, async ({ page }) => {
    await page.goto(`/?deck=fix&design=off&theme=${theme}`);
    await expect(page.getByText("Round 1 of 5")).toBeVisible();
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(background);
    // The lab bar names the theme in play.
    await expect(page.getByRole("navigation", { name: "Themes" }).locator('[aria-current="page"]')).toHaveCount(1);
    await page.getByRole("button", { name: "Reveal hint 1" }).click();
    await expect(page.getByRole("button", { name: "Reveal hint 2" })).toBeVisible();
    expect(await violations(page)).toEqual([]);

    const fixture = fixtures.get((await page.locator(".game-card").getAttribute("data-round-id"))!)!;
    await page.getByLabel(fixture.candidates.find(({ id }) => id !== fixture.correctCandidateId)!.label, { exact: true }).check();
    await page.getByRole("button", { name: "Lock in answer" }).click();
    await expect(page.getByRole("heading", { name: "Not this time." })).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });
}

const fake = `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 3000) + 1}`;

for (const theme of Object.keys(THEMES)) {
  test(`the ${theme} theme's explainer panel passes axe too`, async ({ page, request }) => {
    await request.post(`${fake}/control`, { data: {} });
    await page.goto(`/?deck=language&design=catalog&theme=${theme}`);
    await expect(page.getByText("Round 1 of 5")).toBeVisible();
    const fixture = fixtures.get((await page.locator(".game-card").getAttribute("data-round-id"))!)!;
    await page.getByLabel(fixture.candidates.find(({ id }) => id === fixture.correctCandidateId)!.label, { exact: true }).check();
    await page.getByRole("button", { name: "Lock in answer" }).click();
    const panel = page.getByRole("region", { name: "Explainer" });
    await panel.getByRole("button", { name: "Explain this round" }).click();
    await expect(panel.locator(".genui-takeaway")).toBeVisible();
    expect(await violations(page)).toEqual([]);
  });
}

test("the chooser keeps the original theme for players and takes a lab tester's pick onto every deck", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(THEMES.terminal);
  await page.goto("/?theme=paper");
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(THEMES.paper);
  expect(await violations(page)).toEqual([]);
  await expect(page.locator(".deck-card").first()).toHaveAttribute("href", /&theme=paper$/u);
});
