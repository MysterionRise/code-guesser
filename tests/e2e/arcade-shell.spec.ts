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

/** Answers all five rounds right, checks each reveal states its points, and returns the dealt round ids in play order. */
const answerRounds = async (page: Page, full: number, firstRoundHint: boolean): Promise<string[]> => {
  const dealt: string[] = [];
  for (let index = 0; index < 5; index += 1) {
    if (index > 0) await page.getByRole("button", { name: "Next round" }).click();
    await expect(page.getByText(`Round ${index + 1} of 5`)).toBeVisible();
    await expect(page.locator(".reveal small")).toHaveCount(0);
    const hinted = index === 0 && firstRoundHint;
    if (hinted) await page.getByRole("button", { name: "Reveal hint 1" }).click();
    const roundId = await currentRound(page);
    dealt.push(roundId);
    const answer = answers.get(roundId)!;
    await page.getByLabel(answer, { exact: true }).check();
    await page.getByRole("button", { name: "Lock in answer" }).click();
    await expect(page.getByRole("heading", { name: "Nice read." })).toBeVisible();
    await expect(page.locator(".reveal .round-points"))
      .toHaveText(hinted ? `+${points(full * 0.8)} points (1 hint)` : `+${points(full)} points (no hints)`);
    await expect(page.locator(".candidate.correct")).toContainText(answer);
    await expect(page.locator(".reveal small")).toBeVisible();
  }
  return dealt;
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
  test(`plays the ${deck.id} deck through hints, scoring, a fresh deal, and choosing another deck`, async ({ page }) => {
    const full = fullPoints(deck);
    await page.goto("/");
    await page.getByRole("link", { name: titlePattern(deck.title) }).click();
    await expect(page).toHaveURL(new RegExp(`\\?deck=${deck.id}$`, "u"));
    await expect(page.getByText(/Local unreviewed experiment/)).toBeVisible();
    if (deck.id === "before-after") await expect(page.locator("figcaption")).toHaveText(["Version A", "Version B"]);

    const first = await answerRounds(page, full, true);
    const hinted = full * 0.8 + 4 * full;
    await expect(page.getByLabel(/Score/)).toHaveText(`${points(hinted)} pts`);
    await expect(page.getByText(new RegExp(`Run complete — ${points(hinted)} points`, "u"))).toBeVisible();

    // A finished run offers a fresh deal and another deck, never a replay of the rounds it just revealed.
    await expect(page.getByRole("button", { name: "Play again" })).toHaveCount(0);
    const deal = page.getByRole("link", { name: "Deal new rounds" });
    await expect(deal).toHaveAttribute("href", `/?deck=${deck.id}`);
    await expect(deal).toHaveClass(/primary-action/u);
    await deal.click();
    await expect(page.getByText("Round 1 of 5")).toBeVisible();
    await expect(page.getByLabel(/Score/)).toHaveText("0 pts");
    await expect(page.getByRole("heading", { name: /Nice read\.|Not this time\./u })).toHaveCount(0);
    const second = await answerRounds(page, full, false);
    // Five rounds dealt in the same order again is at most a one-in-30,240 chance, even from the ten-round pool.
    expect(second).not.toEqual(first);
    await expect(page.getByText(new RegExp(`Run complete — ${points(5 * full)} points`, "u"))).toBeVisible();

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
  await expect(page.locator(".reveal .round-points")).toHaveText("0 points (no hints)");
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

test("revealing a hint keeps keyboard focus, and a failed check returns it to Lock in answer", async ({ page }) => {
  await page.goto("/?deck=project");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  const hints = page.locator(".hints");
  await expect(hints).toHaveAttribute("aria-live", "polite");
  const focusedTag = () => page.evaluate(() => document.activeElement?.tagName ?? "");

  await page.getByRole("button", { name: "Reveal hint 1" }).focus();
  await page.keyboard.press("Enter");
  await expect(hints.locator(".hint")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Reveal hint 2" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(hints.locator(".hint")).toHaveCount(2);
  await expect(hints.locator(".hint").nth(1)).toBeFocused();
  expect(await focusedTag()).not.toBe("BODY");

  // Every POST is the reveal's server action; failing it shows the alert with focus back on the button.
  await page.getByLabel(answers.get(await currentRound(page))!, { exact: true }).check();
  await page.route("**/*", (route) => route.request().method() === "POST" ? route.abort() : route.continue());
  const lockIn = page.getByRole("button", { name: "Lock in answer" });
  await lockIn.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main").getByRole("alert")).toHaveText("Couldn’t check that answer. Try again.");
  await expect(lockIn).toBeFocused();

  await page.unrouteAll();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Nice read." })).toBeFocused();
  await expect(page.locator(".reveal .round-points")).toHaveText("+500 points (2 hints)");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});
