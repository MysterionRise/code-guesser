import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";

import { chromium } from "@playwright/test";

import { startFakeAnthropic } from "../e2e/fake-anthropic.mjs";
import { startFakeOpenRouter } from "../e2e/fake-openrouter.mjs";
import { ensureProductionBuild, game } from "../production/build.mjs";

const next = join(game, "node_modules", "next", "dist", "bin", "next");
const SENTINEL = "boot-sentinel-5d1e8b";
const data = mkdtempSync(join(tmpdir(), "codeguessr-boot-"));
/** A placeholder for a model provider's key: it holds the sentinel, so no service knows it and no log may print it. */
const MODEL_KEY = `placeholder-${SENTINEL}`;
/**
 * Each model provider's stand-in, the settings that point a server at it, and where a request carries the key (#256).
 * No setting names the provider: a server takes Anthropic's API when the Anthropic key is the only one it has.
 */
const PROVIDERS = Object.freeze([
  {
    name: "OpenRouter",
    fake: startFakeOpenRouter,
    settings: (port) => ({ OPENROUTER_API_KEY: MODEL_KEY, OPENROUTER_BASE_URL: `http://127.0.0.1:${port}/api/v1` }),
    key: ({ authorization }) => authorization?.replace(/^Bearer /u, ""),
  },
  {
    name: "Anthropic's API",
    fake: startFakeAnthropic,
    settings: (port) => ({ ANTHROPIC_API_KEY: MODEL_KEY, ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}/v1` }),
    key: ({ apiKey }) => apiKey,
  },
]);
/** A public server configured for anonymous play (#97), with its state and events in a scratch directory. */
const PUBLIC = Object.freeze({
  CODEGUESSR_PUBLIC: "1",
  CODEGUESSR_SESSION_SECRET: `${SENTINEL}-${"s".repeat(32)}`,
  CODEGUESSR_PUBLIC_ORIGIN: "https://codeguessr.example",
  CODEGUESSR_STATE_DIR: join(data, "state"),
  EXPERIMENT_EVENTS_DIR: join(data, "events"),
  CODEGUESSR_CLIENT_IP_HEADER: "X-Forwarded-For",
});

after(() => rmSync(data, { recursive: true, force: true }));

/** A free local port for one server. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer().once("error", reject).listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/**
 * Starts `next start` on the production build with only the given environment, so the shell running the tests can't
 * change the outcome. `ready`, when given, runs once the server answers, and the server is stopped after it. A `port`
 * is taken when given, so a later server can stand where an earlier one stood; otherwise a free one is picked.
 */
async function start(env, ready, port) {
  port ??= await freePort();
  const child = spawn(process.execPath, [next, "start", "--hostname", "127.0.0.1", "--port", String(port)], {
    cwd: game,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, NEXT_TELEMETRY_DISABLED: "1", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const timeout = setTimeout(() => child.kill("SIGKILL"), 60_000);
  try {
    if (ready) {
      let response;
      for (let attempt = 0; attempt < 120 && child.exitCode === null; attempt += 1) {
        response = await fetch(`http://127.0.0.1:${port}/`).catch(() => undefined);
        if (response) break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      assert.ok(response, `the server never answered\n${stdout}\n${stderr}`);
      await ready(port, response);
      child.kill("SIGTERM");
    }
    const { code, signal } = await exited;
    return { code, signal, stdout, stderr };
  } finally {
    clearTimeout(timeout);
    child.kill("SIGKILL");
  }
}

// The production build is reused when it is newer than what it is made from, and built otherwise.
before(() => { ensureProductionBuild(); });

test("a public server without its session secret refuses to start, naming the code and printing no value", async () => {
  const { CODEGUESSR_SESSION_SECRET: _, ...withoutSecret } = PUBLIC;
  const { code, stdout, stderr } = await start({
    ...withoutSecret,
    CODEGUESSR_PUBLIC_ORIGIN: `http://${SENTINEL}.example`,
    OPENROUTER_API_KEY: `sk-or-${SENTINEL}`,
  });
  assert.equal(code, 78, `expected exit 78\n${stdout}\n${stderr}`);
  const rejected = stderr.split("\n").filter((line) => line.startsWith("GAME_ENVIRONMENT_REJECTED "));
  assert.deepEqual(rejected, [
    "GAME_ENVIRONMENT_REJECTED CODEGUESSR_SESSION_SECRET_MISSING",
    "GAME_ENVIRONMENT_REJECTED CODEGUESSR_PUBLIC_ORIGIN_INVALID",
  ]);
  assert.doesNotMatch(`${stdout}${stderr}`, new RegExp(SENTINEL, "u"));
});

for (const provider of PROVIDERS) test(`the production build plays every generative design on ${provider.name} under its nonce policy, eval refused, without one violation`, async () => {
  const fake = await provider.fake();
  try {
    const { code, signal, stdout, stderr } = await start({
      GENUI_ENABLED: "1", ...provider.settings(fake.port), EXPERIMENT_LAB: "1", EXPERIMENT_SOURCE: "synthetic",
    }, async (port) => {
      const base = `http://127.0.0.1:${port}`;
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        const violations = [];
        await page.exposeFunction("reportCspViolation", (violation) => { violations.push(violation); });
        await page.addInitScript(() => {
          if (window !== window.top) return;
          document.addEventListener("securitypolicyviolation", (event) => { void window.reportCspViolation(`${event.violatedDirective} ${event.blockedURI}`); });
        });
        // A page built ahead of time would carry no nonce; the 404 and About (#168) render per request like every other page.
        for (const path of ["/no-such-page", "/about"]) {
          await page.goto(`${base}${path}`);
          assert.ok(await page.evaluate(() => [...document.scripts].every((script) => script.nonce.length > 0)), path);
        }
        for (const design of ["catalog", "composer", "visualizer"]) {
          await page.goto(`${base}/?deck=algorithm&design=${design}`);
          await page.locator("input[type=radio]").first().check();
          await page.getByRole("button", { name: "Lock in answer" }).click();
          await page.getByRole("button", { name: design === "visualizer" ? "Visualize this round" : "Explain this round" }).click();
          await (design === "visualizer" ? page.frameLocator("iframe.visualizer-frame").locator("#status")
            : page.locator(design === "catalog" ? ".genui-takeaway" : ".composer-callout")).waitFor();
        }
        await page.goto(`${base}/?deck=project&design=host`);
        await page.getByLabel("Ask the host").fill("Any tips?");
        await page.getByRole("button", { name: "Send" }).click();
        await page.locator(".genui-host").first().waitFor();
        assert.deepEqual(violations, []);
        // Each design asked this provider's stand-in once, with the server's key where the provider reads it.
        assert.deepEqual(fake.requests.map((request) => provider.key(request) === MODEL_KEY), [true, true, true, true]);
      } finally {
        await browser.close();
      }
    });
    assert.ok(code === 0 || signal === "SIGTERM", `the server stopped badly (${code}, ${signal})\n${stdout}\n${stderr}`);
    assert.doesNotMatch(`${stdout}${stderr}`, new RegExp(SENTINEL, "u"));
  } finally {
    await fake.close();
  }
});

