import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 320, height: 568 } });

test("records local Chromium language observations without promoting them to support evidence", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?deck=language");
  const main = page.getByRole("main");
  await expect(main).toBeVisible();
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect({
    evidenceKind: "LOCAL_AUTOMATED",
    visibleDemoAnswerControls: await main.getByRole("radio").count() > 0,
    controlAnnotation: await main.getByText(/bidirectional|zero-width/i).count() > 0,
    correctionFlow: await main.getByRole("status").count() > 0,
    errorFlow: await main.getByRole("alert").count() > 0,
  }).toEqual({ evidenceKind: "LOCAL_AUTOMATED", visibleDemoAnswerControls: true, controlAnnotation: false, correctionFlow: false, errorFlow: false });
});

test("no JavaScript exposes only the static explanation and no partial language controls", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 568 } });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:3000/");
  expect(await page.locator("body").innerText()).toContain("CodeGuessr needs JavaScript to accept answers and reveal progressive evidence.");
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByRole("button")).toHaveCount(0);
  await context.close();
});
