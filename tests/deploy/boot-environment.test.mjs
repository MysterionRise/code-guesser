import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const game = join(root, "apps", "game");
const built = join(game, ".next");
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

function newestUnder(path) {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return Math.max(0, ...readdirSync(path).map((name) => newestUnder(join(path, name))));
}

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

// The production build is reused when it is newer than the game's sources, and built otherwise; a loaded machine
// takes over three minutes to build.
before(() => {
  const fresh = existsSync(join(built, "BUILD_ID")) && existsSync(join(built, "server", "instrumentation.js"))
    && statSync(join(built, "BUILD_ID")).mtimeMs > Math.max(newestUnder(join(game, "src")), newestUnder(join(game, "next.config.mjs")));
  if (fresh) return;
  const result = spawnSync("pnpm", ["--filter", "@codeguessr/game", "build"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    timeout: 400_000,
  });
  assert.equal(result.status, 0, `game build failed\n${result.stdout}\n${result.stderr}`);
});

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

test("a configured public server starts, answers its health check, and keeps each dealt game in its state store", async () => {
  const { code, signal, stdout, stderr } = await start(PUBLIC, async (port, response) => {
    assert.equal(response.status, 200);
    assert.match(await response.text(), /Pick a deck/u);
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
