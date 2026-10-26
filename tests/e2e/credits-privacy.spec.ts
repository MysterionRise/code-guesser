import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Credits and privacy (#99): both pages in every theme pass axe and fit a phone, and every page's footer leads to them.
const THEMES = { terminal: "rgb(7, 18, 15)", paper: "rgb(247, 243, 234)", arcade: "rgb(18, 3, 38)", contrast: "rgb(0, 0, 0)" } as const;
const PAGES = { credits: "Credits", privacy: "Privacy" } as const;

/** Every WCAG 2 A and AA rule axe checks, contrast among them. */
const violations = async (page: Page) => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations
  .map(({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.join(" ")).slice(0, 3).join(", ")}`);
const noHorizontalScroll = () => document.documentElement.scrollWidth <= document.documentElement.clientWidth;
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

for (const [path, title] of Object.entries(PAGES)) {
  for (const [theme, colour] of Object.entries(THEMES)) {
    test(`the ${path} page passes axe in the ${theme} theme, and fits 320 px`, async ({ page }) => {
      // Outside any game the page keeps the original theme; a lab tester's pick shows it in another.
      await page.goto(`/${path}${theme === "terminal" ? "" : `?theme=${theme}`}`);
      await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
      await expect.poll(() => background(page)).toBe(colour);
      expect(await violations(page)).toEqual([]);
      await page.setViewportSize({ width: 320, height: 640 });
      expect(await page.evaluate(noHorizontalScroll)).toBe(true);
      expect(await violations(page)).toEqual([]);
    });
  }
}

test("every page's footer links the credits and the privacy page, and each says what it lists", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  for (const address of ["/", "/?deck=fix&design=off"]) {
    await page.goto(address);
    const footer = page.getByRole("contentinfo").getByRole("navigation", { name: "About CodeGuessr" });
    await expect(footer.getByRole("link")).toHaveText(["Credits", "Privacy"]);
    expect(await page.evaluate(noHorizontalScroll)).toBe(true);
  }
  await page.getByRole("contentinfo").getByRole("link", { name: "Credits" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Credits" })).toBeVisible();
  // Every licence links its text, and every repository its own licence file.
  await expect(page.getByRole("navigation", { name: "Licences" }).getByRole("link")).toHaveCount(await page.locator(".credit-license").count());
  expect(await page.locator(".credit-repository").count()).toBe(await page.locator(".credit-license-files").count());
  await page.getByRole("contentinfo").getByRole("link", { name: "Privacy" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Privacy" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 3, name: "duel_completed" })).toBeVisible();
  // The page reads no game: nothing on it names a round.
  expect(await page.content()).not.toMatch(/local-[a-z-]+-[0-9a-f]{8,}/u);
});
