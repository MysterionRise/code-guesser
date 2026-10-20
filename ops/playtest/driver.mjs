/**
 * Playtest driver (#116): lets agent players play the real game UI through a tiny local JSON API, so a Claude Code
 * agent team can compare the generative designs with `curl` alone. Each player gets its own browser session.
 *
 *   node ops/playtest/driver.mjs --game http://127.0.0.1:3300 --port 4100 --out ops/playtest/tmp/<run>
 *
 * Endpoints (all JSON; POST bodies are JSON):
 *   POST /sessions                      {name}            -> {id}
 *   POST /sessions/:id/start            {deck, design, theme, layer} -> state
 *     (deck: a deck id, "mixed", or "daily"; design, theme, and layer are lab picks, so the game needs EXPERIMENT_LAB=1)
 *   GET  /sessions/:id/state                              -> state
 *     (state lists the theme, the code, any question layer, options, hints, reveal, any panel, quiz, or host chat, and
 *     the page's enabled actions)
 *   POST /sessions/:id/hint                               -> state  (buys the round's next hint)
 *   POST /sessions/:id/trace-step       {times, back}     -> state  (steps a bought step-through hint on, or back)
 *   POST /sessions/:id/answer           {label}           -> state  (locks in an option by its label)
 *   POST /sessions/:id/explain                            -> state  (asks the explainer or visualizer, waits for it)
 *   POST /sessions/:id/chat             {text}            -> state  (host design: sends a message, waits for the reply)
 *   POST /sessions/:id/buy-offered-hint                   -> state  (host design: presses the host's hint offer)
 *   POST /sessions/:id/visualizer-step  {times}           -> state  (presses the visualizer's Step button)
 *   POST /sessions/:id/quiz             {choice}          -> state  (composer design: picks a quiz choice)
 *   POST /sessions/:id/next                               -> state  (next round)
 *   POST /sessions/:id/click            {name}            -> state  (presses a button or link by its name, e.g.
 *                                                                    "Deal new rounds")
 *   POST /sessions/:id/keys             {keys: [..]}      -> {focused, state}  (keyboard play, e.g. "Tab", "Enter")
 *   GET  /sessions/:id/aria                               -> {snapshot}  (the page's accessibility tree)
 *   POST /sessions/:id/screenshot       {name}            -> {path}
 *   DELETE /sessions/:id
 *
 * The driver reads only what the page shows; it never reads the artifact, so it can't tell a player the answer.
 * An action the page can't take right now (explain before answering, a hint when none is left) returns 400 with a
 * reason instead of waiting.
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
const taken = new Set();
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
    theme: await page.locator(".demo-page").getAttribute("data-theme").catch(() => null),
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
    // A question layer (#127, #128): the scaffold above the code, the lines a hint marks, and a step-through's frame.
    scaffold: await text(page.locator(".question-scaffold")),
    markedLines: await page.locator(".code-pane .code-line").evaluateAll((lines) =>
      lines.flatMap((line, index) => line.classList.contains("hinted") ? [index + 1] : [])),
    trace: await page.locator(".trace-stepper").evaluateAll((steppers) => steppers.map((stepper) => ({
      input: stepper.querySelector(".trace-input")?.textContent ?? "",
      frame: stepper.querySelector(".trace-frame")?.textContent ?? "",
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
    quiz: (await page.locator(".composer-quiz").count()) > 0 ? {
      question: await text(page.locator(".composer-quiz legend")),
      choices: await page.locator(".composer-quiz .composer-choice").allInnerTexts(),
      feedback: await text(page.locator(".composer-quiz .composer-feedback")),
    } : null,
    complete: await text(page.getByText(/^Run complete/u)),
    // Every enabled control on the page, so a player can see what it may do next (e.g. "Deal new rounds").
    actions: await page.locator("main button:not([disabled]), main a[href], .completion-actions a, .design-nav a, .deck-nav a")
      .evaluateAll((items) => [...new Set(items.map((item) => item.textContent.trim()).filter(Boolean))]),
  };
};

const settle = (page) => page.waitForTimeout(400);

/** An action that doesn't fit the page (chat without the host, explain before answering) is the player's mistake. */
class Unavailable extends Error {}
const need = async (page, selector, what) => {
  if ((await page.locator(selector).count()) === 0) throw new Unavailable(what);
};

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
  start: async (session, { deck, design, theme, layer }) => {
    const picks = Object.entries({ design, theme, layer }).filter(([, value]) => value)
      .map(([name, value]) => `&${name}=${encodeURIComponent(String(value))}`).join("");
    // The deck's address redirects to a fresh seeded deal (#40), carrying the lab picks along.
    await session.page.goto(`${GAME}/?deck=${encodeURIComponent(deck)}${picks}`);
    await session.page.locator(".eyebrow").filter({ hasText: /^Round 1 of 5/u }).waitFor();
  },
  hint: async ({ page }) => {
    await need(page, ".hint-button:not([disabled])", "no hint to buy: none left, or the answer is locked");
    const before = await page.locator(".hints .hint").count();
    await page.locator(".hint-button:not([disabled])").first().click();
    await page.waitForFunction((count) => document.querySelectorAll(".hints .hint").length > count, before, { timeout: 15_000 });
  },
  "trace-step": async ({ page }, { times = 1, back = false }) => {
    await need(page, ".trace-stepper", "no step-through: buy the round's second hint first, on a layered algorithm round");
    const button = page.locator(".trace-stepper").last().getByRole("button", { name: back ? "Back" : "Next step" });
    for (let index = 0; index < Math.min(Number(times) || 1, 20) && await button.isEnabled(); index += 1) await button.click();
  },
  answer: async ({ page }, { label }) => {
    await need(page, ".candidate input:not([disabled])", "no open round: the answer is already locked");
    if ((await page.getByLabel(String(label), { exact: true }).count()) === 0) throw new Unavailable(`no option labelled "${label}"`);
    await page.getByLabel(label, { exact: true }).check();
    await page.getByRole("button", { name: "Lock in answer" }).click();
    await page.locator(".reveal h2").waitFor({ timeout: 15_000 });
  },
  explain: async ({ page }) => {
    await need(page, ".genui-panel button", "nothing to explain: answer first, in the catalog, composer, or visualizer design");
    await page.locator(".genui-panel button").first().click();
    await awaitGenui(page, ".genui-panel");
  },
  chat: async ({ page }, { text: message }) => {
    await need(page, ".host-chat", "no host here: chat needs design=host");
    await page.getByLabel("Ask the host").fill(String(message).slice(0, 500));
    await page.locator(".host-form button[type=submit]").click();
    await awaitGenui(page, ".host-chat");
  },
  "buy-offered-hint": async ({ page }) => {
    await need(page, ".host-chat .genui-offer button:not([disabled])", "no open hint offer from the host");
    const before = await page.locator(".hints .hint").count();
    await page.locator(".host-chat .genui-offer button:not([disabled])").last().click();
    await page.waitForFunction((count) => document.querySelectorAll(".hints .hint").length > count, before, { timeout: 15_000 });
  },
  "visualizer-step": async ({ page }, { times = 1 }) => {
    await need(page, "iframe.visualizer-frame", "no visualizer: explain first in design=visualizer");
    const step = page.frameLocator("iframe.visualizer-frame").getByRole("button", { name: /step|next/iu }).first();
    for (let index = 0; index < Math.min(Number(times) || 1, 20); index += 1) await step.click();
  },
  quiz: async ({ page }, { choice }) => {
    await need(page, ".composer-quiz", "no quiz: explain first in design=composer");
    await page.locator(".composer-quiz").getByLabel(String(choice), { exact: true }).check();
  },
  click: async ({ page }, { name }) => {
    const target = page.getByRole("button", { name: String(name), exact: true })
      .or(page.getByRole("link", { name: String(name), exact: true })).first();
    if ((await target.count()) === 0) throw new Unavailable(`no button or link named "${name}"`);
    await target.click();
    await page.waitForLoadState("domcontentloaded");
  },
  next: async ({ page }) => {
    if ((await page.getByRole("button", { name: "Next round" }).count()) === 0) throw new Unavailable("no next round: answer first, or the game is complete");
    await page.getByRole("button", { name: "Next round" }).click();
  },
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
      const asked = String(body.name ?? "player").replace(/[^a-z0-9-]/giu, "-").slice(0, 40);
      // A second session under a taken name gets its own files, so it can't write over the first one's events.
      let name = asked;
      for (let copy = 2; taken.has(name); copy += 1) name = `${asked}-${copy}`;
      taken.add(name);
      const context = await browser.newContext({ viewport: { width: 1100, height: 1400 } });
      const session = { id: randomUUID().slice(0, 8), name, context, page: await context.newPage(), events: [] };
      session.page.on("pageerror", (error) => log(session, "page-error", { message: String(error).slice(0, 200) }));
      sessions.set(session.id, session);
      return json(response, 200, { id: session.id, name });
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
    if (error instanceof Unavailable) return json(response, 400, { error: error.message });
    const session = sessions.get(id);
    if (session) log(session, "error", { action, message: String(error).slice(0, 300) });
    return json(response, 500, { error: String(error).slice(0, 300) });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`PLAYTEST_DRIVER_LISTENING ${PORT} game=${GAME} out=${OUT}`));
