import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// The browser never learns the answers; the test runner reads the generated artifact on the Node side.
interface ArtifactFixture { roundId: string; candidates: { id: string; label: string }[]; correctCandidateId: string }
interface ArtifactDeck { id: string; title: string; description: string; fixtures: ArtifactFixture[] }
const artifact = JSON.parse(readFileSync(resolve(process.cwd(), "apps/game/src/demo/generated/local-real-rounds.json"), "utf8")) as { decks: ArtifactDeck[] };
const answers = new Map(artifact.decks.flatMap((deck) => deck.fixtures.map((fixture) =>
  [fixture.roundId, fixture.candidates.find(({ id }) => id === fixture.correctCandidateId)!.label] as const)));
const wrongAnswers = new Map(artifact.decks.flatMap((deck) => deck.fixtures.map((fixture) =>
  [fixture.roundId, fixture.candidates.find(({ id }) => id !== fixture.correctCandidateId)!.label] as const)));
/** Points for a correct answer with no hint: 1,000 for four options, 500 for two. */
const fullPoints = (deck: ArtifactDeck): number => deck.fixtures[0]!.candidates.length * 250;
const titlePattern = (title: string) => new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u");
const points = (value: number): string => value.toLocaleString("en-US");

const currentRound = async (page: Page): Promise<string> => (await page.locator(".game-card").getAttribute("data-round-id"))!;

const answerRounds = async (page: Page, firstRoundHint: boolean) => {
  for (let index = 0; index < 5; index += 1) {
    if (index > 0) await page.getByRole("button", { name: "Next round" }).click();
    await expect(page.getByText(`Round ${index + 1} of 5`)).toBeVisible();
    await expect(page.locator(".reveal small")).toHaveCount(0);
    if (index === 0 && firstRoundHint) await page.getByRole("button", { name: "Reveal hint 1" }).click();
    const answer = answers.get(await currentRound(page))!;
    await page.getByLabel(answer, { exact: true }).check();
    await page.getByRole("button", { name: "Lock in answer" }).click();
    await expect(page.getByRole("heading", { name: "Nice read." })).toBeVisible();
    await expect(page.locator(".candidate.correct")).toContainText(answer);
    await expect(page.locator(".reveal small")).toBeVisible();
  }
};

test("the root route offers every deck under the permanent notice", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/Local unreviewed experiment/)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Pick a deck" })).toBeVisible();
  expect(artifact.decks.map(({ id }) => id)).toEqual(["project", "language", "before-after", "algorithm", "output", "fix"]);
  for (const deck of artifact.decks) {
    const link = page.getByRole("link", { name: titlePattern(deck.title) });
    await expect(link).toBeVisible();
    await expect(link).toContainText(deck.description);
    await expect(link).toContainText(`${deck.fixtures.length} rounds in the deck`);
  }
  await expect(page.getByRole("radio")).toHaveCount(0);
});

for (const deck of artifact.decks) {
  test(`plays the ${deck.id} deck through hints, scoring, replay, a new deal, and choosing another deck`, async ({ page }) => {
    const full = fullPoints(deck);
    await page.goto("/");
    await page.getByRole("link", { name: titlePattern(deck.title) }).click();
    await expect(page).toHaveURL(new RegExp(`\\?deck=${deck.id}$`, "u"));
    await expect(page.getByText(/Local unreviewed experiment/)).toBeVisible();
    if (deck.id === "before-after") await expect(page.locator("figcaption")).toHaveText(["Version A", "Version B"]);

    await answerRounds(page, true);
    const hinted = full * 0.8 + 4 * full;
    await expect(page.getByLabel(/Score/)).toHaveText(`${points(hinted)} pts`);
    await expect(page.getByText(new RegExp(`Run complete — ${points(hinted)} points`, "u"))).toBeVisible();

    await page.getByRole("button", { name: "Play again" }).click();
    await expect(page.getByText("Round 1 of 5")).toBeVisible();
    await expect(page.getByLabel(/Score/)).toHaveText("0 pts");
    await answerRounds(page, false);
    await expect(page.getByText(new RegExp(`Run complete — ${points(5 * full)} points`, "u"))).toBeVisible();

    await expect(page.getByRole("link", { name: "Deal new rounds" })).toHaveAttribute("href", `/?deck=${deck.id}`);
    await page.getByRole("link", { name: "Choose another deck" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Pick a deck" })).toBeVisible();
  });
}

test("a deck query parameter preselects the deck, and a wrong answer scores zero and shows the right one", async ({ page }) => {
  await page.goto("/?deck=before-after");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  const round = await currentRound(page);
  await page.getByLabel(wrongAnswers.get(round)!, { exact: true }).check();
  await page.getByRole("button", { name: "Lock in answer" }).click();
  await expect(page.getByRole("heading", { name: "Not this time." })).toBeVisible();
  await expect(page.getByLabel(/Score/)).toHaveText("0 pts");
  await expect(page.locator(".candidate.missed")).toContainText(wrongAnswers.get(round)!);
  await expect(page.locator(".candidate.correct")).toContainText(answers.get(round)!);
  await expect(page.getByText(`The answer: ${answers.get(round)!}`)).toBeVisible();
  await page.getByRole("link", { name: "All decks" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Pick a deck" })).toBeVisible();
});

test("each visit deals rounds from the deck's pool", async ({ page }) => {
  const seen = new Set<string>();
  for (let visit = 0; visit < 6; visit += 1) {
    await page.goto("/?deck=language");
    await expect(page.getByText("Round 1 of 5")).toBeVisible();
    seen.add(await currentRound(page));
  }
  expect(seen.size).toBeGreaterThan(1);
});

test("a fix round numbers its lines, shows each option's code, and highlights the chosen line", async ({ page }) => {
  await page.goto("/?deck=fix");
  const pane = page.getByLabel("Code excerpt with numbered lines");
  await expect(pane).toBeVisible();
  await expect(pane.locator(".line-number")).toHaveCount(14);
  const option = page.locator(".candidate").first();
  const line = Number((await option.locator(".candidate-label").textContent())!.slice("Line ".length));
  const code = (await pane.locator(`[data-line="${line}"]`).textContent())!.slice(String(line).length).trim();
  await expect(option.locator(".code-detail")).toHaveText(code);
  await option.locator("input").check();
  await expect(pane.locator(`[data-line="${line}"]`)).toHaveClass(/highlighted/u);
  await expect(pane.locator(".code-line.highlighted")).toHaveCount(1);
});
