import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page } from "@playwright/test";

// What the production checks share: the committed rounds, read on the Node side since the browser never learns an
// answer, and how a test plays a round.
interface Fixture { roundId: string; candidates: { id: string; label: string }[]; correctCandidateId: string }
interface Deck { id: string; title: string; fixtures: Fixture[] }
export const artifact = JSON.parse(readFileSync(resolve(process.cwd(), "apps/game/src/demo/generated/local-real-rounds.json"), "utf8")) as
  { decks: Deck[] };
const fixtures = new Map(artifact.decks.flatMap(({ fixtures: deckFixtures }) => deckFixtures.map((fixture) => [fixture.roundId, fixture] as const)));

/** Every deck this artifact holds, then the mix and today's five (#56, #74). */
export const SOURCES: readonly string[] = [...artifact.decks.map(({ id }) => id), "mixed", "daily"];

/** The seeded deal the checks play (#40), so every run sees the same rounds. */
export const DEAL = "0a11ce55";

/** Today's date in UTC, which the server always deals today's five on (#172). */
export const utcDate = (): string => new Date().toISOString().slice(0, 10);

/** A source's first game: the seeded deal's, or today's five on today's date. */
export const gameAddress = (source: string): string => source === "daily" ? `/?deck=daily&date=${utcDate()}` : `/?deck=${source}&deal=${DEAL}&game=0`;

/** The round on screen. */
export const roundId = async (page: Page): Promise<string> => (await page.locator(".game-card").getAttribute("data-round-id"))!;

/** The round on screen's answer, or an option that isn't it. */
export const optionLabel = async (page: Page, right: boolean): Promise<string> => {
  const fixture = fixtures.get(await roundId(page))!;
  return fixture.candidates.find(({ id }) => (id === fixture.correctCandidateId) === right)!.label;
};

/** Locks in the round on screen, right or not, by pointer, and waits for the verdict. */
export const lockRound = async (page: Page, right = true): Promise<void> => {
  await page.getByLabel(await optionLabel(page, right), { exact: true }).check();
  await page.getByRole("button", { name: "Lock in answer" }).click();
  await expect(page.getByRole("heading", { name: right ? "Nice read." : "Not this time." })).toBeVisible();
};

/** From the first round's verdict, plays rounds two to five right, to the last verdict. */
export const finishGame = async (page: Page): Promise<void> => {
  for (let round = 2; round <= 5; round += 1) {
    await page.getByRole("button", { name: "Next round" }).click();
    await expect(page.getByText(`Round ${round} of 5`)).toBeVisible();
    await lockRound(page);
  }
};
