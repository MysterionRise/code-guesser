import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";

import { chromium } from "@playwright/test";

import { startFakeOpenRouter } from "../e2e/fake-openrouter.mjs";
import { ensureProductionBuild, game } from "../production/build.mjs";

const next = join(game, "node_modules", "next", "dist", "bin", "next");
const SENTINEL = "boot-sentinel-5d1e8b";
const data = mkdtempSync(join(tmpdir(), "codeguessr-boot-"));
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
 * change the outcome. `ready`, when given, runs once the server answers, and the server is stopped after it.
 */
async function start(env, ready) {
  const port = await freePort();
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

test("the production build plays every generative design under its nonce policy, eval refused, without one violation", async () => {
  const fake = await startFakeOpenRouter();
  try {
    const { code, signal, stdout, stderr } = await start({
      GENUI_ENABLED: "1", OPENROUTER_API_KEY: "fake-key", OPENROUTER_BASE_URL: `http://127.0.0.1:${fake.port}/api/v1`,
      EXPERIMENT_LAB: "1", EXPERIMENT_SOURCE: "synthetic",
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
      } finally {
        await browser.close();
      }
    });
    assert.ok(code === 0 || signal === "SIGTERM", `the server stopped badly (${code}, ${signal})\n${stdout}\n${stderr}`);
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

test("a public server limits deals by the address its proxy appended, an IPv6 client by its /64, and keeps no address", async () => {
  const { code, signal, stdout, stderr } = await start(PUBLIC, async (port) => {
    const deal = async (forwarded, game) =>
      (await fetch(`http://127.0.0.1:${port}/?deck=project&deal=0badcafe&game=${game}`, { headers: { "x-forwarded-for": forwarded } })).text();
    /** Deals from one client until the server refuses: how many it dealt, and how many ten at once and one every three seconds allow. */
    const dealUntilRefused = async (forwarded) => {
      const started = Date.now();
      for (let game = 0; game < 40; game += 1) {
        if (/Too many new games — wait a minute/u.test(await deal(forwarded(game), game))) {
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
