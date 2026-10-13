import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// The browser never learns the answers; the test runner reads the generated artifact on the Node side.
interface ArtifactFixture { candidates: { id: string; label: string }[]; correctCandidateId: string }
interface ArtifactDeck { id: string; title: string; description: string; notice: string | null; fixtures: ArtifactFixture[] }
const artifact = JSON.parse(readFileSync(resolve(process.cwd(), "apps/game/src/demo/generated/local-real-rounds.json"), "utf8")) as { decks: ArtifactDeck[] };
const decks = artifact.decks.map((deck) => ({
  ...deck,
  answers: deck.fixtures.map((fixture) => fixture.candidates.find(({ id }) => id === fixture.correctCandidateId)!.label),
}));
const AI_NOTICE = decks.find(({ id }) => id === "ai")!.notice!;
const titlePattern = (title: string) => new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u");

const answerRounds = async (page: Page, answers: readonly string[], firstRoundHint: boolean) => {
  for (const [index, answer] of answers.entries()) {
    if (index > 0) await page.getByRole("button", { name: "Next round" }).click();
    await expect(page.getByText(`Round ${index + 1} of 5`)).toBeVisible();
    await expect(page.locator(".reveal small")).toHaveCount(0);
    if (index === 0 && firstRoundHint) await page.getByRole("button", { name: "Reveal hint 1" }).click();
    await page.getByLabel(answer, { exact: true }).check();
    await page.getByRole("button", { name: "Lock in answer" }).click();
    await expect(page.getByRole("heading", { name: "Nice read." })).toBeVisible();
    await expect(page.locator(".reveal small")).toBeVisible();
  }
};

test("the root route offers the three decks under the permanent notice", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/Local unreviewed experiment/)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Pick a deck" })).toBeVisible();
  expect(decks.map(({ id }) => id)).toEqual(["project", "language", "ai"]);
  for (const deck of decks) {
    const link = page.getByRole("link", { name: titlePattern(deck.title) });
    await expect(link).toBeVisible();
    await expect(link).toContainText(deck.description);
  }
  await expect(page.getByText(AI_NOTICE)).toHaveCount(0);
  await expect(page.getByRole("radio")).toHaveCount(0);
});

for (const deck of decks) {
  test(`plays the ${deck.id} deck through clues, scoring, replay, and choosing another deck`, async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: titlePattern(deck.title) }).click();
    await expect(page).toHaveURL(new RegExp(`\\?deck=${deck.id}$`, "u"));
    await expect(page.getByText(/Local unreviewed experiment/)).toBeVisible();
    await expect(page.getByText(AI_NOTICE)).toHaveCount(deck.id === "ai" ? 1 : 0);

    await answerRounds(page, deck.answers, true);
    await expect(page.getByLabel(/Score/)).toHaveText("4,800 pts");
    await expect(page.getByText(/Run complete — 4,800 points/)).toBeVisible();
    if (deck.id === "ai") await expect(page.getByText(AI_NOTICE)).toBeVisible();

    await page.getByRole("button", { name: "Play again" }).click();
    await expect(page.getByText("Round 1 of 5")).toBeVisible();
    await expect(page.getByLabel(/Score/)).toHaveText("0 pts");

    await answerRounds(page, deck.answers, false);
    await expect(page.getByText(/Run complete — 5,000 points/)).toBeVisible();
    await page.getByRole("link", { name: "Choose another deck" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Pick a deck" })).toBeVisible();
  });
}

test("a deck query parameter preselects the deck and a wrong answer scores zero", async ({ page }) => {
  const ai = decks.find(({ id }) => id === "ai")!;
  await page.goto("/?deck=ai");
  await expect(page.getByText(AI_NOTICE)).toBeVisible();
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  const wrong = ai.fixtures[0]!.candidates.find(({ id }) => id !== ai.fixtures[0]!.correctCandidateId)!.label;
  await page.getByLabel(wrong, { exact: true }).check();
  await page.getByRole("button", { name: "Lock in answer" }).click();
  await expect(page.getByRole("heading", { name: "Not this time." })).toBeVisible();
  await expect(page.getByLabel(/Score/)).toHaveText("0 pts");
  await page.getByRole("link", { name: "All decks" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Pick a deck" })).toBeVisible();
});
