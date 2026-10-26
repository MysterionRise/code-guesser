import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The public pages (#168): About, the not-found page, an unknown deck's note (#70), robots.txt, and the icon.
const artifact = JSON.parse(readFileSync(resolve(process.cwd(), "apps/game/src/demo/generated/local-real-rounds.json"), "utf8")) as
  { decks: { id: string; title: string; description: string }[] };

/** Each theme's page background, as `themes.spec.ts` checks it. */
const THEMES = { terminal: "rgb(7, 18, 15)", paper: "rgb(247, 243, 234)", arcade: "rgb(18, 3, 38)", contrast: "rgb(0, 0, 0)" } as const;

/** Every WCAG 2 A and AA rule axe checks, contrast among them. */
const violations = async (page: Page) => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations
  .map(({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.join(" ")).slice(0, 3).join(", ")}`);
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

for (const [theme, colour] of Object.entries(THEMES)) {
  test(`About and the not-found page pass axe in the ${theme} theme`, async ({ page }) => {
    // About takes a lab tester's theme, as the chooser does.
    await page.goto(`/about?theme=${theme}`);
    await expect(page.getByRole("heading", { level: 1, name: "About CodeGuessr" })).toBeVisible();
    await expect.poll(() => background(page)).toBe(colour);
    expect(await violations(page)).toEqual([]);

    // A missing page's address names no theme, so the test sets each one on the page's wrapper, as a game's page does.
    expect((await page.goto("/no-such-page"))?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "There’s nothing here" })).toBeVisible();
    await page.locator(".demo-page").evaluate((element, name) => element.setAttribute("data-theme", name), theme);
    await expect.poll(() => background(page)).toBe(colour);
    expect(await violations(page)).toEqual([]);
  });
}

test("About is linked from the notice, explains the game, and lists every deck, each leading to its game", async ({ page }) => {
  await page.goto("/");
  await page.locator(".demo-notice").getByRole("link", { name: "About" }).click();
  await expect(page).toHaveURL(/\/about$/u);
  await expect(page).toHaveTitle("About · CodeGuessr");
  await expect(page.getByRole("heading", { level: 2 }))
    .toHaveText(["How to play", "Keys", "The decks", "Duels", "Where the code comes from", "The experiment"]);
  const decks = page.locator(".about-decks");
  await expect(decks.locator("dt")).toHaveText(["Today’s five", "Mixed", ...artifact.decks.map(({ title }) => title)]);
  for (const { description } of artifact.decks) await expect(decks).toContainText(description);
  const [first] = artifact.decks;
  await decks.getByRole("link", { name: first!.title }).click();
  await expect(page).toHaveURL(new RegExp(`\\?deck=${first!.id}&deal=[0-9a-f]{8}&game=0$`, "u"));
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
});

test("an address the game doesn't serve gets a 404 page, kept out of search, with the way back to the decks", async ({ page }) => {
  const response = await page.goto("/no-such-page");
  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle("Page not found · CodeGuessr");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
  await page.getByRole("link", { name: "Back to the decks" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Pick a deck" })).toBeVisible();
});

test("a deck this artifact doesn't hold shows the chooser under a note that it isn't available", async ({ page }) => {
  for (const deck of ["vulnerable-line", "no-such-deck"]) {
    await page.goto(`/?deck=${deck}`);
    const note = page.locator(".deck-notice");
    await expect(note).toHaveText("That deck isn’t available. Pick another one below.");
    const heading = page.getByRole("heading", { level: 1, name: "Pick a deck" });
    await expect(heading).toBeVisible();
    expect((await note.boundingBox())!.y).toBeLessThan((await heading.boundingBox())!.y);
    await expect(page.locator(".deck-card")).toHaveCount(artifact.decks.length + 2);
    expect(await violations(page)).toEqual([]);
  }
  await page.goto("/");
  await expect(page.locator(".deck-notice")).toHaveCount(0);
});

test("robots.txt keeps crawlers off deals and duels, and every page names the monogram icon", async ({ page, request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect((await robots.text()).trim().split("\n")).toEqual(["User-Agent: *", "Allow: /", "Allow: /about", "Disallow: /*?deck=", "Disallow: /*?duel"]);
  for (const path of ["/", "/about", "/no-such-page"]) {
    await page.goto(path);
    const href = await page.locator('link[rel="icon"]').getAttribute("href");
    expect(href, path).toMatch(/^\/icon\.svg\b/u);
    const icon = await request.get(href!);
    expect(icon.status()).toBe(200);
    expect(icon.headers()["content-type"]).toMatch(/^image\/svg\+xml/u);
  }
});
