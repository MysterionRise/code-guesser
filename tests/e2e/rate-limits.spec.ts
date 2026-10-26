import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { E2E_EVENTS_DIR, E2E_RATE_LIMITS } from "../../playwright.config";

// Rate limits (#98). The dev server applies them at E2E_RATE_LIMITS times their public rates, keyed by the
// X-Forwarded-For each test sets, so a test spends only its own client's allowance.
const fake = `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 3000) + 1}`;
interface Fixture { roundId: string; candidates: { id: string; label: string }[]; correctCandidateId: string }
const artifact = JSON.parse(readFileSync(resolve(process.cwd(), "apps/game/src/demo/generated/local-real-rounds.json"), "utf8")) as { decks: { fixtures: Fixture[] }[] };
const fixtures = new Map(artifact.decks.flatMap(({ fixtures: deckFixtures }) => deckFixtures.map((fixture) => [fixture.roundId, fixture] as const)));
/** A deal's public burst (`SURFACES` in `server/rate-limit.server.ts`), and a game's explainer calls (`GENUI_CAPS`). */
const DEAL_BURST = 10;
const EXPLAINER_CAP = 12;
const FALLBACK = "The explainer isn’t available right now. The reveal above has the full answer.";

type StoredEvent = Readonly<Record<string, unknown> & { type: string; game: string }>;
const storedEvents = (): StoredEvent[] => {
  const path = join(E2E_EVENTS_DIR, `events-${new Date().toISOString().slice(0, 10)}.jsonl`);
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as StoredEvent) : [];
};

/** A documentation address (RFC 5737) no other test uses, so each test starts with full buckets. */
const clientAddress = (network = "198.51.100"): string => `${network}.${1 + Math.floor(Math.random() * 254)}`;

const answerRound = async (page: Page): Promise<void> => {
  const fixture = fixtures.get((await page.locator(".game-card").getAttribute("data-round-id"))!)!;
  await page.getByLabel(fixture.candidates.find(({ id }) => id === fixture.correctCandidateId)!.label, { exact: true }).check();
  await page.getByRole("button", { name: "Lock in answer" }).click();
  await expect(page.getByRole("heading", { name: "Nice read." })).toBeVisible();
};

test.beforeEach(async ({ request }) => {
  await request.post(`${fake}/control`, { data: {} });
});

test("an explainer past its game's limit falls back to the static reveal, and the game still finishes", async ({ page, request }) => {
  const client = { "X-Forwarded-For": clientAddress() };
  await page.setExtraHTTPHeaders(client);
  const from = storedEvents().length;
  await page.goto("/?deck=language&design=catalog");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  await answerRound(page);
  const panel = page.getByRole("region", { name: "Explainer" });
  const sent = page.waitForRequest("**/api/genui");
  await panel.getByRole("button", { name: "Explain this round" }).click();
  await expect(panel.locator(".genui-takeaway")).toBeVisible();
  // The rest of the game's explainer calls, spent through the route as a script would spend them.
  const body = (await sent).postDataJSON() as Record<string, unknown>;
  for (let call = 1; call < EXPLAINER_CAP; call += 1) {
    const response = await request.post("/api/genui", { data: body, headers: client });
    expect(response.status()).toBe(200);
    await response.body();
  }
  const refused = await request.post("/api/genui", { data: body, headers: client });
  expect([refused.status(), await refused.json()]).toEqual([429, { reason: "GAME_CAP" }]);

  await page.getByRole("button", { name: "Next round" }).click();
  await expect(page.getByText("Round 2 of 5")).toBeVisible();
  await answerRound(page);
  await panel.getByRole("button", { name: "Explain this round" }).click();
  await expect(panel.getByText(FALLBACK)).toBeVisible();
  await expect(page.getByText("The answer:")).toBeVisible();
  await panel.getByRole("button", { name: "Try again" }).click();
  await expect(panel.getByText(FALLBACK)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Try again" })).toHaveCount(0);
  for (let round = 3; round <= 5; round += 1) {
    await page.getByRole("button", { name: "Next round" }).click();
    await expect(page.getByText(`Round ${round} of 5`)).toBeVisible();
    await answerRound(page);
  }
  await expect(page.getByText(/Run complete — /u)).toBeVisible();

  // The browser reports the fallback as limited (#98), and the log holds nothing that names the client.
  await expect.poll(() => storedEvents().slice(from).some(({ type, reason }) => type === "genui_fallback" && reason === "limited")).toBe(true);
  const fallback = storedEvents().slice(from).find(({ type, reason }) => type === "genui_fallback" && reason === "limited")!;
  expect(fallback).toMatchObject({ round: 2, design: "catalog" });
  expect(JSON.stringify(storedEvents().slice(from))).not.toMatch(/198\.51\.100|\b(?:\d{1,3}\.){3}\d{1,3}\b/u);
});

test("a player past the deal limit is told to wait, with no game dealt, while other players still play", async ({ page, request }) => {
  const client = { "X-Forwarded-For": clientAddress() };
  // Each game dealt spends a deal (the redirect to a fresh seed spends nothing), and dealing a game is slow on CI's dev
  // server, so the bucket refills while one deal at a time drains it. Deals go out in concurrent batches until one in the
  // batch is refused, and that refused page is the one checked. They carry `Sec-GPC: 1`, so they record no events in the
  // shared store.
  const deal = async (game: number) =>
    (await request.get(`/?deck=fix&deal=0badcafe&game=${game}`, { headers: { ...client, "Sec-GPC": "1" } })).text();
  let refused: string | undefined;
  for (let batch = 0; refused === undefined && batch * 25 <= 4 * DEAL_BURST * E2E_RATE_LIMITS; batch += 1) {
    const pages = await Promise.all(Array.from({ length: 25 }, (_, index) => deal((batch * 25 + index) % 1000)));
    refused = pages.find((html) => html.includes("Too many new games — wait a minute"));
  }
  expect(refused, "a deal past the burst is refused").toBeDefined();
  expect(refused).not.toContain('class="game-card"');
  expect(refused).toMatch(/<a href="\/\?deck=fix&amp;deal=0badcafe&amp;game=\d+">Try again<\/a>/u);
  expect(refused).toContain(">All decks<");

  // Another player, behind another address, is dealt as usual.
  await page.setExtraHTTPHeaders({ "X-Forwarded-For": clientAddress("203.0.113") });
  await page.goto("/?deck=fix&deal=0badcafe&game=0");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
});
