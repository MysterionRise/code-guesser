import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";

// Duel challenge links (#173), played by two people in two browser contexts: the challenger's game and its link, the
// friend's intro and game of it with the challenger's rounds shown one lock at a time, the comparison, the result link,
// a rematch, a second play, refused links, two tabs of one browser, and each page's accessibility.
interface Fixture { roundId: string; candidates: { id: string; label: string }[]; correctCandidateId: string }
const artifact = JSON.parse(readFileSync(resolve(process.cwd(), "apps/game/src/demo/generated/local-real-rounds.json"), "utf8")) as
  { decks: { fixtures: Fixture[] }[] };
const fixtures = new Map(artifact.decks.flatMap(({ fixtures: deckFixtures }) => deckFixtures.map((fixture) => [fixture.roundId, fixture] as const)));

const THEMES = { terminal: "rgb(7, 18, 15)", paper: "rgb(247, 243, 234)", contrast: "rgb(0, 0, 0)" } as const;
const GRID = /[🟩🟨⬛]/u;
const ANSWER_DATA = /correctCandidateId|answerCandidateId/u;

const violations = async (page: Page) => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze()).violations
  .map(({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.join(" ")).slice(0, 3).join(", ")}`);
const noHorizontalScroll = () => document.documentElement.scrollWidth <= document.documentElement.clientWidth;
const background = (page: Page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);

/** A player in a browser context of their own, with a clipboard and no share sheet, so every link is copied. */
const player = async (browser: Browser, baseURL: string | undefined, width = 1280) => {
  const context = await browser.newContext({ ...(baseURL ? { baseURL } : {}), viewport: { width, height: 800 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.addInitScript(() => { delete (Navigator.prototype as { share?: unknown }).share; });
  return { context, page: await context.newPage() };
};

/** How the test plays a round: the hints it buys, and whether it picks the answer. */
interface Plan { readonly hints: number; readonly right: boolean }
const RIGHT: Plan = { hints: 0, right: true };
/** What a round showed: its id, its options in order, whether it carried a question layer, and its answer. */
interface Seen { readonly roundId: string; readonly options: readonly string[]; readonly scaffold: boolean; readonly answer: string }

/** Plays the round on screen to the verdict, and says what it showed. */
const playRound = async (page: Page, { hints, right }: Plan): Promise<Seen> => {
  const roundId = (await page.locator(".game-card").getAttribute("data-round-id"))!;
  const options = await page.locator('.answer-form input[type="radio"]').evaluateAll((inputs) => inputs.map((input) => input.getAttribute("aria-label")!));
  const scaffold = await page.locator(".question-scaffold").count() > 0;
  for (let hint = 1; hint <= hints; hint += 1) {
    await page.getByRole("button", { name: `Reveal hint ${hint}` }).click();
    await expect(page.locator(".hints .hint")).toHaveCount(hint);
  }
  const fixture = fixtures.get(roundId)!;
  const answer = fixture.candidates.find(({ id }) => id === fixture.correctCandidateId)!.label;
  await page.getByLabel(right ? answer : fixture.candidates.find(({ id }) => id !== fixture.correctCandidateId)!.label, { exact: true }).check();
  await page.getByRole("button", { name: "Lock in answer" }).click();
  await expect(page.getByRole("heading", { name: right ? "Nice read." : "Not this time." })).toBeVisible();
  return { roundId, options, scaffold, answer };
};

/** Plays a whole game by plan. */
const playGame = async (page: Page, plans: readonly Plan[]): Promise<Seen[]> => {
  const played: Seen[] = [];
  for (const [index, plan] of plans.entries()) {
    if (index > 0) await page.getByRole("button", { name: "Next round" }).click();
    await expect(page.getByText(`Round ${index + 1} of 5`)).toBeVisible();
    played.push(await playRound(page, plan));
  }
  return played;
};

/** Makes the finished game a challenge, naming its player when a name is given, and returns the link it copied. */
const challengeLink = async (page: Page, name: string): Promise<string> => {
  await page.getByRole("button", { name: "Challenge a friend" }).click();
  const field = page.getByLabel("Your name (stays in the link)");
  await expect(field).toBeFocused();
  await field.fill(name);
  await page.getByRole("button", { name: "Copy challenge link" }).click();
  await expect(page.locator(".duel-share .share-status")).toHaveText("Challenge link copied");
  return (await page.evaluate(() => navigator.clipboard.readText())).split("\n").at(-1)!;
};

/** Sends the friend's result, naming them, and returns the link it copied. */
const resultLink = async (page: Page, name: string): Promise<{ text: string; link: string }> => {
  await page.getByLabel("Your name (stays in the link)").fill(name);
  await page.getByRole("button", { name: "Copy result link" }).click();
  await expect(page.locator(".duel-share .share-status")).toHaveText("Result link copied");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  return { text, link: text.split("\n").at(-1)! };
};

/** The challenger's rounds beside the friend's game, as the eye sees each one. */
const stripMarks = (page: Page): Promise<string[]> => page.locator('.duel-strip li > [aria-hidden="true"]').allTextContents();
/** A page's words, for checking that no answer is among them. */
const wordsOf = async (locator: Locator): Promise<Set<string>> => new Set((await locator.innerText()).split(/[\s·,.:;()]+/u));

const CHALLENGER: readonly Plan[] = [{ hints: 1, right: true }, { hints: 0, right: false }, RIGHT, RIGHT, RIGHT];

test("a friend plays the challenger's very game, sees each of their rounds only after locking it, and sends back a result", async ({ browser, baseURL }) => {
  test.setTimeout(240_000);
  const ana = await player(browser, baseURL);
  const ben = await player(browser, baseURL);

  // The challenger plays a layered game in the paper theme: one round after a hint, one missed.
  await ana.page.goto("/?deck=language&theme=paper&layer=on");
  const played = await playGame(ana.page, CHALLENGER);
  const anaDeal = new URL(ana.page.url()).searchParams.get("deal");
  await expect(ana.page.locator(".arcade-header .score")).toContainText("3,800 pts");
  const link = await challengeLink(ana.page, "Ana");
  const shared = await ana.page.evaluate(() => navigator.clipboard.readText());
  // The challenge's share line has the total to beat and no grid: the challenger's rounds stay hidden.
  expect(shared).toBe(`CodeGuessr duel · Which language? · Ana scored 3,800/5,000. Can you beat it?\n${link}`);
  expect(link).toMatch(new RegExp(`^${baseURL}/\\?duel=[A-Za-z0-9_-]+#from=Ana$`, "u"));
  expect(link.length).toBeLessThan(1_200);

  // The intro names the challenger from the fragment, the deck, and the total, and deals nothing; it is never indexed.
  await ben.page.goto(link);
  await expect(ben.page.getByRole("heading", { level: 1 })).toHaveText("Ana challenges you");
  await expect(ben.page.locator(".duel-deck")).toHaveText("Which language?");
  await expect(ben.page.locator(".duel-total")).toHaveText("4/5 right · 3,800 of 5,000");
  await expect(ben.page.locator(".duel-badge")).toHaveText("First try");
  expect(await ben.page.getByRole("main").innerText()).not.toMatch(GRID);
  expect(await background(ben.page)).toBe(THEMES.paper);
  const head = (await (await ben.page.request.get(link.split("#")[0]!, { headers: { "user-agent": "Slackbot-LinkExpanding 1.0" } })).text()).split("</head>")[0]!;
  expect(head).toMatch(/<meta name="robots" content="noindex, nofollow"\/?>/u);
  expect(head).toContain("<title>Duel: Which language? · CodeGuessr</title>");
  expect(head).not.toMatch(/\bAna\b/u);

  // "Play the same five" keeps the name in the fragment. The friend's game ignores a lab pick of theme.
  await ben.page.getByRole("link", { name: "Play the same five" }).click();
  await expect(ben.page).toHaveURL(new RegExp(`\\?duel=[A-Za-z0-9_-]+&play=1#from=Ana$`, "u"));
  await expect(ben.page.getByText("Round 1 of 5")).toBeVisible();
  await ben.page.goto(`${link.replace("#", "&play=1&theme=arcade#")}`);
  await expect(ben.page.getByText("Round 1 of 5")).toBeVisible();
  await expect.poll(() => background(ben.page)).toBe(THEMES.paper);
  await expect(ben.page.getByRole("navigation", { name: "Themes" })).toHaveCount(0);
  await expect(ben.page.getByRole("list", { name: "Ana’s rounds" })).toBeVisible();

  const lines = ["Ana: right, 1 hint, +800 points.", "Ana: missed, no hints, 0 points.", ...Array(3).fill("Ana: right, no hints, +1,000 points.")];
  const marks = ["1 ✓", "2 ✗", "3 ✓", "4 ✓", "5 ✓"];
  const answered: Seen[] = [];
  for (let round = 0; round < 5; round += 1) {
    if (round > 0) await ben.page.getByRole("button", { name: "Next round" }).click();
    await expect(ben.page.getByText(`Round ${round + 1} of 5`)).toBeVisible();
    // Only the rounds already locked show the challenger's result, and the page holds no answer.
    expect(await stripMarks(ben.page)).toEqual([...marks.slice(0, round), ...Array(5 - round).fill("?")]);
    await expect(ben.page.locator(".duel-strip li").nth(round)).toContainText(`Round ${round + 1}, shown after you answer`);
    expect(await ben.page.content()).not.toMatch(ANSWER_DATA);
    const seen = await playRound(ben.page, RIGHT);
    // The same round, the same options in the same order, and the same question layer as the challenger's.
    expect(seen).toEqual(played[round]);
    answered.push(seen);
    // Once locked, the round shows the challenger's result, and the reveal's live region says it.
    expect(await stripMarks(ben.page)).toEqual([...marks.slice(0, round + 1), ...Array(4 - round).fill("?")]);
    await expect(ben.page.locator(".reveal .duel-line")).toHaveText(lines[round]!);
  }
  expect(played.some(({ scaffold }) => scaffold)).toBe(true);

  // The comparison, under the friend's own summary.
  const comparison = ben.page.locator(".duel-comparison");
  await expect(ben.page.getByRole("heading", { level: 3, name: "Your game" })).toBeVisible();
  await expect(comparison.getByRole("heading", { level: 3 })).toHaveText("You win by 1,200 points");
  await expect(comparison.locator("caption")).toHaveText("Both games, round by round");
  await expect(comparison.locator("thead th")).toHaveText(["#", "You", "Ana"]);
  await expect(comparison.locator("tbody tr").first().locator("td")).toHaveText(["✓ 1,000, right", "✓ 800, right (1 hint)"]);
  await expect(comparison.locator("tbody tr").nth(1).locator("td")).toHaveText(["✓ 1,000, right", "✗ 0, missed"]);
  await expect(comparison.locator("tfoot td")).toHaveText(["5,000 (5 right, no hints)", "3,800 (4 right, 1 hint)"]);
  await expect(comparison.getByText("First try for Ana")).toBeVisible();

  const result = await resultLink(ben.page, "Ben");
  expect(result.text).toBe(`CodeGuessr duel · Which language? · Ben wins by 1,200 points\nBen 🟩🟩🟩🟩🟩 5,000/5,000\nAna 🟨⬛🟩🟩🟩 3,800/5,000\n${result.link}`);
  expect(result.link).toMatch(new RegExp(`^${baseURL}/\\?duel-result=[A-Za-z0-9_-]+#from=Ana&vs=Ben$`, "u"));

  // The challenger opens the result: read-only, the verdict worked out again, and none of the answers.
  await ana.page.goto(result.link);
  await expect(ana.page.getByRole("heading", { level: 1 })).toHaveText("Ben vs Ana");
  await expect(ana.page.getByRole("heading", { level: 2 })).toHaveText("Ben wins by 1,200 points");
  await expect(ana.page.locator(".duel-comparison thead th")).toHaveText(["#", "Ben", "Ana"]);
  await expect(ana.page.getByRole("radio")).toHaveCount(0);
  const words = await wordsOf(ana.page.getByRole("main"));
  for (const { answer } of answered) expect(words.has(answer), answer).toBe(false);
  const html = await ana.page.content();
  for (const { roundId } of answered) {
    expect(html).not.toContain(roundId);
    for (const { id } of fixtures.get(roundId)!.candidates) expect(html).not.toContain(id);
  }

  // A rematch is a fresh deal of the deck, not the challenger's next game.
  await ben.page.getByRole("link", { name: "Rematch" }).click();
  await expect(ben.page).toHaveURL(/\?deck=language&deal=[0-9a-f]{8}&game=0$/u);
  expect(new URL(ben.page.url()).searchParams.get("deal")).not.toBe(anaDeal);

  // A second play of the same link says so, in the friend's game and on its result.
  await ben.page.goto(link);
  await ben.page.getByRole("link", { name: "Play the same five" }).click();
  await playGame(ben.page, Array(5).fill({ hints: 0, right: false }));
  await expect(ben.page.locator(".duel-comparison").getByRole("heading", { level: 3 })).toHaveText("Ana wins by 3,800 points");
  await expect(ben.page.getByText("Your 2nd play of this link")).toBeVisible();
  const second = await resultLink(ben.page, "Ben");
  await ana.page.goto(second.link);
  await expect(ana.page.getByText("Ben’s 2nd play of this link")).toBeVisible();
  await ana.context.close();
  await ben.context.close();
});

