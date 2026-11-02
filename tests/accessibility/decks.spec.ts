import { expect, test } from "@playwright/test";

import { SOURCES, expectSummary, finishGame, gameAddress, lockRound } from "../production/game";
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
    await expect(page.getByText(/Run complete: /u)).toBeVisible();
    // The summary's structure in every theme, with the deck column in a mix's and today's five's (#161).
    await expectSummary(page, { decks: source === "mixed" || source === "daily" });
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

// A deck with question layers (#127) is read at the state the fixed game's first round may never reach: a layered
// round with both hints bought, so a Marker hunt's marked lines, a Trace it's step-through, and a step of it are all on
// screen. The audit refuses some rounds' layers, so the game is walked to the first round that carries one.
for (const [index, source] of [...LAYERED].entries()) {
  test(`the ${source} game's layered round passes axe after both hints`, async ({ page }) => {
    const theme = THEMES[(index + 1) % THEMES.length]!;
    await page.goto(`${gameAddress(source)}&theme=${theme}&layer=on`);
    for (let round = 1; round <= 5; round += 1) {
      await expect(page.getByText(`Round ${round} of 5`)).toBeVisible();
      if (await page.locator(".question-scaffold").count() > 0) {
        await page.getByRole("button", { name: "Reveal hint 1" }).click();
        await expect(page.locator(".hints .hint")).toHaveCount(1);
        await page.getByRole("button", { name: "Reveal hint 2" }).click();
        await expect(page.locator(".hints .hint")).toHaveCount(2);
        await scan(page, `${source}'s layered round after both hints`);
        const stepper = page.getByRole("group", { name: "Step-through" });
        if (await stepper.count() > 0) {
          await stepper.getByRole("button", { name: "Next step" }).click();
          await expect(stepper.getByText(/^Step 2 of \d+:/u)).toBeVisible();
          await scan(page, `${source}'s layered round after a step`);
        } else {
          await expect(page.locator(".code-line.hinted").first()).toBeVisible();
        }
        await lockRound(page);
        await scan(page, `${source}'s layered round after a reveal`);
        return;
      }
      await lockRound(page);
      if (round < 5) await page.getByRole("button", { name: "Next round" }).click();
    }
    test.info().annotations.push({ type: "note", description: `no round of ${source}'s fixed game carries a layer` });
    test.skip(true, `no round of ${source}'s fixed game carries a layer`);
  });
}

// Each theme (#125) on the two decks whose rounds look least alike: numbered lines with each option's own line of code,
// and two panes side by side; a hint bought and the answer missed, so the hint chip, the miss colour, the highlighted
// option line, and the reveal are all on screen.
for (const theme of THEMES) {
  test(`the ${theme} theme passes axe on a fix round and a before-after round`, async ({ page }) => {
    for (const source of ["fix", "before-after"]) {
      await page.goto(`${gameAddress(source)}&theme=${theme}&layer=off`);
      await expect(page.getByText("Round 1 of 5")).toBeVisible();
      await expect(page.locator(".demo-page")).toHaveAttribute("data-theme", theme);
      await page.getByRole("button", { name: "Reveal hint 1" }).click();
      await expect(page.locator(".hints .hint")).toHaveCount(1);
      await lockRound(page, false);
      await scan(page, `${theme} on ${source} after a missed reveal`);
    }
  });
}
