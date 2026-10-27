import { expect, test } from "@playwright/test";

import { SOURCES, finishGame, gameAddress, lockRound } from "../production/game";
import { scan } from "./scan";

// Every deck, the mix, and today's five on the production build (#45), each at round 1, after a hint, after a reveal,
// and at the end of the game, at 320 and 1280 px.
//
// Each source plays one game of a fixed deal: a hint and a missed answer in round 1, then four right answers. A
// deck's rounds share one layout, so its later states are read once rather than in every round; what differs between
// decks (panes, numbered lines, option code, layers) is read in every deck. The themes take turns across the sources,
// so each of the four (#125) is read at every state, and the decks with question layers (#127) play them, as do a
// mix's rounds from those decks.
const THEMES = ["terminal", "paper", "arcade", "contrast"] as const;
const LAYERED = new Set(["algorithm", "language", "daily"]);

for (const [index, source] of SOURCES.entries()) {
  test(`the ${source} game passes axe at every state, at 320 and 1280 px`, async ({ page }) => {
    const theme = THEMES[index % THEMES.length]!;
    await page.goto(`${gameAddress(source)}&theme=${theme}&layer=${LAYERED.has(source) ? "on" : "off"}`);
    await expect(page.getByText("Round 1 of 5")).toBeVisible();
    await expect(page.locator(".demo-page")).toHaveAttribute("data-theme", theme);
    await scan(page, "round 1");

    await page.getByRole("button", { name: "Reveal hint 1" }).click();
    await expect(page.locator(".hints .hint")).toHaveCount(1);
    await scan(page, "after a hint");

    await lockRound(page, false);
    await scan(page, "after a reveal");

    await finishGame(page);
    await expect(page.getByText(/Run complete — /u)).toBeVisible();
    await scan(page, "the finished game");

    // Back at the chooser, the deck's card shows the score just kept in this browser (#63).
    if (source === "daily") {
      await page.getByRole("link", { name: "Choose another deck" }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Pick a deck" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Clear records" })).toBeVisible();
      await scan(page, "the chooser with records");
    }
  });
}
