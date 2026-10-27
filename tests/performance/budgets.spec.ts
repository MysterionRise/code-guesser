import { expect, test, type Browser, type Page } from "@playwright/test";

import { DEAL, SOURCES, utcDate } from "../production/game";

// Budgets for the production build (#45), each a first visit in a fresh browser context, so nothing comes from cache.
// When they were set (2026-10-26, Node 24 and Chromium on an Apple laptop) the chooser transferred 111,778 bytes of
// script and a game 122,632, its lazily loaded shell included; "Round 1 of 5" showed about 300 ms after a deck's
// address was opened, its redirect to a fresh deal included. The byte budgets leave about a tenth of headroom for
// growth, and the time budget leaves CI runners half again as long.
const BUDGETS = {
  /** Script bytes the chooser transfers, compressed as `next start` sends them. */
  chooserScript: 125_000,
  /** Script bytes a game transfers, the arcade shell's lazy chunk included. */
  gameScript: 135_000,
  /** From opening a deck's address to "Round 1 of 5" on screen, the median of three visits. */
  roundOneMs: process.env.CI ? 1_500 : 1_000,
} as const;

/** The script bytes a first visit transfers, once the page has loaded and gone quiet. */
const scriptBytes = async (page: Page, address: string, ready: () => Promise<void>): Promise<number> => {
  const sizes: Promise<number>[] = [];
  page.on("requestfinished", (request) => {
    if (request.resourceType() === "script") sizes.push(request.sizes().then(({ responseBodySize }) => responseBodySize));
  });
  await page.goto(address);
  await ready();
  await page.waitForLoadState("networkidle");
  return (await Promise.all(sizes)).reduce((sum, size) => sum + size, 0);
};

/** Notes a measurement in the report and the log, so CI shows how close each run comes to its budget. */
const measured = (name: string, value: number, budget: number): void => {
  test.info().annotations.push({ type: "measured", description: `${name}: ${value} (budget ${budget})` });
  console.log(`${name}: ${value} (budget ${budget})`);
};

test("the chooser's first load transfers no more script than its budget", async ({ page }) => {
  const bytes = await scriptBytes(page, "/", () => expect(page.getByRole("heading", { level: 1, name: "Pick a deck" })).toBeVisible());
  measured("chooser script bytes", bytes, BUDGETS.chooserScript);
  expect(bytes).toBeGreaterThan(0);
  expect(bytes).toBeLessThanOrEqual(BUDGETS.chooserScript);
});

test("a game's first load, its shell included, transfers no more script than its budget", async ({ page }) => {
  const bytes = await scriptBytes(page, `/?deck=project&deal=${DEAL}&game=0`, () => expect(page.getByText("Round 1 of 5")).toBeVisible());
  measured("game script bytes", bytes, BUDGETS.gameScript);
  expect(bytes).toBeLessThanOrEqual(BUDGETS.gameScript);
});

/** Milliseconds from the start of the navigation to "Round 1 of 5" in the page, in a fresh context. */
const roundOneMs = async (browser: Browser, baseURL: string, address: string): Promise<number> => {
  const context = await browser.newContext({ baseURL });
  try {
    const page = await context.newPage();
    // The game's shell renders in the browser; the page notes the moment its first round's counter appears.
    await page.addInitScript(() => {
      const observer = new MutationObserver(() => {
        if (!document.querySelector(".game-card .eyebrow")?.textContent?.startsWith("Round 1 of 5")) return;
        (window as unknown as { roundOneAt: number }).roundOneAt = performance.now();
        observer.disconnect();
      });
      observer.observe(document, { childList: true, subtree: true, characterData: true });
    });
    await page.goto(address);
    await expect(page.getByText("Round 1 of 5")).toBeVisible();
    return Math.round(await page.evaluate(() => (window as unknown as { roundOneAt: number }).roundOneAt));
  } finally {
    await context.close();
  }
};

for (const source of SOURCES) {
  test(`the ${source} game shows "Round 1 of 5" within its budget`, async ({ browser, baseURL, request }) => {
    // A deck's address redirects to a fresh deal, as the chooser's card does; today's five's card names its date.
    const address = source === "daily" ? `/?deck=daily&date=${utcDate()}` : `/?deck=${source}`;
    // The server loads each route's code on its first request, once; the budget is for every visit after it.
    expect((await request.get(address)).status()).toBe(200);
    const times: number[] = [];
    for (let visit = 0; visit < 3; visit += 1) times.push(await roundOneMs(browser, baseURL!, address));
    const median = [...times].sort((left, right) => left - right)[1]!;
    measured(`${source} round 1 ms (${times.join(", ")})`, median, BUDGETS.roundOneMs);
    expect(median).toBeLessThanOrEqual(BUDGETS.roundOneMs);
  });
}
