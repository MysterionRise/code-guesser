import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

import { E2E_EVENTS_DIR } from "../../playwright.config";

// Sharing a finished game (#171): its grid and its own address, through the share sheet where the browser has one and
// the clipboard where it doesn't, and each deck's link preview.
interface Fixture { roundId: string; candidates: { id: string; label: string }[]; correctCandidateId: string }
interface Deck { id: string; title: string; description: string; fixtures: Fixture[] }
const artifact = JSON.parse(readFileSync(resolve(process.cwd(), "apps/game/src/demo/generated/local-real-rounds.json"), "utf8")) as { decks: Deck[] };
const fixtures = new Map(artifact.decks.flatMap(({ fixtures: deckFixtures }) => deckFixtures.map((fixture) => [fixture.roundId, fixture] as const)));
const points = (value: number): string => value.toLocaleString("en-US");

type StoredEvent = Readonly<Record<string, unknown> & { type: string; game: string }>;
const today = (): string => new Date().toISOString().slice(0, 10);
const storedEvents = (): StoredEvent[] => {
  const path = join(E2E_EVENTS_DIR, `events-${today()}.jsonl`);
  return existsSync(path) ? readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as StoredEvent) : [];
};

/** Plays a whole game, round one right after a hint, round two missed, the rest right; returns its score and best. */
const playGame = async (page: Page): Promise<{ score: number; best: number }> => {
  let score = 0;
  let best = 0;
  for (let round = 1; round <= 5; round += 1) {
    if (round > 1) await page.getByRole("button", { name: "Next round" }).click();
    await expect(page.getByText(`Round ${round} of 5`)).toBeVisible();
    const fixture = fixtures.get((await page.locator(".game-card").getAttribute("data-round-id"))!)!;
    const full = fixture.candidates.length * 250;
    best += full;
    if (round === 1) await page.getByRole("button", { name: "Reveal hint 1" }).click();
    const pick = fixture.candidates.find(({ id }) => round === 2 ? id !== fixture.correctCandidateId : id === fixture.correctCandidateId)!;
    await page.getByLabel(pick.label, { exact: true }).check();
    await page.getByRole("button", { name: "Lock in answer" }).click();
    await expect(page.getByRole("heading", { name: round === 2 ? "Not this time." : "Nice read." })).toBeVisible();
    score += round === 2 ? 0 : round === 1 ? full * 0.8 : full;
  }
  return { score, best };
};

/** A share sheet that records what it was given, or fails as the browser would; `null` takes Web Share away. */
const stubShare = (page: Page, outcome: "shared" | "NotAllowedError" | null) => page.addInitScript((result) => {
  if (result === null) {
    delete (Navigator.prototype as { share?: unknown }).share;
    return;
  }
  const shared: ShareData[] = [];
  Object.assign(window, { shared });
  Object.defineProperty(Navigator.prototype, "canShare", { configurable: true, value: () => true });
  Object.defineProperty(Navigator.prototype, "share", { configurable: true, value: async (data: ShareData) => {
    if (result !== "shared") throw new DOMException("Share refused", result);
    shared.push(data);
  } });
}, outcome);

const status = (page: Page) => page.locator(".share-status");

test("a finished game shares its grid and its own address, without lab picks, through the share sheet", async ({ page }) => {
  await stubShare(page, "shared");
  const from = storedEvents().length;
  await page.goto("/?deck=language&design=off&theme=paper");
  await expect(page).toHaveURL(/\?deck=language&deal=[0-9a-f]{8}&game=0&design=off&theme=paper$/u);
  const address = new URL(page.url());
  const { score, best } = await playGame(page);
  await expect(status(page)).toHaveAttribute("role", "status");
  await expect(status(page)).toBeEmpty();
  await page.getByRole("button", { name: "Share result" }).click();
  await expect(status(page)).toHaveText("Result shared");

  const shared = await page.evaluate(() => (window as unknown as { shared: ShareData[] }).shared);
  expect(shared).toEqual([{
    text: `CodeGuessr · Which language? · 4/5 · ${points(score)}/${points(best)}\n🟨⬛🟩🟩🟩`,
    url: `${address.origin}/?deck=language&deal=${address.searchParams.get("deal")}&game=0`,
  }]);
  await expect.poll(() => storedEvents().slice(from).filter(({ type }) => type === "result_shared")).toEqual([
    expect.objectContaining({ type: "result_shared", via: "share", deck: "language", theme: "paper" }),
  ]);
});

