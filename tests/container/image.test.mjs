import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";

/**
 * The container image (#170), run as the owner's server runs it: in public mode, with a throwaway secret and a
 * throwaway volume on /data. `CODEGUESSR_IMAGE` names an image already built, as CI's does; otherwise the image is
 * built here. Every container and volume is removed afterwards.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const image = process.env.CODEGUESSR_IMAGE ?? "codeguessr:test";
const SENTINEL = "container-sentinel-7c41e2";
const prefix = `codeguessr-test-${process.pid}`;
const scratch = mkdtempSync(join(tmpdir(), "codeguessr-container-"));
const containers = [];
const volumes = [];
/** A public server configured for anonymous play (#97); its secret holds the sentinel, which no log may print. */
const PUBLIC = Object.freeze({
  CODEGUESSR_PUBLIC: "1",
  CODEGUESSR_SESSION_SECRET: `${SENTINEL}-${randomBytes(24).toString("hex")}`,
  CODEGUESSR_PUBLIC_ORIGIN: "https://codeguessr.example",
  CODEGUESSR_CLIENT_IP_HEADER: "X-Forwarded-For",
});

const docker = (args, options = {}) => spawnSync("docker", args, { encoding: "utf8", timeout: 120_000, ...options });
const environment = (env) => Object.entries(env).flatMap(([name, value]) => ["--env", `${name}=${value}`]);
const volume = () => {
  const name = `${prefix}-data-${volumes.length}`;
  assert.equal(docker(["volume", "create", name]).status, 0);
  volumes.push(name);
  return name;
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

before(() => {
  if (process.env.CODEGUESSR_IMAGE) return;
  const built = docker(["build", "--tag", image, "."], { cwd: root, timeout: 900_000 });
  assert.equal(built.status, 0, `docker build failed\n${built.stderr}`);
});

after(() => {
  for (const name of containers) docker(["rm", "--force", name]);
  for (const name of volumes) docker(["volume", "rm", "--force", name]);
  rmSync(scratch, { recursive: true, force: true });
});

test("a public container without its session secret exits 78, naming the code and printing no value", () => {
  const { CODEGUESSR_SESSION_SECRET: _, ...withoutSecret } = PUBLIC;
  const result = docker(["run", "--rm", "--volume", `${volume()}:/data`,
    ...environment({ ...withoutSecret, CODEGUESSR_PUBLIC_ORIGIN: `http://${SENTINEL}.example` }), image]);
  assert.equal(result.status, 78, `${result.stdout}\n${result.stderr}`);
  assert.deepEqual(result.stderr.split("\n").filter((line) => line.startsWith("GAME_ENVIRONMENT_REJECTED ")), [
    "GAME_ENVIRONMENT_REJECTED CODEGUESSR_SESSION_SECRET_MISSING",
    "GAME_ENVIRONMENT_REJECTED CODEGUESSR_PUBLIC_ORIGIN_INVALID",
  ]);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, new RegExp(SENTINEL, "u"));
});

test("a public container with no volume on /data refuses to start, since its games and events would vanish with it", () => {
  const result = docker(["run", "--rm", ...environment(PUBLIC), image]);
  assert.equal(result.status, 78, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stderr.trim(), "GAME_ENVIRONMENT_REJECTED DATA_VOLUME_MISSING");
});

