import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 320, height: 568 } });

test("records the local Chromium privacy-flow limitation without promoting it to support evidence", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  const main = page.getByRole("main");
  await expect(main).toBeVisible();
  expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect({
    evidenceKind: "LOCAL_AUTOMATED",
    enrollmentCredential: await main.getByRole("textbox").count() > 0,
    consentControl: await main.getByRole("checkbox").count() > 0,
    withdrawalControl: await main.getByRole("button", { name: /withdraw/i }).count() > 0,
    correctionNotice: await main.getByRole("status").count() > 0,
    deletionStatus: await main.getByText(/deletion status/i).count() > 0,
    errorFlow: await main.getByRole("alert").count() > 0,
  }).toEqual({ evidenceKind: "LOCAL_AUTOMATED", enrollmentCredential: false, consentControl: false, withdrawalControl: false, correctionNotice: false, deletionStatus: false, errorFlow: false });
});

test("no JavaScript exposes only the static explanation and no partial privacy controls", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 568 } });
  const page = await context.newPage();
  await page.goto("/");
  expect(await page.locator("body").innerText()).toContain("CodeGuessr needs JavaScript to accept answers and reveal progressive evidence.");
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText(/deletion status/i)).toHaveCount(0);
  await context.close();
});
