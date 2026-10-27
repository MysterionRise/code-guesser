import { expect, test } from "@playwright/test";

import { scan } from "./scan";

// The pages outside a game on the production build (#45): the chooser, About, Credits, Privacy, and the 404, at 320
// and 1280 px. Each shows the original theme; the browser tests read them in the other themes too.
const PAGES = [
  { path: "/", status: 200, heading: "Pick a deck" },
  { path: "/about", status: 200, heading: "About CodeGuessr" },
  { path: "/credits", status: 200, heading: "Credits" },
  { path: "/privacy", status: 200, heading: "Privacy" },
  { path: "/no-such-page", status: 404, heading: "There’s nothing here" },
] as const;

for (const { path, status, heading } of PAGES) {
  test(`${path} passes axe at 320 and 1280 px`, async ({ page }) => {
    expect((await page.goto(path))?.status()).toBe(status);
    await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    await scan(page, path);
  });
}
