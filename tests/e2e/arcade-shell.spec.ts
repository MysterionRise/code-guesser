import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

// The browser never learns the answers; the test runner reads the generated artifact on the Node side.
const artifact = JSON.parse(readFileSync(resolve(process.cwd(), "apps/game/src/demo/generated/local-real-rounds.json"), "utf8"));
const answers: string[] = artifact.fixtures.map((fixture: { candidates: { id: string; label: string }[]; correctCandidateId: string }) =>
  fixture.candidates.find((candidate) => candidate.id === fixture.correctCandidateId)!.label);

test("plays the five real local-experiment rounds, sees attribution only after answering, and restarts", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/Local unreviewed experiment/)).toBeVisible();
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  await expect(page.locator(".reveal small")).toHaveCount(0);

  await page.getByRole("button", { name: "Reveal hint 1" }).click();
  await page.getByLabel(answers[0]!).check();
  await page.getByRole("button", { name: "Lock in answer" }).click();
  await expect(page.getByRole("heading", { name: "Nice read." })).toBeVisible();
  await expect(page.locator(".reveal small")).toBeVisible();
  await expect(page.getByLabel(/Score/)).toHaveText("800 pts");

  for (const answer of answers.slice(1)) {
    await page.getByRole("button", { name: "Next round" }).click();
    await expect(page.locator(".reveal small")).toHaveCount(0);
    await page.getByLabel(answer).check();
    await page.getByRole("button", { name: "Lock in answer" }).click();
    await expect(page.getByRole("heading", { name: "Nice read." })).toBeVisible();
  }

  await expect(page.getByText(/Run complete — 4,800 points/)).toBeVisible();
  await page.getByRole("button", { name: "Play again" }).click();
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  await expect(page.getByLabel(/Score/)).toHaveText("0 pts");
});
