import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { PRODUCTION_SESSION_SECRET } from "../../playwright.production.config";
import { DEAL, finishGame, lockRound } from "../production/game";
import { scan } from "./scan";

// The pages odd addresses end on, on the production build (#70): a deck the artifact doesn't hold, a malformed deal,
// game, or date, a tampered, expired, or misdirected duel link, and an address the game doesn't serve. Each ends on a
// page that says what happened in words and shows nothing internal. One page of each kind is read by axe at 320 and
// 1280 px, since the rest of its kind share its template; the 404 is read with the other pages.

/** What a refusal must never show a player: a code, a value the server never meant to print, or a stack. */
const INTERNAL = /\b(?:INVALID|EXPIRED|ROUND_SET|DEAL_DRIFT|NOT_ELIGIBLE|SESSION_ENDED|RATE_LIMITED|DUEL_\w+|undefined|null|NaN|Error|digest)\b|\bat \S+ \(|\.[jt]sx?:\d+/u;
const expectNothingInternal = async (page: Page, address: string): Promise<void> => {
  expect(await page.locator("body").innerText(), address).not.toMatch(INTERNAL);
};

test("an address naming a deck this artifact doesn't hold shows the chooser under a note, repeating nothing it named", async ({ page }) => {
  for (const [index, address] of ["/?deck=", "/?deck=project&deck=fix", "/?deck=Project", "/?deck=%3Cb%3Ehello%3C%2Fb%3E"].entries()) {
    expect((await page.goto(address))?.status(), address).toBe(200);
    await expect(page.locator(".deck-notice"), address).toHaveText("That deck isn’t available. Pick another one below.");
    await expect(page.getByRole("heading", { level: 1, name: "Pick a deck" })).toBeVisible();
    await expect(page.getByText("hello")).toHaveCount(0);
    await expectNothingInternal(page, address);
    if (index === 0) await scan(page, "the chooser's note");
  }
});

test("a malformed deal or game number starts a fresh deal of the deck", async ({ page }) => {
  for (const query of ["deal=XYZ&game=0", `deal=${DEAL.toUpperCase()}&game=0`, `deal=${DEAL}&game=-1`, `deal=${DEAL}&game=1000`, `deal=${DEAL}&game=1.5`,
    `deal=${DEAL}&game=`, `deal=${DEAL}&game=0&game=1`, `deal=${DEAL}`, "game=3"]) {
    await page.goto(`/?deck=project&${query}`);
    await expect(page, query).toHaveURL(/\?deck=project&deal=[0-9a-f]{8}&game=0$/u);
    await expect(page.getByText("Round 1 of 5")).toBeVisible();
  }
});

test("a malformed date for today's five is refused in words and deals nothing", async ({ page }) => {
  const today = new Date().toISOString().slice(0, 10);
  for (const [index, query] of ["date=", `date=${today}&date=${today}`, `date=${today}T00:00:00Z`, `date=${today.split("-").reverse().join("-")}`].entries()) {
    await page.goto(`/?deck=daily&${query}`);
    await expect(page.getByRole("heading", { level: 1, name: "That day’s five isn’t open" }), query).toBeVisible();
    await expect(page.getByText("Round 1 of 5")).toHaveCount(0);
    await expectNothingInternal(page, query);
    if (index === 0) await scan(page, "a closed day");
  }
});

// A duel token is AES-256-GCM under a key derived from the session secret, as `local-real-experiment-duel-token.server.ts`
// seals it; the test knows the production server's secret, so it can reseal a real challenge as an expired one.
const CHALLENGE_CONTEXT = "codeguessr-duel.v1";
const RESULT_CONTEXT = "codeguessr-duel-result.v1";
const keyFor = (context: string): Buffer =>
  Buffer.from(hkdfSync("sha256", Buffer.from(PRODUCTION_SESSION_SECRET, "utf8"), Buffer.alloc(0), context, 32));
const openToken = (context: string, token: string): Record<string, unknown> => {
  const bytes = Buffer.from(token, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", keyFor(context), bytes.subarray(0, 12), { authTagLength: 16 });
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(bytes.subarray(bytes.length - 16));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12, bytes.length - 16)), decipher.final()]).toString("utf8")) as Record<string, unknown>;
};
const sealToken = (context: string, claims: object): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(context), iv, { authTagLength: 16 });
  cipher.setAAD(Buffer.from(context, "utf8"));
  const body = Buffer.concat([cipher.update(JSON.stringify(claims), "utf8"), cipher.final()]);
  return Buffer.concat([iv, body, cipher.getAuthTag()]).toString("base64url");
};

