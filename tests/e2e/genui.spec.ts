import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// Generative UI (#101) against the local stand-in for OpenRouter that playwright.config.ts starts on the next port.
const fake = `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 3000) + 1}`;
interface Fixture { roundId: string; candidates: { id: string; label: string }[]; correctCandidateId: string; panes: { text: string }[] }
const artifact = JSON.parse(readFileSync(resolve(process.cwd(), "apps/game/src/demo/generated/local-real-rounds.json"), "utf8")) as { decks: { fixtures: Fixture[] }[] };
const fixtures = new Map(artifact.decks.flatMap(({ fixtures: deckFixtures }) => deckFixtures.map((fixture) => [fixture.roundId, fixture] as const)));

/** Answers the current round right and returns its fixture. */
const answerRound = async (page: Page): Promise<Fixture> => {
  const fixture = fixtures.get((await page.locator(".game-card").getAttribute("data-round-id"))!)!;
  await page.getByLabel(fixture.candidates.find(({ id }) => id === fixture.correctCandidateId)!.label, { exact: true }).check();
  await page.getByRole("button", { name: "Lock in answer" }).click();
  await expect(page.getByRole("heading", { name: "Nice read." })).toBeVisible();
  return fixture;
};

test.beforeEach(async ({ request }) => {
  await request.post(`${fake}/control`, { data: {} });
});

test("a revealed round's explainer renders the model's checked components, sent the code only after the lock", async ({ page, request }) => {
  await page.goto("/?deck=language");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  const fixture = await answerRound(page);
  const panel = page.getByRole("region", { name: "Explainer" });
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: "Explain this round" }).click();
  await expect(panel.locator(".genui-takeaway")).toHaveText("Takeaway: Read the keywords before the punctuation.");
  await expect(panel.getByRole("heading", { name: "Pointed to the answer" })).toBeVisible();
  await expect(panel.getByRole("listitem").first()).toHaveText("The block keywords");
  await expect(panel.getByRole("button", { name: "Explain this round" })).toHaveCount(0);

  const recorded = await (await request.get(`${fake}/requests`)).json() as { body: { provider: unknown; messages: unknown[] } }[];
  expect(recorded).toHaveLength(1);
  expect(recorded[0]!.body.provider).toEqual({ data_collection: "deny" });
  const firstLine = fixture.panes[0]!.text.split("\n").find((line) => /^[A-Za-z0-9 _(){};:=,.]{12,}$/u.test(line.trim()))?.trim();
  if (firstLine) expect(JSON.stringify(recorded[0]!.body.messages)).toContain(firstLine);

  await page.getByRole("button", { name: "Next round" }).click();
  await expect(page.getByText("Round 2 of 5")).toBeVisible();
  await expect(page.getByRole("region", { name: "Explainer" })).toHaveCount(0);
});

test("when the provider refuses, the explainer steps aside and the game plays on", async ({ page, request }) => {
  // OpenRouter answers 402 when the key's spend limit is reached.
  await request.post(`${fake}/control`, { data: { status: 402 } });
  await page.goto("/?deck=project");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  await answerRound(page);
  const panel = page.getByRole("region", { name: "Explainer" });
  await panel.getByRole("button", { name: "Explain this round" }).click();
  await expect(panel.getByText("The explainer isn’t available right now. The reveal above has the full answer.")).toBeVisible();
  await expect(panel).not.toContainText("fake provider body");
  await expect(page.getByText("The answer:")).toBeVisible();
  await page.getByRole("button", { name: "Next round" }).click();
  await expect(page.getByText("Round 2 of 5")).toBeVisible();
});
