import { expect, test, type Browser } from "@playwright/test";

import { DEAL, finishGame, lockRound } from "../production/game";
import { scan } from "./scan";

// A duel's pages on the production build (#45, #173), at 320 and 1280 px: the challenge being sent, its intro, the
// friend's game with the challenger's rounds beside it, the comparison, and the result. One duel, in the arcade theme,
// which the browser tests' duel checks leave out.

/** A player in a browser context of their own, with a clipboard and no share sheet, so every link is copied. */
const player = async (browser: Browser, baseURL: string | undefined) => {
  const context = await browser.newContext({ ...(baseURL ? { baseURL } : {}), reducedMotion: "reduce" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.addInitScript(() => { delete (Navigator.prototype as { share?: unknown }).share; });
  return { context, page: await context.newPage() };
};

test("every duel page passes axe at 320 and 1280 px", async ({ browser, baseURL }) => {
  const ana = await player(browser, baseURL);
  const ben = await player(browser, baseURL);

  await ana.page.goto(`/?deck=before-after&deal=${DEAL}&game=1&theme=arcade`);
  await expect(ana.page.getByText("Round 1 of 5")).toBeVisible();
  await lockRound(ana.page, false);
  await finishGame(ana.page);
  await ana.page.getByRole("button", { name: "Challenge a friend" }).click();
  await ana.page.getByLabel("Your name (stays in the link)").fill("Ana");
  await ana.page.getByRole("button", { name: "Copy challenge link" }).click();
  await expect(ana.page.locator(".duel-share .share-status")).toHaveText("Challenge link copied");
  await scan(ana.page, "a challenge sent");
  const challenge = (await ana.page.evaluate(() => navigator.clipboard.readText())).split("\n").at(-1)!;

  await ben.page.goto(challenge);
  await expect(ben.page.getByRole("heading", { level: 1 })).toHaveText("Ana challenges you");
  await scan(ben.page, "the challenge's intro");
  await ben.page.getByRole("link", { name: "Play the same five" }).click();
  await expect(ben.page.getByText("Round 1 of 5")).toBeVisible();
  await lockRound(ben.page);
  await expect(ben.page.locator(".reveal .duel-line")).toBeVisible();
  await scan(ben.page, "the friend's game");
  await finishGame(ben.page);
  await expect(ben.page.locator(".duel-comparison")).toBeVisible();
  await ben.page.getByLabel("Your name (stays in the link)").fill("Ben");
  await ben.page.getByRole("button", { name: "Copy result link" }).click();
  await expect(ben.page.locator(".duel-share .share-status")).toHaveText("Result link copied");
  await scan(ben.page, "the comparison");
  const result = (await ben.page.evaluate(() => navigator.clipboard.readText())).split("\n").at(-1)!;

  // The result sits outside any game, so a lab tester picks its theme.
  await ana.page.goto(result.replace("#", "&theme=arcade#"));
  await expect(ana.page.getByRole("heading", { level: 1 })).toHaveText("Ben vs Ana");
  await scan(ana.page, "the result");
  await ana.context.close();
  await ben.context.close();
});