test("a configured public container runs as node, keeps its games and events on its volume, and passes the smoke script", async () => {
  const name = `${prefix}-public`;
  containers.push(name);
  const started = docker(["run", "--detach", "--name", name, "--publish", "127.0.0.1::3000", "--volume", `${volume()}:/data`, ...environment(PUBLIC), image]);
  assert.equal(started.status, 0, started.stderr);
  const base = `http://${docker(["port", name, "3000/tcp"]).stdout.trim().split("\n")[0]}`;
  let health;
  for (let attempt = 0; attempt < 120 && health?.status !== 200; attempt += 1) {
    health = await fetch(`${base}/api/health`).catch(() => undefined);
    if (health?.status !== 200) await wait(500);
  }
  assert.equal(health?.status, 200, docker(["logs", name]).stderr);
  assert.equal(await health.text(), "ok");

  // The server runs as node (uid 1000) with no capabilities; only the entrypoint ran as root, to hand /data over.
  const status = docker(["exec", name, "cat", "/proc/1/status"]).stdout;
  assert.match(status, /^Uid:\s+1000\s+1000\s+1000\s+1000$/mu);
  assert.match(status, /^CapEff:\s+0+$/mu);

  // The smoke script's own game sends Sec-GPC and records no events, so one plain deal is dealt for the event log.
  const smoke = spawnSync(process.execPath, [join(root, "ops", "deploy", "smoke.mjs"), base, "--rate-limits"], { encoding: "utf8", timeout: 300_000 });
  assert.equal(smoke.status, 0, `${smoke.stdout}\n${smoke.stderr}`);
  assert.match(smoke.stdout, /^SMOKE_OK one game in a browser$/mu);
  assert.match(smoke.stdout, /^SMOKE_PASSED$/mu);
  const dealt = await fetch(`${base}/?deck=language&deal=0badcafe&game=0`, { headers: { "x-forwarded-for": "203.0.113.9" } });
  assert.equal(dealt.status, 200);

  // node:sqlite loads at run time, unbundled: the ledger on the volume holds the smoke game and the plain deal.
  const ledger = docker(["exec", "--user", "node", name, "node", "--eval",
    "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync('/data/state/state.sqlite', { readOnly: true }); "
    + "console.log(db.prepare('SELECT count(*) AS games FROM ledger').get().games);"]);
  assert.equal(ledger.status, 0, ledger.stderr);
  assert.ok(Number(ledger.stdout.trim()) >= 2, ledger.stdout);

  // pull-events.sh copies the event days off the server and never the state store; here ssh is a stand-in that runs
  // the command locally.
  const ssh = join(scratch, "ssh");
  writeFileSync(ssh, "#!/bin/sh\n# Stands in for ssh: drops the host and runs the command here.\nshift\nexec \"$@\"\n");
  chmodSync(ssh, 0o755);
  const pulled = join(scratch, "events");
  const pull = spawnSync("sh", [join(root, "ops", "deploy", "pull-events.sh"), "server", prefix, pulled],
    { encoding: "utf8", env: { ...process.env, CODEGUESSR_SSH: ssh }, timeout: 60_000 });
  assert.equal(pull.status, 0, `${pull.stdout}\n${pull.stderr}`);
  const files = readdirSync(pulled);
  assert.ok(files.length > 0 && files.every((file) => /^events-\d{4}-\d{2}-\d{2}\.jsonl$/u.test(file)), files.join(", "));
  const events = files.map((file) => readFileSync(join(pulled, file), "utf8")).join("");
  const dealtEvents = events.split("\n").filter((line) => line !== "").map((line) => JSON.parse(line)).filter(({ type }) => type === "game_dealt");
  assert.deepEqual(dealtEvents.map(({ deck }) => deck), ["language"]);
  assert.doesNotMatch(events, /\b\d{1,3}(?:\.\d{1,3}){3}\b|203\.0\.113|198\.51\.100/u);

  // Docker's own check, from the image's HEALTHCHECK, as Swarm runs it.
  let healthy = "";
  for (let attempt = 0; attempt < 60 && healthy !== "healthy"; attempt += 1) {
    healthy = docker(["inspect", "--format", "{{.State.Health.Status}}", name]).stdout.trim();
    if (healthy !== "healthy") await wait(1_000);
  }
  assert.equal(healthy, "healthy");

  // A stop ends the server at once and cleanly, well inside Swarm's ten-second grace.
  const stopped = Date.now();
  assert.equal(docker(["stop", name]).status, 0);
  assert.ok(Date.now() - stopped < 8_000, `stopping took ${Date.now() - stopped} ms`);
  assert.equal(docker(["inspect", "--format", "{{.State.ExitCode}}", name]).stdout.trim(), "0");
  const logs = docker(["logs", name]);
  const printed = `${logs.stdout}${logs.stderr}`;
  assert.doesNotMatch(printed, new RegExp(SENTINEL, "u"));
  assert.doesNotMatch(printed, /GAME_ENVIRONMENT_REJECTED|EACCES|203\.0\.113|198\.51\.100/u);
});
