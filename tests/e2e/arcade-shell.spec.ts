import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// The browser never learns the answers; the test runner reads the generated artifact on the Node side.
interface ArtifactFixture {
  roundId: string; prompt: string; panes: { text: string }[]; candidates: { id: string; label: string; detail: string | null }[];
  correctCandidateId: string; clues: string[];
}
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
/** The header score; its "Score: " prefix is visually hidden text, so it names the score for screen readers. */
const score = (page: Page) => page.locator(".arcade-header .score");

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
  expect(artifact.decks.map(({ id }) => id)).toEqual(["project", "language", "before-after", "algorithm", "output", "fix", "missing-line",
    "name-function", "framework", "exercise"]);
  // The chooser, not the notice, counts the decks this artifact published.
  await expect(page.locator(".deck-intro")).toContainText(/^Ten decks to choose from\. Each game deals five real rounds/u);
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
    // A deck's link starts a fresh seeded deal at its first game (#40).
    await expect(page).toHaveURL(new RegExp(`\\?deck=${deck.id}&deal=[0-9a-f]{8}&game=0$`, "u"));
    const seed = new URL(page.url()).searchParams.get("deal")!;
    await expect(page.getByText(/Local unreviewed experiment/)).toBeVisible();
    if (deck.id === "before-after") await expect(page.locator("figcaption")).toHaveText(["Version A", "Version B"]);

    const first = await answerRounds(page, full, true);
    const hinted = full * 0.8 + 4 * full;
    await expect(score(page)).toHaveText(`Score: ${points(hinted)} pts`);
    await expect(page.getByText(new RegExp(`Run complete — ${points(hinted)} points`, "u"))).toBeVisible();

    // A finished run offers a fresh deal and another deck, never a replay of the rounds it just revealed.
    await expect(page.getByRole("button", { name: "Play again" })).toHaveCount(0);
    const deal = page.getByRole("link", { name: "Deal new rounds" });
    await expect(deal).toHaveAttribute("href", `/?deck=${deck.id}&deal=${seed}&game=1`);
    await expect(deal).toHaveClass(/primary-action/u);
    await deal.click();
    await expect(page.getByText("Round 1 of 5")).toBeVisible();
    await expect(score(page)).toHaveText("Score: 0 pts");
    await expect(page.getByRole("heading", { name: /Nice read\.|Not this time\./u })).toHaveCount(0);
    const second = await answerRounds(page, full, false);
    // The deal's next game shares no round with its first, since every pool holds at least ten (#40).
    expect(second.filter((roundId) => first.includes(roundId))).toEqual([]);
    await expect(page.getByText(new RegExp(`Run complete — ${points(5 * full)} points`, "u"))).toBeVisible();

    await page.getByRole("link", { name: "Choose another deck" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Pick a deck" })).toBeVisible();
  });
}

const deckOfRound = new Map(artifact.decks.flatMap((deck) => deck.fixtures.map((fixture) => [fixture.roundId, deck] as const)));

test("a mixed game deals one round from each of five decks, names each round's deck, and scores to its rounds' best (#56)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: /^Mixed/u }).click();
  await expect(page).toHaveURL(/\?deck=mixed&deal=[0-9a-f]{8}&game=0$/u);
  const decks: string[] = [];
  let best = 0;
  for (let index = 0; index < 5; index += 1) {
    if (index > 0) await page.getByRole("button", { name: "Next round" }).click();
    await expect(page.getByText(`Round ${index + 1} of 5`)).toBeVisible();
    const roundId = await currentRound(page);
    const deck = deckOfRound.get(roundId)!;
    decks.push(deck.id);
    best += fullPoints(deck);
    await expect(page.locator(".eyebrow .round-deck")).toHaveText(deck.title);
    await page.getByLabel(answers.get(roundId)!, { exact: true }).check();
    await page.getByRole("button", { name: "Lock in answer" }).click();
    await expect(page.getByRole("heading", { name: "Nice read." })).toBeVisible();
  }
  expect(new Set(decks).size).toBe(5);
  await expect(score(page)).toHaveText(`Score: ${points(best)} pts`);
  await expect(page.getByText(new RegExp(`Run complete — ${points(best)} points`, "u"))).toBeVisible();
  await expect(page.getByRole("link", { name: "Deal new rounds" })).toHaveAttribute("href", /^\/\?deck=mixed&deal=[0-9a-f]{8}&game=1$/u);
});

