import { expect, test } from "@playwright/test";

import { finishGame, lockRound } from "../production/game";

// The game's network on the production build with generative UI off (#66, #70): from the chooser through a whole game
// to its next deal, its challenge link, and the pages its footer links, the browser requests nothing from any origin
// but the game's own. The policy (#97) would refuse such a request; this check sees that none is even made.
test("a whole game, its challenge, and the footer's pages request nothing from another origin", async ({ context, page, baseURL }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.addInitScript(() => { delete (Navigator.prototype as { share?: unknown }).share; });
  const origin = new URL(baseURL!).origin;
  const requested: string[] = [];
  page.on("request", (request) => { requested.push(request.url()); });
  page.on("websocket", (socket) => { requested.push(socket.url()); });

  await page.goto("/");
  await page.getByRole("link", { name: /^Mixed/u }).click();
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  await page.getByRole("button", { name: "Reveal hint 1" }).click();
  await expect(page.locator(".hints .hint")).toHaveCount(1);
  await lockRound(page);
  await finishGame(page);
  await expect(page.getByText(/Run complete — /u)).toBeVisible();
  await page.getByRole("button", { name: "Challenge a friend" }).click();
  await page.getByRole("button", { name: "Copy challenge link" }).click();
  await expect(page.locator(".duel-share .share-status")).toHaveText("Challenge link copied");
  await page.getByRole("link", { name: "Deal new rounds" }).click();
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  for (const [name, heading] of [["About", "About CodeGuessr"], ["Credits", "Credits"], ["Privacy", "Privacy"]] as const) {
    await page.getByRole("contentinfo").getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
  }
  await page.waitForLoadState("networkidle");

  // Pages, scripts, styles, the icon, server actions, and the event beacon, all from the game's own origin.
  expect(requested.length).toBeGreaterThan(20);
  expect(requested.filter((url) => !url.startsWith("data:") && new URL(url).origin !== origin)).toEqual([]);
});
