import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// Polish from agent playtest run 2 (#161): a deck column in mixed summaries, controls gone once the answer is locked,
// a cue from the verdict to the host's chat, and a note on a layered game's rounds that play without a layer.
interface Fixture { roundId: string; candidates: { id: string; label: string }[]; correctCandidateId: string }
interface Deck { id: string; title: string; fixtures: Fixture[] }
const artifact = JSON.parse(readFileSync(resolve(process.cwd(), "apps/game/src/demo/generated/local-real-rounds.json"), "utf8")) as { decks: Deck[] };
const fixtures = new Map(artifact.decks.flatMap(({ fixtures: deckFixtures }) => deckFixtures.map((fixture) => [fixture.roundId, fixture] as const)));
const deckOf = new Map(artifact.decks.flatMap((deck) => deck.fixtures.map(({ roundId }) => [roundId, deck] as const)));
// A new round's card slides in; axe reads it settled.
test.use({ contextOptions: { reducedMotion: "reduce" } });
const violations = async (page: Page) => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations
  .map(({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.join(" ")).slice(0, 3).join(", ")}`);

const roundId = async (page: Page) => (await page.locator(".game-card").getAttribute("data-round-id"))!;
/** Locks in the round on screen, right or not; returns its id. */
const lockRound = async (page: Page, right = true): Promise<string> => {
  const id = await roundId(page);
  const fixture = fixtures.get(id)!;
  await page.getByLabel(fixture.candidates.find(({ id: candidate }) => (candidate === fixture.correctCandidateId) === right)!.label, { exact: true }).check();
  await page.getByRole("button", { name: "Lock in answer" }).click();
  await expect(page.getByRole("heading", { name: right ? "Nice read." : "Not this time." })).toBeVisible();
  return id;
};

test("once the answer is locked, the lock button, the hint button, and the keys line give way to the verdict", async ({ page }) => {
  await page.goto("/?deck=fix&design=off");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lock in answer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reveal hint 1" })).toBeVisible();
  await expect(page.locator(".keys-note")).toBeVisible();
  await page.getByRole("button", { name: "Reveal hint 1" }).click();
  await expect(page.locator(".hints .hint")).toHaveCount(1);
  await lockRound(page);
  await expect(page.getByRole("heading", { name: "Nice read." })).toBeFocused();
  await expect(page.getByRole("button", { name: "Lock in answer" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Reveal hint/u })).toHaveCount(0);
  await expect(page.locator(".keys-note")).toHaveCount(0);
  // The hint bought stays, and N still moves on.
  await expect(page.locator(".hints .hint")).toHaveCount(1);
  await page.keyboard.press("n");
  await expect(page.getByText("Round 2 of 5")).toBeVisible();
  await expect(page.getByRole("button", { name: "Lock in answer" })).toBeVisible();
  await expect(page.locator(".keys-note")).toBeVisible();
  for (let round = 2; round <= 5; round += 1) {
    if (round > 2) await page.getByRole("button", { name: "Next round" }).click();
    await lockRound(page, round !== 3);
  }
  // At the end of the game too.
  await expect(page.getByRole("button", { name: "Lock in answer" })).toHaveCount(0);
  await expect(page.locator(".keys-note")).toHaveCount(0);
  expect(await violations(page)).toEqual([]);
});

test("a mixed game's summary names each round's deck", async ({ page }) => {
  await page.goto("/?deck=mixed&design=off");
  const decks: string[] = [];
  for (let round = 1; round <= 5; round += 1) {
    if (round > 1) await page.getByRole("button", { name: "Next round" }).click();
    await expect(page.getByText(`Round ${round} of 5`)).toBeVisible();
    decks.push(deckOf.get(await lockRound(page, round !== 2))!.title);
  }
  const summary = page.getByRole("region", { name: "Your game" });
  await expect(summary.locator("thead th")).toHaveText(["#", "Deck", "Your pick", "Answer", "Points"]);
  await expect(summary.locator("tbody .summary-deck")).toHaveText(decks);
  // The missed pick is still the one marked.
  await expect(summary.locator("tbody tr").nth(1).locator(".summary-pick")).toContainText("✗");
  expect(await violations(page)).toEqual([]);
  // The extra column still fits a phone.
  await page.setViewportSize({ width: 320, height: 568 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("a deck's own summary needs no deck column", async ({ page }) => {
  await page.goto("/?deck=fix&design=off");
  for (let round = 1; round <= 5; round += 1) {
    if (round > 1) await page.getByRole("button", { name: "Next round" }).click();
    await expect(page.getByText(`Round ${round} of 5`)).toBeVisible();
    await lockRound(page);
  }
  await expect(page.getByRole("region", { name: "Your game" }).locator("thead th")).toHaveText(["#", "Your pick", "Answer", "Points"]);
});

test("with the host on, the verdict links to the host's chat, which takes focus", async ({ page }) => {
  await page.goto("/?deck=fix&design=host");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Host" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Ask the host about this round" })).toHaveCount(0);
  await lockRound(page);
  const cue = page.getByRole("link", { name: "Ask the host about this round" });
  await cue.click();
  await expect(page.getByLabel("Ask the host")).toBeFocused();
  // The cue moves focus without touching the address, whose fragment may name a duel's players.
  expect(new URL(page.url()).hash).toBe("");
  expect(await violations(page)).toEqual([]);
});

test("without the host, the verdict has no cue", async ({ page }) => {
  await page.goto("/?deck=fix&design=off");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  await lockRound(page);
  await expect(page.getByRole("link", { name: "Ask the host about this round" })).toHaveCount(0);
});

test("a layered game says when a round plays without its layer, and a static game says nothing", async ({ page }) => {
  const layered = new Set((JSON.parse(readFileSync(resolve(process.cwd(), "apps/game/src/demo/generated/question-layers.json"), "utf8")) as
    { layers: { roundId: string }[] }).layers.map(({ roundId: id }) => id));
  const algorithm = artifact.decks.find(({ id }) => id === "algorithm")!.fixtures.map(({ roundId: id }) => id);
  expect(algorithm.some((id) => !layered.has(id)), "some algorithm round has no layer").toBe(true);
  // Games of one deal until one shows both a layered round and one without.
  let seen = { layered: false, plain: false };
  for (let game = 0; game < 9 && !(seen.layered && seen.plain); game += 1) {
    await page.goto(`/?deck=algorithm&deal=0c0ffee0&game=${game}&design=off&layer=on`);
    for (let round = 1; round <= 5; round += 1) {
      if (round > 1) await page.getByRole("button", { name: "Next round" }).click();
      await expect(page.getByText(`Round ${round} of 5`)).toBeVisible();
      const id = await roundId(page);
      if (layered.has(id)) {
        await expect(page.getByRole("region", { name: "What to watch" })).toBeVisible();
        await expect(page.locator(".layer-note")).toHaveCount(0);
        seen = { ...seen, layered: true };
      } else {
        await expect(page.getByText("No question layer for this round.")).toBeVisible();
        await expect(page.locator(".question-scaffold")).toHaveCount(0);
        if (!seen.plain) expect(await violations(page)).toEqual([]);
        seen = { ...seen, plain: true };
      }
      await lockRound(page);
    }
  }
  expect(seen).toEqual({ layered: true, plain: true });
  await page.goto("/?deck=algorithm&design=off&layer=off");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  await expect(page.locator(".layer-note")).toHaveCount(0);
});
