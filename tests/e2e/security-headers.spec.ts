import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

import { VISUALIZER_CSP } from "../../apps/game/src/genui/visualizer-spec";

// Security headers and the nonce CSP (#97): every page's headers, a nonce on every script it serves, and not one
// policy violation while every deck and every generative design is played against the stand-in for OpenRouter.
const fake = `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 3000) + 1}`;
interface Fixture { roundId: string; candidates: { id: string; label: string }[]; correctCandidateId: string }
const artifact = JSON.parse(readFileSync(resolve(process.cwd(), "apps/game/src/demo/generated/local-real-rounds.json"), "utf8")) as { decks: { id: string; fixtures: Fixture[] }[] };
const fixtures = new Map(artifact.decks.flatMap(({ fixtures: deckFixtures }) => deckFixtures.map((fixture) => [fixture.roundId, fixture] as const)));

/** A policy's directives, by name. */
const directives = (policy: string): Map<string, string[]> =>
  new Map(policy.split(";").map((directive) => directive.trim().split(/\s+/u)).filter(([name]) => name).map(([name, ...values]) => [name!, values]));

/** The nonce a page's policy names, after checking every header a page must carry. */
const checkPageHeaders = (response: APIResponse): string => {
  const headers = response.headers();
  expect(headers["referrer-policy"]).toBe("no-referrer");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBe("DENY");
  expect(headers["cross-origin-opener-policy"]).toBe("same-origin");
  const permissions = headers["permissions-policy"]!.split(/,\s*/u);
  expect(permissions).toEqual(expect.arrayContaining(["camera=()", "microphone=()", "geolocation=()", "payment=()", "usb=()", "browsing-topics=()"]));
  // The share button uses Web Share and the clipboard.
  expect(headers["permissions-policy"]).not.toMatch(/web-share|clipboard/u);
  // Only public mode pins HTTPS and upgrades requests.
  expect(headers["strict-transport-security"]).toBeUndefined();
  const policy = directives(headers["content-security-policy"]!);
  const nonce = policy.get("script-src")!.find((value) => value.startsWith("'nonce-"))!.slice("'nonce-".length, -1);
  expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/u);
  // The dev server the browser tests run adds 'unsafe-eval' for React's refresh; a production build doesn't.
  expect(policy.get("script-src")).toEqual(["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", "'unsafe-eval'"]);
  expect(Object.fromEntries([...policy].filter(([name]) => name !== "script-src"))).toEqual({
    "default-src": ["'self'"], "style-src": ["'self'", "'unsafe-inline'"], "img-src": ["'self'", "data:"], "connect-src": ["'self'"],
    "frame-src": ["'self'"], "object-src": ["'none'"], "base-uri": ["'none'"], "form-action": ["'self'"], "frame-ancestors": ["'none'"],
  });
  return nonce;
};

/** Reports every policy violation the game's own page sees, across navigations; the visualizer's frame keeps its own. */
const watchViolations = async (page: Page): Promise<string[]> => {
  const violations: string[] = [];
  await page.exposeFunction("reportCspViolation", (violation: string) => { violations.push(violation); });
  await page.addInitScript(() => {
    if (window !== window.top) return;
    document.addEventListener("securitypolicyviolation", (event) => {
      void (window as unknown as { reportCspViolation: (violation: string) => Promise<void> })
        .reportCspViolation(`${event.violatedDirective} ${event.blockedURI} ${event.sourceFile}:${event.lineNumber}`);
    });
  });
  return violations;
};

const answerRound = async (page: Page): Promise<void> => {
  const fixture = fixtures.get((await page.locator(".game-card").getAttribute("data-round-id"))!)!;
  await page.getByLabel(fixture.candidates.find(({ id }) => id === fixture.correctCandidateId)!.label, { exact: true }).check();
  await page.getByRole("button", { name: "Lock in answer" }).click();
  await expect(page.getByRole("heading", { name: "Nice read." })).toBeVisible();
};

test.beforeEach(async ({ request }) => {
  await request.post(`${fake}/control`, { data: {} });
});

test("the chooser and a deck's game carry every header, and a fresh nonce on every script they serve", async ({ request }) => {
  const nonces = new Set<string>();
  for (const path of ["/", "/?deck=fix", "/?deck=fix"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    const nonce = checkPageHeaders(response);
    nonces.add(nonce);
    const scripts = [...(await response.text()).matchAll(/<script\b[^>]*>/gu)].map(([tag]) => tag);
    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) expect(script, path).toContain(` nonce="${nonce}"`);
  }
  expect(nonces.size).toBe(3);
});