test("today's five deals the same five, in the same order, on every load of the day (#74)", async ({ page }) => {
  await page.goto("/");
  const card = page.getByRole("link", { name: /^Today’s five/u });
  await expect(card).toContainText(/\d{4}-\d{2}-\d{2}/u);
  await card.click();
  await expect(page).toHaveURL(/\?deck=daily&date=\d{4}-\d{2}-\d{2}$/u);
  const dealt = async () => {
    await expect(page.getByText("Round 1 of 5")).toBeVisible();
    return { round: await currentRound(page), options: await page.locator(".candidate").allTextContents() };
  };
  const first = await dealt();
  await page.reload();
  expect(await dealt()).toEqual(first);
  await expect(page.locator(".eyebrow .round-deck")).toHaveText(deckOfRound.get(first.round)!.title);
});

test("a seeded deal's game reloads to the same rounds and options, and says when it starts its deck over (#40)", async ({ page }) => {
  await page.goto("/?deck=project&deal=0a1b2c3d&game=1");
  const shown = async () => {
    await expect(page.getByText("Round 1 of 5")).toBeVisible();
    return { round: await currentRound(page), options: await page.locator(".candidate").allTextContents() };
  };
  const first = await shown();
  await page.reload();
  expect(await shown()).toEqual(first);
  await expect(page.locator(".deal-note")).toHaveCount(0);
  // A pool of n rounds is spent after floor(n / 5) games, so the next one starts it over (30 before-after rounds: game 6).
  const pool = artifact.decks.find(({ id }) => id === "before-after")!.fixtures.length;
  await page.goto(`/?deck=before-after&deal=0a1b2c3d&game=${Math.floor(pool / 5)}`);
  await expect(page.locator(".deal-note")).toHaveText("You’ve now seen every round in this deck, so this game starts it over.");
});

