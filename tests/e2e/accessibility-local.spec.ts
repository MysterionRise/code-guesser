import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 320, height: 568 }, reducedMotion: "reduce" });

const noHorizontalScroll = () => document.documentElement.scrollWidth <= document.documentElement.clientWidth;

test("the deck chooser and every deck fit the minimum viewport", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Pick a deck" })).toBeVisible();
  expect(await page.evaluate(noHorizontalScroll)).toBe(true);
  for (const deck of ["project", "language", "ai"]) {
    await page.goto(`/?deck=${deck}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText("Round 1 of 5")).toBeVisible();
    expect(await page.evaluate(noHorizontalScroll), deck).toBe(true);
  }
});

test("the deck chooser is keyboard operable with named links", async ({ page }) => {
  await page.goto("/");
  const links = page.getByRole("list").getByRole("link");
  await expect(links).toHaveCount(3);
  await page.keyboard.press("Tab");
  await expect(links.first()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(links.nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\?deck=language$/u);
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