test("the visualizer's frame route serves a constant shell under the visualizer's own policy", async ({ request }) => {
  const responses = [await request.get("/genui/frame"), await request.get("/genui/frame?round=x")];
  for (const response of responses) {
    const headers = response.headers();
    expect(headers["content-security-policy"]).toBe(`${VISUALIZER_CSP}; sandbox allow-scripts; frame-ancestors 'self'`);
    expect(headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(headers["referrer-policy"]).toBe("no-referrer");
  }
  const [first, second] = await Promise.all(responses.map((response) => response.text()));
  expect(second).toBe(first);
  expect(first).not.toMatch(/nonce|fetch|src=/u);
});

test("a game in every deck plays under the policy without a single violation", async ({ page }) => {
  const violations = await watchViolations(page);
  for (const deck of [...artifact.decks.map(({ id }) => id), "mixed"]) {
    await page.goto(`/?deck=${deck}&design=off`);
    await expect(page.getByText("Round 1 of 5")).toBeVisible();
    await page.getByRole("button", { name: "Reveal hint 1" }).click();
    await expect(page.locator(".hints .hint")).toHaveCount(1);
    for (let round = 1; round <= 5; round += 1) {
      await answerRound(page);
      if (round < 5) {
        await page.getByRole("button", { name: "Next round" }).click();
        await expect(page.getByText(`Round ${round + 1} of 5`)).toBeVisible();
      }
    }
    await expect(page.getByText(/Run complete — /u)).toBeVisible();
    expect(violations, deck).toEqual([]);
  }
  // The watch itself works: an image from elsewhere is refused and reported.
  await page.evaluate(() => { const image = document.createElement("img"); image.src = "https://example.invalid/pixel.png"; document.body.append(image); });
  await expect.poll(() => violations.length).toBe(1);
  expect(violations[0]).toMatch(/^img-src https:\/\/example\.invalid\/pixel\.png/u);
});

test("every generative design runs under the policy without a violation, and the visualizer renders in its own frame", async ({ page }) => {
  const violations = await watchViolations(page);
  for (const design of ["catalog", "composer", "visualizer"] as const) {
    await page.goto(`/?deck=algorithm&design=${design}`);
    await expect(page.getByText("Round 1 of 5")).toBeVisible();
    await answerRound(page);
    const panel = page.getByRole("region", { name: design === "visualizer" ? "Visualizer" : "Explainer" });
    await panel.getByRole("button", { name: design === "visualizer" ? "Visualize this round" : "Explain this round" }).click();
    if (design === "catalog") await expect(panel.locator(".genui-takeaway")).toBeVisible();
    if (design === "composer") await expect(panel.locator(".composer-callout")).toBeVisible();
    if (design === "visualizer") {
      const frame = panel.locator("iframe.visualizer-frame");
      await expect(frame).toHaveAttribute("src", "/genui/frame");
      await expect(frame).toHaveAttribute("sandbox", "allow-scripts");
      const inside = page.frameLocator("iframe.visualizer-frame");
      await expect(inside.locator("#isolation")).toHaveText("isolated");
      await inside.getByRole("button", { name: "Step" }).click();
      await expect(inside.locator("#status")).toHaveText("Step 1");
      // The game's own reporter still fits the frame to its page.
      await expect.poll(async () => frame.evaluate((element) => element.getBoundingClientRect().height)).toBeLessThan(480);
    }
    expect(violations, design).toEqual([]);
  }
  await page.goto("/?deck=project&design=host");
  await expect(page.getByText("Round 1 of 5")).toBeVisible();
  const host = page.getByRole("complementary", { name: "Host" });
  await host.getByLabel("Ask the host").fill("Any tips?");
  await host.getByRole("button", { name: "Send" }).click();
  await expect(host.locator(".genui-host")).toHaveText("I can't see the code yet, but I can cheer you on.");
  await answerRound(page);
  await host.getByLabel("Ask the host").fill("Why was that the answer?");
  await host.getByRole("button", { name: "Send" }).click();
  await expect(host.locator(".genui-takeaway")).toBeVisible();
  expect(violations, "host").toEqual([]);
});