test("a configured public server starts, answers its health check, and keeps each dealt game in its state store", async () => {
  const { code, signal, stdout, stderr } = await start(PUBLIC, async (port, response) => {
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Pick a deck/u);
    // Public mode, read at start rather than at build (#97): HTTPS pinned briefly to begin with, requests upgraded, and
    // a production policy without eval.
    assert.equal(response.headers.get("strict-transport-security"), "max-age=300");
    const policy = response.headers.get("content-security-policy");
    assert.match(policy, /; upgrade-insecure-requests$/u);
    assert.match(policy, /script-src 'self' 'nonce-[A-Za-z0-9+/]{22}==' 'strict-dynamic';/u);
    assert.doesNotMatch(policy, /unsafe-eval/u);
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.deepEqual([health.status, await health.text()], [200, "ok"]);
    // A deck's address redirects to a seeded deal, whose page deals a game; node:sqlite loads at run time, unbundled.
    const dealt = await fetch(`http://127.0.0.1:${port}/?deck=project`);
    assert.equal(dealt.status, 200);
    const database = new DatabaseSync(join(PUBLIC.CODEGUESSR_STATE_DIR, "state.sqlite"), { readOnly: true });
    try {
      assert.deepEqual({ ...database.prepare("SELECT count(*) AS games, max(step) AS step FROM ledger").get() }, { games: 1, step: 0 });
    } finally {
      database.close();
    }
  });
  assert.ok(code === 0 || signal === "SIGTERM", `the server stopped badly (${code}, ${signal})\n${stdout}\n${stderr}`);
  assert.doesNotMatch(`${stdout}${stderr}`, /GAME_ENVIRONMENT_REJECTED/u);
  assert.doesNotMatch(`${stdout}${stderr}`, new RegExp(SENTINEL, "u"));
});