test("a link the server didn't seal, or that names no token, is refused in words", async ({ page }) => {
  for (const [path, message] of [
    ["/?duel=not-a-challenge", "This challenge link isn’t valid."],
    ["/?duel=not-a-challenge&play=1", "This challenge link isn’t valid."],
    ["/?duel=", "This challenge link isn’t valid."],
    ["/?duel-result=not-a-result", "This result link isn’t valid."],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 }), path).toHaveText(message);
    await expect(page.getByRole("link", { name: "Choose another deck" })).toHaveAttribute("href", "/");
    await expect(page.getByText("Round 1 of 5")).toHaveCount(0);
  }
});

test("two tabs of one browser share nothing: the friend's tab names only what its own link carries", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const { context, page: first } = await player(browser, baseURL);
  await first.goto("/?deck=algorithm");
  await playGame(first, Array(5).fill(RIGHT));
  const link = await challengeLink(first, "Ana");
  const total = await first.locator(".arcade-header .score").innerText();

  // The second tab opens the link without its fragment: the name typed in the first tab went nowhere else.
  const second = await context.newPage();
  await second.goto(link.split("#")[0]!);
  await expect(second.getByRole("heading", { level: 1 })).toHaveText("A friend challenges you");
  await second.getByRole("link", { name: "Play the same five" }).click();
  await expect(second.getByText("Round 1 of 5")).toBeVisible();
  // This browser played every round of the challenge, yet the friend's tab shows only the round it has locked.
  expect(await stripMarks(second)).toEqual(["?", "?", "?", "?", "?"]);
  await playRound(second, RIGHT);
  expect(await stripMarks(second)).toEqual(["1 ✓", "?", "?", "?", "?"]);
  await expect(second.locator(".reveal .duel-line")).toHaveText("A friend: right, no hints, +1,000 points.");
  // The first tab's finished game is as it was, and neither tab keeps anything in storage but the player's own records
  // (#63), which name no one and hold no round.
  await expect(first.locator(".arcade-header .score")).toHaveText(total);
  await expect(first.locator(".duel-share .share-status")).toHaveText("Challenge link copied");
  await expect(first.locator(".duel-strip")).toHaveCount(0);
  for (const tab of [first, second]) {
    expect(await tab.evaluate(() => ({ local: Object.keys(localStorage), session: sessionStorage.length }))).toEqual({ local: ["codeguessr.records"], session: 0 });
  }
  const kept = await first.evaluate(() => localStorage.getItem("codeguessr.records")!);
  expect(kept).not.toContain("Ana");
  expect(Object.keys((JSON.parse(kept) as { decks: object }).decks)).toEqual(["algorithm"]);
  expect(await context.cookies()).toEqual([]);
  await context.close();
});

