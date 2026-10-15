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
  await page.goto("/?deck=language&design=catalog");
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
  await page.goto("/?deck=project&design=catalog");
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

test("the composer design lays out its own panel, and the switcher moves between designs", async ({ page, request }) => {
  await page.goto("/?deck=language&design=composer");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  const designs = page.getByRole("navigation", { name: "Designs" });
  await expect(designs.getByRole("link", { name: "Composer explainer" })).toHaveAttribute("aria-current", "page");
  await answerRound(page);
  const panel = page.getByRole("region", { name: "Explainer" });
  await expect(panel).toHaveAttribute("data-genui-design", "composer");
  await panel.getByRole("button", { name: "Explain this round" }).click();
  await expect(panel.locator(".composer-callout")).toHaveText("The tell The first line already gives it away.");
  await expect(panel.locator("figcaption")).toHaveText("Lines 1–1");
  await expect(panel.locator(".genui-notes li")).toHaveText("Line 1, points to the answer: Read this line first.");
  const quiz = panel.getByRole("group", { name: "What should you read first?" });
  await quiz.getByLabel("The keywords").check();
  await expect(quiz.locator(".composer-feedback")).toHaveText("Right. Keywords name the language fastest.");
  const recorded = await (await request.get(`${fake}/requests`)).json() as { body: { tools: { function: { name: string } }[] } }[];
  expect(recorded[0]!.body.tools.map(({ function: { name } }) => name)).toEqual(["compose_panel"]);

  await designs.getByRole("link", { name: "Static" }).click();
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  await answerRound(page);
  await expect(page.getByRole("region", { name: "Explainer" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "All decks" })).toBeVisible();
});

test("the visualizer runs the model's page in a sandbox that can't reach the game, storage, or the network", async ({ page, request }) => {
  await page.goto("/?deck=algorithm&design=visualizer");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  await answerRound(page);
  const panel = page.getByRole("region", { name: "Visualizer" });
  await panel.getByRole("button", { name: "Visualize this round" }).click();
  const frame = panel.locator("iframe.visualizer-frame");
  await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  await expect(frame).toHaveAttribute("title", "Stepping through the round");
  await expect(panel.locator(".visualizer-summary")).toHaveText("A counter that advances one step per press.");
  // The page spelled its escapes in pieces to pass the server's checks; only the sandbox and its CSP stop them.
  const inside = page.frameLocator("iframe.visualizer-frame");
  await expect(inside.locator("#isolation")).toHaveText("isolated");
  await expect(inside.locator("#storage")).toHaveText("blocked");
  await inside.getByRole("button", { name: "Step" }).click();
  await expect(inside.locator("#status")).toHaveText("Step 1");
  // The frame fits its page: the game's own reporter sets its height, so a short page gets no empty box.
  await expect.poll(async () => frame.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(480);
  // ...and holds it: a report that fed back into itself would grow the frame on every resize.
  const settled = await frame.evaluate((element) => element.getBoundingClientRect().height);
  await page.waitForTimeout(1000);
  expect(await frame.evaluate((element) => element.getBoundingClientRect().height)).toBe(settled);
  await page.waitForTimeout(500);
  expect(await (await request.get(`${fake}/leaks`)).text()).toBe("0");
  await expect(page.getByRole("button", { name: "Next round" })).toBeEnabled();
});

test("the host chats during the round without the code, sells the next hint on request, and talks code after the lock", async ({ page, request }) => {
  await page.goto("/?deck=project&design=host");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  const host = page.getByRole("complementary", { name: "Host" });
  await expect(host).toContainText("The host hasn’t seen the code and can’t tell you the answer.");
  await host.getByLabel("Ask the host").fill("Any tips?");
  await host.getByRole("button", { name: "Send" }).click();
  await expect(host.locator(".host-turn.player")).toHaveText("You: Any tips?");
  await expect(host.locator(".genui-host")).toHaveText("I can't see the code yet, but I can cheer you on.");
  const offer = host.getByRole("button", { name: "Buy hint 1 (−200 pts)" });
  await offer.click();
  await expect(page.locator(".hints .hint")).toHaveCount(1);
  await expect(host.getByRole("button", { name: "Buy hint 2 (−300 pts)" })).toBeVisible();
  const before = await (await request.get(`${fake}/requests`)).json() as { body: { tools: { function: { name: string } }[] } }[];
  expect(before[0]!.body.tools.map(({ function: { name } }) => name)).toEqual(["host_message", "offer_hint"]);

  await answerRound(page);
  await expect(page.locator(".reveal .round-points")).toHaveText("+800 points (1 hint)");
  await expect(host).toContainText("The round is over: ask about the code.");
  await expect(host.getByRole("button", { name: /Buy hint/u })).toHaveCount(0);
  await host.getByLabel("Ask the host").fill("Why was that the answer?");
  await host.getByRole("button", { name: "Send" }).click();
  await expect(host.locator(".genui-takeaway")).toHaveText("Takeaway: Read the keywords before the punctuation.");
  const after = await (await request.get(`${fake}/requests`)).json() as { body: { tools: { function: { name: string } }[] } }[];
  // After the lock the host answers in chat-sized pieces, not with the explainer's code views and tables.
  expect(after.at(-1)!.body.tools.map(({ function: { name } }) => name)).toEqual(["host_message", "takeaway", "signal_list"]);
  await page.getByRole("button", { name: "Next round" }).click();
  await expect(page.getByRole("complementary", { name: "Host" }).locator(".host-turn")).toHaveCount(0);
});

test("the host recovers from a refused paste, shows a plain-text reply, and keeps keyboard focus in its input", async ({ page, request }) => {
  await page.goto("/?deck=language&design=host");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  const round = (await page.locator(".game-card").getAttribute("data-round-id"))!;
  const pasted = fixtures.get(round)!.panes[0]!.text.split("\n").find((line) => line.trim().length >= 12)!.trim();
  const host = page.getByRole("complementary", { name: "Host" });
  const input = host.getByLabel("Ask the host");
  await input.fill(`What language is ${pasted}`);
  await input.press("Enter");
  await expect(host.getByRole("alert")).toHaveText("The host can’t look at code before you lock in. Ask without pasting it.");
  await expect(host.locator(".host-turn.player")).toHaveCount(0);
  await expect(input).toBeFocused();
  // The refused message left the history, so the next question goes through.
  await request.post(`${fake}/control`, { data: { text: "Happy to help with the rules!" } });
  await input.fill("How do hints work?");
  await input.press("Enter");
  await expect(host.locator(".host-turn.host .genui-host")).toHaveText("Happy to help with the rules!");
  await expect(host.getByRole("alert")).toHaveCount(0);
  await expect(input).toBeFocused();
  const recorded = await (await request.get(`${fake}/requests`)).json() as { body: { messages: unknown[] } }[];
  expect(JSON.stringify(recorded.at(-1)!.body.messages)).not.toContain(pasted.slice(0, 12));
});

test("asking for an explanation moves focus to the explainer's output", async ({ page }) => {
  await page.goto("/?deck=fix&design=catalog");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  await answerRound(page);
  const panel = page.getByRole("region", { name: "Explainer" });
  await panel.getByRole("button", { name: "Explain this round" }).click();
  await expect(panel.locator(".genui-output")).toBeFocused();
  await expect(panel.locator(".genui-takeaway")).toBeVisible();
});