test("without Web Share, today's five copies its grid and its dated address to the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await stubShare(page, null);
  await page.goto("/?deck=daily&design=off");
  // The browser adds its own date (#172), keeping the lab picks; the share line names that date and links to it.
  await expect(page).toHaveURL(/\?deck=daily&date=\d{4}-\d{2}-\d{2}&design=off$/u);
  const date = new URL(page.url()).searchParams.get("date")!;
  expect(date).toBe(await page.evaluate(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  }));
  const { score, best } = await playGame(page);
  await page.getByRole("button", { name: "Copy result" }).click();
  await expect(status(page)).toHaveText("Result copied");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toBe(`CodeGuessr · Today’s five, ${date} · 4/5 · ${points(score)}/${points(best)}\n🟨⬛🟩🟩🟩\n${new URL(page.url()).origin}/?deck=daily&date=${date}`);
});

test("a share sheet that fails falls back to the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await stubShare(page, "NotAllowedError");
  await page.goto("/?deck=fix&design=off");
  const address = new URL(page.url());
  await playGame(page);
  await page.getByRole("button", { name: "Share result" }).click();
  await expect(status(page)).toHaveText("Result copied");
  expect(await page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(new RegExp(`^CodeGuessr · Spot the fix · 4/5 · [\\d,]+/[\\d,]+\\n🟨⬛🟩🟩🟩\\n${address.origin}/\\?deck=fix&deal=${address.searchParams.get("deal")}&game=0$`, "u"));
});

const SOURCES = [{ id: "daily", title: "Today’s five" }, { id: "mixed", title: "Mixed" }, ...artifact.decks];

test("every deck's link preview is a PNG, and a deck this artifact doesn't hold has none", async ({ request }) => {
  // A build draws every image ahead; the dev server draws each on its first request, a second or more apiece.
  test.setTimeout(120_000);
  const images = await Promise.all(SOURCES.map(({ id }) => request.get(`/og/${id}`, { timeout: 100_000 })));
  for (const [index, image] of images.entries()) {
    expect(image.status(), SOURCES[index]!.id).toBe(200);
    expect(image.headers()["content-type"]).toBe("image/png");
    expect([...(await image.body()).subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  }
  expect((await request.get("/og/vulnerable-line")).status()).toBe(404);
});

test("every deck's address names its deck and its preview, and the chooser keeps the game's own title", async ({ request, baseURL }) => {
  /** A page's title and its link-preview tags, as a link unfurler reads them: Next.js puts them in the head for one. */
  const head = async (path: string) => {
    const html = (await (await request.get(path, { headers: { "user-agent": "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)" } })).text())
      .split("</head>")[0]!;
    const meta = Object.fromEntries([...html.matchAll(/<meta (?:property|name)="((?:og|twitter):[\w:]+)" content="([^"]*)"/gu)].map(([, key, value]) => [key!, value!]));
    return { title: /<title>([^<]*)<\/title>/u.exec(html)?.[1], meta };
  };
  for (const { id, title } of SOURCES) {
    const { title: shown, meta } = await head(id === "daily" ? "/?deck=daily&design=off" : `/?deck=${id}&deal=0badcafe&game=0&design=off`);
    expect(shown, id).toBe(`${title} · CodeGuessr`);
    expect(meta).toMatchObject({ "og:title": `${title} · CodeGuessr`, "og:image": `${baseURL}/og/${id}`, "og:image:width": "1200", "twitter:card": "summary_large_image" });
  }
  const chooser = await head("/");
  expect(chooser.title).toBe("CodeGuessr — Read the code. Make your call.");
  expect(chooser.meta["og:title"]).toBe("CodeGuessr — Read the code. Make your call.");
  expect(chooser.meta["og:image"]).toBeUndefined();
});