test("a deck query parameter preselects the deck, and a wrong answer scores zero and shows the right one", async ({ page }) => {
  await page.goto("/?deck=before-after");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  const round = await currentRound(page);
  await page.getByLabel(wrongAnswers.get(round)!, { exact: true }).check();
  await page.getByRole("button", { name: "Lock in answer" }).click();
  await expect(page.getByRole("heading", { name: "Not this time." })).toBeVisible();
  await expect(page.locator(".reveal .round-points")).toHaveText("0 points (no hints)");
  await expect(score(page)).toHaveText("Score: 0 pts");
  await expect(page.locator(".candidate.missed")).toContainText(wrongAnswers.get(round)!);
  await expect(page.locator(".candidate.correct")).toContainText(answers.get(round)!);
  await expect(page.getByText(`The answer: ${answers.get(round)!}`)).toBeVisible();
  await page.getByRole("link", { name: "All decks" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Pick a deck" })).toBeVisible();
});

test("a dealt page carries no hint text until the player buys a hint", async ({ page }) => {
  // Each hint's longest run free of characters HTML or the page's serialized props would escape.
  const plain = (text: string): string => (text.match(/[^&<>"'\\\n]{10,}/gu) ?? []).sort((left, right) => right.length - left.length)[0] ?? "";
  for (const deck of artifact.decks) {
    const html = await (await page.request.get(`/?deck=${deck.id}`)).text();
    // The shell renders in the browser; its props, the dealt session included, travel in the page's flight data.
    expect(html).toContain("sessionToken");
    // A hint may quote what the round already shows, such as the call an output round asks about.
    const shown = deck.fixtures.flatMap(({ prompt, panes, candidates }) =>
      [prompt, ...panes.map(({ text }) => text), ...candidates.flatMap(({ label, detail }) => [label, detail ?? ""])]).join("\n");
    const fragments = deck.fixtures.flatMap(({ clues }) => clues.map(plain)).filter((fragment) => fragment !== "" && !shown.includes(fragment));
    expect(fragments.length).toBeGreaterThan(deck.fixtures.length);
    for (const fragment of fragments) expect(html).not.toContain(fragment);
  }
  await page.goto("/?deck=project");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  const round = await currentRound(page);
  await page.getByRole("button", { name: "Reveal hint 1" }).click();
  await expect(page.locator(".hints .hint")).toHaveText([artifact.decks[0]!.fixtures.find(({ roundId }) => roundId === round)!.clues[0]!]);
});

test("a game the server can no longer continue says so and offers a fresh deal", async ({ page }) => {
  await page.goto("/?deck=language");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  // A token from a restarted server, or one edited in the browser, fails its signature.
  await page.route("**/*", (route) => {
    const body = route.request().postData();
    return body?.includes("sessionToken")
      ? route.continue({ postData: body.replace(/"sessionToken":"[^"]*"/u, '"sessionToken":"ended.game"') })
      : route.continue();
  });
  await page.getByRole("button", { name: "Reveal hint 1" }).click();
  const alert = page.getByRole("main").getByRole("alert");
  await expect(alert).toHaveText("This game can’t continue. Deal new rounds to keep playing. Deal new rounds");
  await expect(page.locator(".hints .hint")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Lock in answer" })).toBeDisabled();
  await page.unrouteAll();
  await alert.getByRole("link", { name: "Deal new rounds" }).click();
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
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

test.describe("in a de-DE browser", () => {
  test.use({ locale: "de-DE" });

  test("the header and round track name the score and the current round, with en-US numbers", async ({ page }) => {
    await page.goto("/?deck=project");
    await expect(page.getByText("Round 1 of 5")).toBeVisible();
    expect(await page.evaluate(() => navigator.language)).toBe("de-DE");
    await expect(page.locator(".arcade-header")).toMatchAriaSnapshot(`
      - link "CODEGUESSR"
      - text: "Score: 0 pts"
    `);
    await expect(page.getByRole("list", { name: "Round progress" })).toMatchAriaSnapshot(`
      - list "Round progress":
        - listitem: Round 1, current
        - listitem: Round 2
        - listitem: Round 3
        - listitem: Round 4
        - listitem: Round 5
    `);
    await expect(page.locator('.round-track [aria-current="step"]')).toHaveAttribute("data-round-nav", "1");
    await expect(page.getByRole("group", { name: "Hints" })).toBeVisible();

    await page.getByLabel(answers.get(await currentRound(page))!, { exact: true }).check();
    await page.getByRole("button", { name: "Lock in answer" }).click();
    await expect(page.locator(".reveal .round-points")).toHaveText("+1,000 points (no hints)");
    await expect(score(page)).toHaveText("Score: 1,000 pts");
    await expect(page.locator(".arcade-header")).toMatchAriaSnapshot(`
      - link "CODEGUESSR"
      - text: "Score: 1,000 pts"
    `);
    await page.getByRole("button", { name: "Next round" }).click();
    await expect(page.getByRole("list", { name: "Round progress" })).toMatchAriaSnapshot(`
      - list "Round progress":
        - listitem: Round 1, correct
        - listitem: Round 2, current
        - listitem: Round 3
        - listitem: Round 4
        - listitem: Round 5
    `);
    await expect(page.locator('.round-track [aria-current="step"]')).toHaveAttribute("data-round-nav", "2");
  });
});

test("a finished game lists every round in a summary that adds up, and the dots mark each right or missed (#43, #126)", async ({ page }) => {
  await page.goto("/?deck=fix");
  const picks: boolean[] = [];
  for (let index = 0; index < 5; index += 1) {
    if (index > 0) await page.getByRole("button", { name: "Next round" }).click();
    await expect(page.getByText(`Round ${index + 1} of 5`)).toBeVisible();
    const roundId = await currentRound(page);
    const right = index !== 1;
    picks.push(right);
    await page.getByLabel((right ? answers : wrongAnswers).get(roundId)!, { exact: true }).check();
    await page.getByRole("button", { name: "Lock in answer" }).click();
    await expect(page.getByRole("heading", { name: right ? "Nice read." : "Not this time." })).toBeVisible();
    // Why the answer is right opens by keyboard, and closes again.
    if (index === 0) {
      const why = page.locator(".reveal-why");
      await expect(why).toHaveAttribute("open", "");
      await why.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(why).not.toHaveAttribute("open", "");
      await page.keyboard.press("Enter");
      await expect(why).toHaveAttribute("open", "");
    }
  }
  // Each played round's dot says right or missed: by colour, by a mark, and in words.
  await expect(page.locator(".round-dot.done.correct")).toHaveCount(3);
  await expect(page.locator(".round-dot.done.missed")).toHaveCount(1);
  await expect(page.locator('.round-dot[data-round-nav="2"]')).toContainText("✗");
  await expect(page.locator('.round-dot[data-round-nav="2"] .visually-hidden')).toHaveText("Round 2, missed");

  const summary = page.getByRole("region", { name: "Your game" });
  await expect(summary.locator("tbody tr")).toHaveCount(5);
  const rowPoints = (await summary.locator("tbody tr td:nth-child(4)").allTextContents()).map((text) => Number(text.split(" ")[0]!.replaceAll(",", "")));
  expect(rowPoints).toHaveLength(5);
  const total = (await score(page).textContent())!.match(/[\d,]+/u)![0]!;
  expect(points(rowPoints.reduce((sum, value) => sum + value, 0))).toBe(total);
  await expect(summary.locator("tfoot")).toContainText(`${total} of 5,000`);
  await expect(summary.locator("tbody tr").nth(1)).toHaveClass(/summary-missed/u);
  // The way on sits right under the summary, above why the last answer is right.
  const order = await page.locator(".reveal").evaluate((reveal) =>
    [".game-summary", ".completion-actions", ".reveal-why"].map((selector) => [...reveal.querySelectorAll("*")].indexOf(reveal.querySelector(selector)!)));
  expect([...order].sort((left, right) => left - right)).toEqual(order);
});

test("a round plays from the keyboard alone: Tab, arrows, Enter, and the N, number, and H shortcuts (#71)", async ({ page }) => {
  await page.goto("/?deck=fix");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  const answer = answers.get(await currentRound(page))!;
  // Tab to the options, then arrow to the answer; Enter on it locks it in.
  for (let presses = 0; presses < 30 && !(await page.evaluate(() => (document.activeElement as HTMLInputElement | null)?.type === "radio")); presses += 1) {
    await page.keyboard.press("Tab");
  }
  for (let presses = 0; presses < 4 && (await page.evaluate(() => (document.activeElement as HTMLInputElement).getAttribute("aria-label"))) !== answer; presses += 1) {
    await page.keyboard.press("ArrowDown");
  }
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Nice read." })).toBeFocused();
  // N moves on; 2 picks the second option; H buys a hint; Enter locks in.
  await page.keyboard.press("n");
  await expect(page.getByText("Round 2 of 5")).toBeVisible();
  await page.keyboard.press("h");
  await expect(page.getByRole("button", { name: "Reveal hint 2" })).toBeVisible();
  await page.keyboard.press("2");
  await expect(page.getByRole("group", { name: "Choose one answer" }).getByRole("radio").nth(1)).toBeChecked();
  await expect(page.getByRole("group", { name: "Choose one answer" }).getByRole("radio").nth(1)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: /Nice read\.|Not this time\./u })).toBeVisible();
  await expect(page.locator(".keys-note")).toContainText("Enter locks in");
});

test("on a phone no fix option's code is cut off, and wrapped lines keep their indentation (#46, #85)", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/?deck=fix");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  const truncated = await page.locator(".code-detail").evaluateAll((details) => details.filter((detail) => detail.scrollWidth > detail.clientWidth + 1).length);
  expect(truncated).toBe(0);
  const pane = page.locator(".code-window").first();
  await page.getByRole("button", { name: "Wrap lines" }).click();
  await expect(page.getByRole("button", { name: "Wrap lines" })).toHaveAttribute("aria-pressed", "true");
  // Every round of the game, since a deeply indented line in any of them once pushed the pane past its edge.
  for (let round = 1; round <= 5; round += 1) {
    if (round > 1) {
      await page.getByRole("group", { name: "Choose one answer" }).getByRole("radio").first().check();
      await page.getByRole("button", { name: "Lock in answer" }).click();
      await page.getByRole("button", { name: "Next round" }).click();
      await expect(page.getByText(`Round ${round} of 5`)).toBeVisible();
    }
    expect(await pane.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), `round ${round}`).toBe(true);
  }
  // An indented line wraps under its own indentation, past its number.
  const hanging = await page.locator(".code-line").evaluateAll((lines) => lines.map((line) => ({
    indent: (line as HTMLElement).style.getPropertyValue("--indent"), padding: parseFloat(getComputedStyle(line).paddingLeft),
  })));
  const flat = hanging.find(({ indent }) => indent === "0ch")!;
  const indented = hanging.find(({ indent }) => indent !== "0ch")!;
  expect(indented.padding).toBeGreaterThan(flat.padding);
  // Every line isolates its own text direction, so a right-to-left string can't reorder the code around it.
  expect(await pane.locator(".code-line").first().evaluate((line) => getComputedStyle(line).unicodeBidi)).toBe("plaintext");
});