for (const theme of ["terminal", "contrast"] as const) {
  test(`in the ${theme} theme, every duel page passes axe, fits 320 px, and works from the keyboard`, async ({ browser, baseURL }) => {
    test.setTimeout(180_000);
    const ana = await player(browser, baseURL, 320);
    const ben = await player(browser, baseURL, 320);
    await ana.page.goto(`/?deck=fix&theme=${theme}`);
    await playGame(ana.page, [{ hints: 1, right: true }, { hints: 0, right: false }, RIGHT, RIGHT, RIGHT]);
    // "Challenge a friend" from the keyboard: the name field takes focus, and Enter on the button copies the link.
    await ana.page.getByRole("button", { name: "Challenge a friend" }).focus();
    await ana.page.keyboard.press("Enter");
    await expect(ana.page.getByLabel("Your name (stays in the link)")).toBeFocused();
    await ana.page.keyboard.type("Ana");
    await ana.page.keyboard.press("Tab");
    await expect(ana.page.getByRole("button", { name: "Copy challenge link" })).toBeFocused();
    await ana.page.keyboard.press("Enter");
    await expect(ana.page.locator(".duel-share .share-status")).toHaveText("Challenge link copied");
    expect(await ana.page.evaluate(noHorizontalScroll)).toBe(true);
    expect(await violations(ana.page)).toEqual([]);
    const link = (await ana.page.evaluate(() => navigator.clipboard.readText())).split("\n").at(-1)!;

    // The intro: axe, the narrow screen, and "Play the same five" reached by Tab alone.
    await ben.page.goto(link);
    await expect(ben.page.getByRole("heading", { level: 1 })).toHaveText("Ana challenges you");
    await expect.poll(() => background(ben.page)).toBe(THEMES[theme]);
    expect(await ben.page.evaluate(noHorizontalScroll)).toBe(true);
    expect(await violations(ben.page)).toEqual([]);
    const play = ben.page.getByRole("link", { name: "Play the same five" });
    for (let presses = 0; presses < 6 && !(await play.evaluate((element) => element === document.activeElement)); presses += 1) {
      await ben.page.keyboard.press("Tab");
    }
    await expect(play).toBeFocused();
    await ben.page.keyboard.press("Enter");

    // The strip mid-game, then the comparison.
    await expect(ben.page.getByText("Round 1 of 5")).toBeVisible();
    await playRound(ben.page, RIGHT);
    await expect(ben.page.locator(".reveal .duel-line")).toHaveText("Ana: right, 1 hint, +800 points.");
    expect(await ben.page.evaluate(noHorizontalScroll)).toBe(true);
    expect(await violations(ben.page)).toEqual([]);
    for (let round = 2; round <= 5; round += 1) {
      await ben.page.getByRole("button", { name: "Next round" }).click();
      await expect(ben.page.getByText(`Round ${round} of 5`)).toBeVisible();
      await playRound(ben.page, { hints: round === 2 ? 2 : 0, right: true });
    }
    await expect(ben.page.locator(".duel-comparison").getByRole("heading", { level: 3 })).toHaveText(/^(?:You|Ana) win/u);
    expect(await ben.page.evaluate(noHorizontalScroll)).toBe(true);
    expect(await violations(ben.page)).toEqual([]);

    // "Send your result" from the keyboard.
    await ben.page.getByLabel("Your name (stays in the link)").focus();
    await ben.page.keyboard.type("Ben");
    await ben.page.keyboard.press("Tab");
    await expect(ben.page.getByRole("button", { name: "Copy result link" })).toBeFocused();
    await ben.page.keyboard.press("Enter");
    await expect(ben.page.locator(".duel-share .share-status")).toHaveText("Result link copied");
    const result = (await ben.page.evaluate(() => navigator.clipboard.readText())).split("\n").at(-1)!;

    // The result page sits outside any game, so a lab tester picks its theme.
    await ana.page.goto(result.replace("#", `&theme=${theme}#`));
    await expect(ana.page.getByRole("heading", { level: 1 })).toHaveText("Ben vs Ana");
    await expect.poll(() => background(ana.page)).toBe(THEMES[theme]);
    expect(await ana.page.evaluate(noHorizontalScroll)).toBe(true);
    expect(await violations(ana.page)).toEqual([]);
    await ana.context.close();
    await ben.context.close();
  });
}
