import { expect, test, type Locator, type Page } from "@playwright/test";

import { DEAL, optionLabel } from "../production/game";

// A whole game from the keyboard alone on the production build (#70): Tab to each control, arrow keys through the
// options, Enter and Space on buttons, and a visible focus ring on every control it lands on. The browser tests check
// the shortcut keys (#71); this game uses none of them.

const hasFocus = (control: Locator): Promise<boolean> => control.evaluate((element) => element === document.activeElement);

/** The control has focus, and shows it with a ring (WCAG 2.4.7). */
const expectFocusRing = async (control: Locator): Promise<void> => {
  await expect(control).toBeFocused();
  expect(await control.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.outlineStyle !== "none" && parseFloat(style.outlineWidth) >= 2;
  }), "a visible focus ring").toBe(true);
};

/** Presses Tab until the control has focus, so it is reached in tab order. */
const tabTo = async (page: Page, control: Locator): Promise<void> => {
  for (let presses = 0; presses < 60 && !(await hasFocus(control)); presses += 1) await page.keyboard.press("Tab");
  await expectFocusRing(control);
};

/**
 * Tabs into the options, which Tab enters at the first while none is chosen, and arrows to the given one, which the
 * arrow keys choose as they go; the first option, reached by Tab alone, is chosen with Space.
 */
const chooseByKeys = async (page: Page, label: string): Promise<void> => {
  const options = page.getByRole("group", { name: "Choose one answer" });
  await tabTo(page, options.getByRole("radio").first());
  const option = options.getByLabel(label, { exact: true });
  for (let presses = 0; presses < 4 && !(await hasFocus(option)); presses += 1) await page.keyboard.press("ArrowDown");
  await expectFocusRing(option);
  if (!(await option.isChecked())) await page.keyboard.press("Space");
  await expect(option).toBeChecked();
};

test("a whole game plays from the keyboard alone, with focus always visible", async ({ page }) => {
  await page.goto(`/?deck=project&deal=${DEAL}&game=2`);
  for (let round = 1; round <= 5; round += 1) {
    await expect(page.getByText(`Round ${round} of 5`)).toBeVisible();
    // Odd rounds buy a hint first; the button keeps focus for the next one.
    if (round % 2 === 1) {
      await tabTo(page, page.getByRole("button", { name: "Reveal hint 1" }));
      await page.keyboard.press("Enter");
      await expect(page.locator(".hints .hint")).toHaveCount(1);
      await expect(page.getByRole("button", { name: "Reveal hint 2" })).toBeFocused();
    }
    // Round 2 is missed on purpose.
    await chooseByKeys(page, await optionLabel(page, round !== 2));
    await tabTo(page, page.getByRole("button", { name: "Lock in answer" }));
    await page.keyboard.press(round % 2 === 1 ? "Space" : "Enter");
    await expect(page.getByRole("heading", { name: round === 2 ? "Not this time." : "Nice read." })).toBeFocused();
    if (round < 5) {
      await tabTo(page, page.getByRole("button", { name: "Next round" }));
      await page.keyboard.press("Enter");
    }
  }
  await expect(page.getByText(/Run complete — /u)).toBeVisible();
  await tabTo(page, page.getByRole("link", { name: "Deal new rounds" }));
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp(`\\?deck=project&deal=${DEAL}&game=3$`, "u"));
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
});