test("a tampered, expired, over-long, or misdirected duel link is refused in words", async ({ browser, baseURL }) => {
  // A real challenge, from a finished game.
  const context = await browser.newContext({ ...(baseURL ? { baseURL } : {}), reducedMotion: "reduce" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await context.addInitScript(() => { delete (Navigator.prototype as { share?: unknown }).share; });
  const page = await context.newPage();
  await page.goto(`/?deck=fix&deal=${DEAL}&game=3`);
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  await lockRound(page);
  await finishGame(page);
  await page.getByRole("button", { name: "Challenge a friend" }).click();
  await page.getByRole("button", { name: "Copy challenge link" }).click();
  await expect(page.locator(".duel-share .share-status")).toHaveText("Challenge link copied");
  const token = new URL((await page.evaluate(() => navigator.clipboard.readText())).split("\n").at(-1)!).searchParams.get("duel")!;
  const claims = openToken(CHALLENGE_CONTEXT, token);

  const middle = Math.floor(token.length / 2);
  const tampered = `${token.slice(0, middle)}${token[middle] === "A" ? "B" : "A"}${token.slice(middle + 1)}`;
  const weekAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;
  const invalid = "This challenge link isn’t valid.";
  const cases = [
    { address: `/?duel=${tampered}`, heading: invalid, scanned: "a refused challenge" },
    { address: `/?duel=${tampered}&play=1`, heading: invalid },
    { address: `/?duel=${"A".repeat(1_025)}`, heading: invalid },
    { address: "/?duel=not.base64url", heading: invalid },
    { address: `/?duel=${sealToken(RESULT_CONTEXT, claims)}`, heading: invalid },
    { address: `/?duel=${sealToken(CHALLENGE_CONTEXT, { ...claims, at: Date.now() + 60 * 60 * 1000 })}`, heading: invalid },
    { address: `/?duel=${sealToken(CHALLENGE_CONTEXT, { ...claims, at: weekAgo })}`, heading: "This challenge has expired.", scanned: "an expired challenge" },
    { address: `/?duel=${sealToken(CHALLENGE_CONTEXT, { ...claims, at: weekAgo })}&play=1`, heading: "This challenge has expired." },
    { address: `/?duel=${sealToken(CHALLENGE_CONTEXT, { ...claims, artifact: "0".repeat(16) })}`,
      heading: "This challenge was for an earlier round set. Its rounds are gone.", deal: true },
    { address: `/?duel-result=${token}`, heading: "This result link isn’t valid.", scanned: "a refused result" },
    { address: `/?duel-result=${tampered}`, heading: "This result link isn’t valid." },
  ];
  for (const { address, heading, scanned, deal } of cases) {
    await page.goto(address);
    await expect(page.getByRole("heading", { level: 1 }), address).toHaveText(heading);
    await expect(page.getByText("Round 1 of 5")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Choose another deck" })).toHaveAttribute("href", "/");
    // Only a link that authenticated may name its deck, and offer a fresh deal of it.
    await expect(page.getByRole("link", { name: "Deal new rounds" })).toHaveCount(deal ? 1 : 0);
    await expectNothingInternal(page, address);
    if (scanned) await scan(page, scanned);
  }
  // The real link still opens.
  await page.goto(`/?duel=${token}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("A friend challenges you");
  await context.close();
});

test("an address the game doesn't serve ends on the 404 page with the way back", async ({ page }) => {
  for (const address of ["/api/no-such-route", "/about/extra", "/credits/x/y", "/og/no-such-deck", "/%E2%80%AE", "/genui"]) {
    expect((await page.goto(address))?.status(), address).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "There’s nothing here" }), address).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to the decks" })).toHaveAttribute("href", "/");
    await expectNothingInternal(page, address);
  }
});
