import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 320, height: 568 } });

test("records local Chromium provenance observations without promoting them to support evidence", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?deck=ai");
  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const motion = await page.evaluate(() => ({
    reduce: matchMedia("(prefers-reduced-motion: reduce)").matches,
    noPreference: matchMedia("(prefers-reduced-motion: no-preference)").matches,
    animations: document.getAnimations().map((animation) => {
      const effect = animation.effect;
      const target = effect instanceof KeyframeEffect && effect.target instanceof Element ? effect.target : null;
      return { animationName: animation.animationName, target: target?.tagName ?? null, className: target?.className ?? null };
    }),
  }));
  expect(motion.reduce).toBe(true);
  expect(motion.noPreference).toBe(false);
  expect(motion.animations, JSON.stringify(motion)).toEqual([]);

  const main = page.getByRole("main");
  const observed = {
    evidenceKind: "LOCAL_AUTOMATED",
    browser: "bundled Chromium",
    visibleDemoAnswerControls: await main.getByRole("radio").count() > 0,
    correctionFlow: await main.getByRole("status").count() > 0,
    errorFlow: await main.getByRole("alert").count() > 0,
  } as const;
  expect(observed).toEqual({
    evidenceKind: "LOCAL_AUTOMATED",
    browser: "bundled Chromium",
    visibleDemoAnswerControls: true,
    correctionFlow: false,
    errorFlow: false,
  });
});

test("no JavaScript exposes only the accessible explanation and no partial provenance controls", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 568 } });
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:3000/");
  expect(await page.locator("body").innerText()).toContain("CodeGuessr needs JavaScript to accept answers and reveal progressive evidence.");
  await expect(page.getByRole("radio")).toHaveCount(0);
  await expect(page.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await context.close();
});