test("a public server with generative UI on starts on an Anthropic key alone, and names that key when Anthropic is asked for without it (#256)", async () => {
  // Anthropic named as the provider, with only the other provider's key: refused by the missing key's name.
  const refused = await start({ ...PUBLIC, GENUI_ENABLED: "1", GENUI_PROVIDER: "anthropic", OPENROUTER_API_KEY: MODEL_KEY });
  assert.equal(refused.code, 78, `expected exit 78\n${refused.stdout}\n${refused.stderr}`);
  assert.deepEqual(refused.stderr.split("\n").filter((line) => line.startsWith("GAME_ENVIRONMENT_REJECTED ")),
    ["GAME_ENVIRONMENT_REJECTED ANTHROPIC_API_KEY_MISSING"]);
  assert.doesNotMatch(`${refused.stdout}${refused.stderr}`, new RegExp(SENTINEL, "u"));
  // The Anthropic key and nothing else about the model: no OpenRouter key, no GENUI_PROVIDER, no model or address.
  const { code, signal, stdout, stderr } = await start({ ...PUBLIC, GENUI_ENABLED: "1", ANTHROPIC_API_KEY: MODEL_KEY }, async (port, response) => {
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Pick a deck/u);
    const health = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.deepEqual([health.status, await health.text()], [200, "ok"]);
    // Generative UI is on: its route reads a request, where a server without it answers 404. This server's provider
    // address is the real one, so the request is one the route refuses by its shape, before any game or model.
    const shapeless = await fetch(`http://127.0.0.1:${port}/api/genui`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.deepEqual([shapeless.status, await shapeless.json()], [400, { reason: "BODY_REJECTED" }]);
  });
  assert.ok(code === 0 || signal === "SIGTERM", `the server stopped badly (${code}, ${signal})\n${stdout}\n${stderr}`);
  assert.doesNotMatch(`${stdout}${stderr}`, /GAME_ENVIRONMENT_REJECTED/u);
  assert.doesNotMatch(`${stdout}${stderr}`, new RegExp(SENTINEL, "u"));
});

