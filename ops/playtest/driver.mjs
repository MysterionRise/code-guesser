/**
 * Playtest driver (#116): lets agent players play the real game UI through a tiny local JSON API, so a Claude Code
 * agent team can compare the generative designs with `curl` alone. Each player gets its own browser session.
 *
 *   node ops/playtest/driver.mjs --game http://127.0.0.1:3300 --port 4100 --out ops/playtest/tmp/<run>
 *
 * Endpoints (all JSON; POST bodies are JSON):
 *   POST /sessions                      {name}            -> {id}
 *   POST /sessions/:id/start            {deck, design}    -> state
 *   GET  /sessions/:id/state                              -> state
 *   POST /sessions/:id/hint                               -> state  (buys the round's next hint)
 *   POST /sessions/:id/answer           {label}           -> state  (locks in an option by its label)
 *   POST /sessions/:id/explain                            -> state  (asks the explainer or visualizer, waits for it)
 *   POST /sessions/:id/chat             {text}            -> state  (host design: sends a message, waits for the reply)
 *   POST /sessions/:id/buy-offered-hint                   -> state  (host design: presses the host's hint offer)
 *   POST /sessions/:id/visualizer-step  {times}           -> state  (presses the visualizer's Step button)
 *   POST /sessions/:id/quiz             {choice}          -> state  (composer design: picks a quiz choice)
 *   POST /sessions/:id/next                               -> state  (next round)
 *   POST /sessions/:id/keys             {keys: [..]}      -> {focused, state}  (keyboard play, e.g. "Tab", "Enter")
 *   GET  /sessions/:id/aria                               -> {snapshot}  (the page's accessibility tree)
 *   POST /sessions/:id/screenshot       {name}            -> {path}
 *   DELETE /sessions/:id
 *
 * The driver reads only what the page shows; it never reads the artifact, so it can't tell a player the answer.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

const { chromium } = createRequire(resolve("package.json"))("@playwright/test");
const arg = (name, fallback) => { const index = process.argv.indexOf(`--${name}`); return index > 0 ? process.argv[index + 1] : fallback; };
const GAME = arg("game", "http://127.0.0.1:3300");
const PORT = Number(arg("port", "4100"));
const OUT = resolve(arg("out", `ops/playtest/tmp/${new Date().toISOString().slice(0, 19).replace(/[:T]/gu, "-")}`));
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const sessions = new Map();
const log = (session, action, detail) => {
  session.events.push({ at: new Date().toISOString(), action, ...detail });
  writeFileSync(join(OUT, `${session.name}.events.json`), JSON.stringify(session.events, null, 2));
};

const text = async (locator) => (await locator.count()) > 0 ? (await locator.first().innerText()).replace(/[ \t]+\n/gu, "\n").trim() : null;

/** What a player can see: the round, its code and options, hints, the reveal, and any generative panel or chat. */
const stateOf = async (page) => {
  const reveal = page.locator(".reveal");
  const revealed = (await page.locator(".reveal h2").count()) > 0;
  const frame = page.locator("iframe.visualizer-frame");
  return {
    url: page.url().replace(GAME, ""),
    round: await text(page.locator(".eyebrow")),
    score: await text(page.locator(".arcade-header .score")),
    prompt: await text(page.locator("#round-title")),
    panes: await page.locator(".code-pane").evaluateAll((panes) => panes.map((pane) => ({
      label: pane.querySelector("figcaption")?.textContent ?? null,
      code: [...pane.querySelectorAll(".code-line")].length > 0
        ? [...pane.querySelectorAll(".code-line")].map((line) => line.textContent).join("\n")
        : pane.querySelector(".code-window")?.textContent ?? "",
    }))),
    options: await page.locator(".candidate").evaluateAll((items) => items.map((item) => ({
      label: item.querySelector(".candidate-label")?.textContent ?? "",
      detail: item.querySelector(".candidate-detail")?.textContent ?? null,
      chosen: item.classList.contains("selected"),
      verdict: item.classList.contains("correct") ? "correct" : item.classList.contains("missed") ? "missed" : null,
    }))),
    hintCost: await text(page.locator(".hint-cost")),
    hints: await page.locator(".hints .hint").allInnerTexts(),
    nextHintButton: await text(page.locator(".hint-button:not([disabled])")),
    reveal: revealed ? (await reveal.innerText()).trim() : null,
    alerts: await page.getByRole("alert").allInnerTexts(),
    panel: (await page.locator(".genui-panel").count()) > 0 ? {
      design: await page.locator(".genui-panel").getAttribute("data-genui-design"),
      status: await page.locator(".genui-panel").getAttribute("data-genui-status"),
      text: await text(page.locator(".genui-panel .genui-output")),
      visualizer: (await frame.count()) > 0 ? {
        title: await frame.getAttribute("title"),
        frameText: (await page.frameLocator("iframe.visualizer-frame").locator("body").innerText().catch(() => "")).trim(),
      } : null,
    } : null,
    host: (await page.locator(".host-chat").count()) > 0 ? {
      note: await text(page.locator(".host-note")),
      transcript: await page.locator(".host-turn").allInnerTexts(),
      offer: await text(page.locator(".host-chat .genui-offer button:not([disabled])")),
    } : null,
    complete: await text(page.getByText(/^Run complete/u)),
  };
};

const settle = (page) => page.waitForTimeout(400);

