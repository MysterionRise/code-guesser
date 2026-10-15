import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Question layers in the game (#128): the free scaffold with the question, and the layer's hints when bought.
const violations = async (page: Page) => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations
  .map(({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.join(" ")).slice(0, 3).join(", ")}`);

test("a Marker hunt round asks three questions of the code, and its first hint marks the deciding lines", async ({ page }) => {
  await page.goto("/?deck=language&design=off&layer=on");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  const scaffold = page.getByRole("region", { name: "Ask of the code" });
  await expect(scaffold.getByRole("listitem")).toHaveCount(3);
  // The round numbers its lines, so a hint can point at them.
  await expect(page.locator(".code-line .line-number").first()).toHaveText("1");
  await page.getByRole("button", { name: "Reveal hint 1" }).click();
  await expect(page.locator(".hint").first()).toHaveText(/^Look closely at lines? \d+( and \d+)?\.$/u);
  await expect(page.locator(".code-line.hinted").first()).toBeVisible();
  const marked = await page.locator(".code-line.hinted").evaluateAll((lines) => lines.map((line) => line.getAttribute("data-line")));
  expect((await page.locator(".hint").first().textContent())!.match(/\d+/gu)).toEqual(marked);
  expect(await violations(page)).toEqual([]);
});

test("a Trace it round names what to watch, and its second hint steps through a tiny input", async ({ page }) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.goto("/?deck=algorithm&design=off&layer=on");
    await expect(page.getByText("Round 1 of 5")).toBeVisible();
    if (await page.getByRole("region", { name: "What to watch" }).count() > 0) break;
  }
  const scaffold = page.getByRole("region", { name: "What to watch" });
  await expect(scaffold.locator("code").first()).toBeVisible();
  await page.getByRole("button", { name: "Reveal hint 1" }).click();
  await page.getByRole("button", { name: "Reveal hint 2" }).click();
  const stepper = page.getByRole("group", { name: "Step-through" });
  await expect(stepper.getByText(/^Step 1 of \d:/u)).toBeVisible();
  await expect(stepper.getByRole("button", { name: "Back" })).toBeDisabled();
  await stepper.getByRole("button", { name: "Next step" }).click();
  await expect(stepper.getByText(/^Step 2 of \d:/u)).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test("a game drawn without layers shows the static question", async ({ page }) => {
  await page.goto("/?deck=language&design=off&layer=off");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  await expect(page.getByRole("region", { name: "Ask of the code" })).toHaveCount(0);
  await expect(page.locator(".code-line")).toHaveCount(0);
});
