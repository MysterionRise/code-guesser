import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const deckIds = (JSON.parse(readFileSync(resolve(process.cwd(), "apps/game/src/demo/generated/local-real-rounds.json"), "utf8")) as
  { decks: { id: string }[] }).decks.map(({ id }) => id);

// reducedMotion is a browser-context option, not a Playwright test option, so it goes under contextOptions.
test.use({ viewport: { width: 320, height: 568 }, contextOptions: { reducedMotion: "reduce" } });

const noHorizontalScroll = () => document.documentElement.scrollWidth <= document.documentElement.clientWidth;
const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

test("the deck chooser and every deck fit the minimum viewport", async ({ page }) => {
  await page.goto("/");
  expect(await page.evaluate(prefersReducedMotion)).toBe(true);
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Pick a deck" })).toBeVisible();
  expect(await page.evaluate(noHorizontalScroll)).toBe(true);
  for (const deck of deckIds) {
    await page.goto(`/?deck=${deck}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Round 1 of 5")).toBeVisible();
    expect(await page.evaluate(noHorizontalScroll), deck).toBe(true);
  }
});

test("the permanent notice names every round source and wraps to at most five lines", async ({ page }) => {
  const lines = (element: HTMLElement) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  };
  for (const path of ["/", `/?deck=${deckIds[0]}`]) {
    await page.goto(path);
    const notice = page.locator(".demo-notice");
    await expect(notice).toContainText(/^Local unreviewed experiment\./u);
    for (const source of ["The Stack v2", "GitHub", "TheAlgorithms", "Defects4J", "BugsInPy", "localhost", "Not approved beta content"]) {
      await expect(notice).toContainText(source);
    }
    expect(await notice.evaluate(lines), path).toBeLessThanOrEqual(5);
  }
});

test("the deck chooser is keyboard operable with named links", async ({ page }) => {
  await page.goto("/");
  expect(await page.evaluate(prefersReducedMotion)).toBe(true);
  const links = page.getByRole("list").getByRole("link");
  await expect(links).toHaveCount(deckIds.length);
  await page.keyboard.press("Tab");
  await expect(links.first()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(links.nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`\\?deck=${deckIds[1]}$`, "u"));
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
});

test("no JavaScript exposes explanation only and no partial game controls", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 568 } });
  const page = await context.newPage();
  for (const path of ["/", "/?deck=project"]) {
    await page.goto(path);
    expect(await page.locator("body").innerText()).toContain("CodeGuessr needs JavaScript to accept answers and reveal progressive evidence.");
    await expect(page.getByRole("radio")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /answer/i })).toHaveCount(0);
  }
  await context.close();
});