/** Waits for a generative panel or the host to finish: it leaves the busy state, then renders or falls back. */
const awaitGenui = async (page, selector) => {
  await page.waitForFunction((sel) => {
    const element = document.querySelector(sel);
    const status = element?.getAttribute("data-genui-status");
    return status === "submitted" || status === "streaming";
  }, selector, { timeout: 10_000 }).catch(() => {});
  await page.waitForFunction((sel) => {
    const status = document.querySelector(sel)?.getAttribute("data-genui-status");
    return status === "ready" || status === "fallback" || status === "error";
  }, selector, { timeout: 120_000 });
  await page.waitForTimeout(600);
};

const actions = {
  start: async (session, { deck, design }) => {
    await session.page.goto(`${GAME}/?deck=${encodeURIComponent(deck)}${design ? `&design=${encodeURIComponent(design)}` : ""}`);
    await session.page.getByText(/^Round 1 of 5$/u).waitFor();
  },
  hint: async ({ page }) => {
    const before = await page.locator(".hints .hint").count();
    await page.locator(".hint-button:not([disabled])").first().click();
    await page.waitForFunction((count) => document.querySelectorAll(".hints .hint").length > count, before, { timeout: 15_000 });
  },
  answer: async ({ page }, { label }) => {
    await page.getByLabel(label, { exact: true }).check();
    await page.getByRole("button", { name: "Lock in answer" }).click();
    await page.locator(".reveal h2").waitFor({ timeout: 15_000 });
  },
  explain: async ({ page }) => {
    await page.locator(".genui-panel button").first().click();
    await awaitGenui(page, ".genui-panel");
  },
  chat: async ({ page }, { text: message }) => {
    await page.getByLabel("Ask the host").fill(String(message).slice(0, 500));
    await page.locator(".host-form button[type=submit]").click();
    await awaitGenui(page, ".host-chat");
  },
  "buy-offered-hint": async ({ page }) => {
    const before = await page.locator(".hints .hint").count();
    await page.locator(".host-chat .genui-offer button:not([disabled])").last().click();
    await page.waitForFunction((count) => document.querySelectorAll(".hints .hint").length > count, before, { timeout: 15_000 });
  },
  "visualizer-step": async ({ page }, { times = 1 }) => {
    const step = page.frameLocator("iframe.visualizer-frame").getByRole("button", { name: /step|next/iu }).first();
    for (let index = 0; index < Math.min(Number(times) || 1, 20); index += 1) await step.click();
  },
  quiz: async ({ page }, { choice }) => {
    await page.locator(".composer-quiz").getByLabel(String(choice), { exact: true }).check();
  },
  next: async ({ page }) => { await page.getByRole("button", { name: "Next round" }).click(); },
};

const json = (response, status, value) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value, null, 2));
};

const readBody = (request) => new Promise((done) => {
  let body = "";
  request.on("data", (part) => { body += part; });
  request.on("end", () => { try { done(body ? JSON.parse(body) : {}); } catch { done({}); } });
});

createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://driver");
  const [, root, id, action] = url.pathname.split("/");
  try {
    if (root !== "sessions") return json(response, 404, { error: "see the header of ops/playtest/driver.mjs for endpoints" });
    if (request.method === "POST" && !id) {
      const body = await readBody(request);
      const name = String(body.name ?? "player").replace(/[^a-z0-9-]/giu, "-").slice(0, 40);
      const context = await browser.newContext({ viewport: { width: 1100, height: 1400 } });
      const session = { id: randomUUID().slice(0, 8), name, context, page: await context.newPage(), events: [] };
      session.page.on("pageerror", (error) => log(session, "page-error", { message: String(error).slice(0, 200) }));
      sessions.set(session.id, session);
      return json(response, 200, { id: session.id });
    }
    const session = sessions.get(id);
    if (!session) return json(response, 404, { error: "unknown session" });
    const body = request.method === "POST" ? await readBody(request) : {};
    if (request.method === "DELETE") { await session.context.close(); sessions.delete(id); return json(response, 200, { closed: true }); }
    if (request.method === "GET" && action === "state") return json(response, 200, await stateOf(session.page));
    if (request.method === "GET" && action === "aria") return json(response, 200, { snapshot: await session.page.locator("body").ariaSnapshot() });
    if (action === "screenshot") {
      const path = join(OUT, `${session.name}-${String(body.name ?? Date.now()).replace(/[^a-z0-9-]/giu, "-")}.png`);
      await session.page.screenshot({ path, fullPage: true });
      log(session, "screenshot", { path });
      return json(response, 200, { path });
    }
    if (action === "keys") {
      for (const key of Array.isArray(body.keys) ? body.keys.slice(0, 40) : []) await session.page.keyboard.press(String(key));
      await settle(session.page);
      const focused = await session.page.evaluate(() => {
        const element = document.activeElement;
        return element ? { tag: element.tagName.toLowerCase(), role: element.getAttribute("role"), label: element.getAttribute("aria-label") ?? element.textContent?.trim().slice(0, 80) ?? "" } : null;
      });
      log(session, "keys", { keys: body.keys, focused });
      return json(response, 200, { focused, state: await stateOf(session.page) });
    }
    const run = actions[action];
    if (!run || request.method !== "POST") return json(response, 404, { error: `unknown action ${action}` });
    const started = Date.now();
    await run(session, body);
    await settle(session.page);
    const state = await stateOf(session.page);
    log(session, action, { body, ms: Date.now() - started, state });
    return json(response, 200, state);
  } catch (error) {
    const session = sessions.get(id);
    if (session) log(session, "error", { action, message: String(error).slice(0, 300) });
    return json(response, 500, { error: String(error).slice(0, 300) });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`PLAYTEST_DRIVER_LISTENING ${PORT} game=${GAME} out=${OUT}`));