test("a game continues after a restart from the state store, or from its token without one, and ends on a store that doesn't know it (#164)", async () => {
  const port = await freePort();
  const stateDir = join(data, "restart-state");
  const stored = { CODEGUESSR_SESSION_SECRET: PUBLIC.CODEGUESSR_SESSION_SECRET, CODEGUESSR_STATE_DIR: stateDir, EXPERIMENT_LAB: "1", EXPERIMENT_SOURCE: "synthetic" };
  const { CODEGUESSR_STATE_DIR: _, ...memoryOnly } = stored;
  const stopped = ({ code, signal, stdout, stderr }) => assert.ok(code === 0 || signal === "SIGTERM", `the server stopped badly (${code}, ${signal})\n${stdout}\n${stderr}`);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    /** The shell's error line, which a refused step or an ended game fills; the page's empty live regions aren't it. */
    const error = page.locator(".demo-error");
    /** Moves to the next round and buys its first hint, which is the first step the server sees after a restart. */
    const nextRoundWithHint = async (round) => {
      await page.getByRole("button", { name: "Next round" }).click();
      await page.getByText(`Round ${round} of 5`).waitFor();
      await page.getByRole("button", { name: "Reveal hint 1" }).click();
    };
    /** Locks in the first option and waits for the verdict, right or missed. */
    const lock = async () => {
      await page.locator("input[type=radio]").first().check();
      await page.getByRole("button", { name: "Lock in answer" }).click();
      await page.locator("h2.verdict-right, h2.verdict-missed").waitFor();
    };
    // Round 1 is locked in on one server, which then stops.
    stopped(await start(stored, async () => {
      await page.goto(`http://127.0.0.1:${port}/?deck=fix&deal=0badcafe&game=0&design=off`);
      await page.getByText("Round 1 of 5").waitFor();
      await lock();
    }, port));
    // The same page plays on against a second server in its place: it reads the game from the store, so a hint and
    // round 2's answer both take, and nothing is refused.
    stopped(await start(stored, async () => {
      await nextRoundWithHint(2);
      await page.locator(".hints .hint, .demo-error").first().waitFor();
      assert.deepEqual(await error.allTextContents(), []);
      await lock();
    }, port));
    // Without a store, a server that has never seen the game continues it from its token, as before #164.
    stopped(await start(memoryOnly, async () => {
      await nextRoundWithHint(3);
      await page.locator(".hints .hint, .demo-error").first().waitFor();
      assert.deepEqual(await error.allTextContents(), []);
      await lock();
    }, port));
    // A server whose store doesn't know the game ends it rather than let a round whose reveal was seen be replayed.
    stopped(await start({ ...stored, CODEGUESSR_STATE_DIR: join(data, "another-state") }, async () => {
      await nextRoundWithHint(4);
      await error.waitFor();
      assert.equal(await error.getAttribute("role"), "alert");
      assert.match(await error.textContent(), /^This game can’t continue\. Deal new rounds to keep playing\./u);
      assert.equal(await page.locator(".hints .hint").count(), 0);
    }, port));
  } finally {
    await browser.close();
  }
  // The first store holds the game at its last step taken through it: the deal, round 1's lock, round 2's hint and lock.
  const database = new DatabaseSync(join(stateDir, "state.sqlite"), { readOnly: true });
  try {
    assert.deepEqual({ ...database.prepare("SELECT count(*) AS games, max(step) AS step FROM ledger").get() }, { games: 1, step: 3 });
  } finally {
    database.close();
  }
});

test("a public server limits deals by the address its proxy appended, an IPv6 client by its /64, and keeps no address", async () => {
  const { code, signal, stdout, stderr } = await start(PUBLIC, async (port) => {
    const deal = async (forwarded, game) =>
      (await fetch(`http://127.0.0.1:${port}/?deck=project&deal=0badcafe&game=${game}`, { headers: { "x-forwarded-for": forwarded } })).text();
    /** Deals from one client until the server refuses: how many it dealt, and how many ten at once and one every three seconds allow. */
    const dealUntilRefused = async (forwarded) => {
      const started = Date.now();
      for (let game = 0; game < 40; game += 1) {
        if (/Too many new games\. Wait a minute\./u.test(await deal(forwarded(game), game))) {
          return { dealt: game, allowed: 10 + Math.floor((Date.now() - started) / 3_000) };
        }
      }
      return { dealt: 40, allowed: 0 };
    };
    // Every entry before the last is whatever the client sent, so forging them never wins a fresh allowance.
    const forged = await dealUntilRefused((game) => `198.51.100.${game + 1}, 203.0.113.40`);
    assert.ok(forged.dealt >= 10 && forged.dealt <= forged.allowed, JSON.stringify(forged));
    assert.doesNotMatch(await deal("203.0.113.40, 198.51.100.41", 0), /Too many new games/u);
    const network = await dealUntilRefused((game) => `2001:db8:5:6:${game.toString(16)}::1`);
    assert.ok(network.dealt >= 10 && network.dealt <= network.allowed, JSON.stringify(network));
  });
  assert.ok(code === 0 || signal === "SIGTERM", `the server stopped badly (${code}, ${signal})\n${stdout}\n${stderr}`);
  // Nothing the server printed or wrote, its event log and state store included, holds an address.
  const written = (path) => statSync(path).isDirectory() ? readdirSync(path).flatMap((name) => written(join(path, name))) : [readFileSync(path, "latin1")];
  const kept = [stdout, stderr, ...written(data)].join("\n");
  assert.match(kept, /"type":"game_dealt"/u);
  assert.doesNotMatch(kept, /203\.0\.113|198\.51\.100|2001:0?db8/iu);
});
