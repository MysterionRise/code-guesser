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
 * built here. Every container, volume, and network is removed afterwards.
 *
 * The image also makes its model call here (#256), as the pre-launch run does (docs/deploy.md, section 8): in public
 * mode with a synthetic source, lab mode, and generative UI on, against a stand-in for each model provider.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const image = process.env.CODEGUESSR_IMAGE ?? "codeguessr:test";
const SENTINEL = "container-sentinel-7c41e2";
const prefix = `codeguessr-test-${process.pid}`;
const scratch = mkdtempSync(join(tmpdir(), "codeguessr-container-"));
const containers = [];
const volumes = [];
const networks = [];
/** A public server configured for anonymous play (#97); its secret holds the sentinel, which no log may print. */
const PUBLIC = Object.freeze({
  CODEGUESSR_PUBLIC: "1",
  CODEGUESSR_SESSION_SECRET: `${SENTINEL}-${randomBytes(24).toString("hex")}`,
  CODEGUESSR_PUBLIC_ORIGIN: "https://codeguessr.example",
  CODEGUESSR_CLIENT_IP_HEADER: "X-Forwarded-For",
});
/** A placeholder for a model provider's key: it holds the sentinel, so no service knows it and no log may print it. */
const MODEL_KEY = `placeholder-${SENTINEL}`;
/**
 * Each model provider as a server with only its key reaches it (#256): its stand-in under `tests/e2e`, the prefix of
 * the stand-in's own variables and of the server's settings, the path its address ends in, the model a server asks
 * when no setting names one, and where a request carries the key.
 */
const OPENROUTER = Object.freeze({
  name: "openrouter", standIn: "fake-openrouter.mjs", prefix: "OPENROUTER", path: "/api/v1", model: "anthropic/claude-haiku-5.5",
  key: ({ authorization }) => authorization?.replace(/^Bearer /u, ""),
});
const ANTHROPIC = Object.freeze({
  name: "anthropic", standIn: "fake-anthropic.mjs", prefix: "ANTHROPIC", path: "/v1", model: "claude-haiku-5-5",
  key: ({ apiKey }) => apiKey,
});
/** The port a stand-in listens on inside its container. */
const STAND_IN_PORT = 8080;
/** A request to a stand-in, as Node runs it inside the stand-in's container: the address, then a body to POST if any. */
const ASK = "const [url, body] = process.argv.slice(1); fetch(url, body === undefined ? {} : { method: 'POST', body }).then(async (response) => console.log(await response.text()));";

const docker = (args, options = {}) => spawnSync("docker", args, { encoding: "utf8", timeout: 120_000, ...options });
const environment = (env) => Object.entries(env).flatMap(([name, value]) => ["--env", `${name}=${value}`]);
const volume = () => {
  const name = `${prefix}-data-${volumes.length}`;
  assert.equal(docker(["volume", "create", name]).status, 0);
  volumes.push(name);
  return name;
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Where this machine reaches a container's port: the loopback address and port Docker published it on. */
const published = (name, port) => `http://${docker(["port", name, `${port}/tcp`]).stdout.trim().split("\n")[0]}`;
/** Asks an address until it answers 200, for up to a minute; the last response, or undefined when none came. */
const answering = async (url) => {
  let response;
  for (let attempt = 0; attempt < 120 && response?.status !== 200; attempt += 1) {
    response = await fetch(url).catch(() => undefined);
    if (response?.status !== 200) await wait(500);
  }
  return response;
};
const smoke = (base, ...flags) => spawnSync(process.execPath, [join(root, "ops", "deploy", "smoke.mjs"), base, ...flags], { encoding: "utf8", timeout: 300_000 });

/**
 * Starts a provider's stand-in where a container can reach it: in a container of its own, from the same image for its
 * Node, on a network the game's container joins. It listens there on its own name, so on that network's address alone:
 * never on every interface, and on no port of this machine. `address` is the stand-in as the game's container reaches
 * it, and `ask` sends it a request from inside its own container, a POST when given a body, and returns the answer.
 */
const standIn = async (provider, network) => {
  const name = `${prefix}-${provider.name}-stand-in`;
  containers.push(name);
  const created = docker(["create", "--name", name, "--hostname", name, "--network", network, "--user", "node", "--no-healthcheck", "--entrypoint", "node",
    ...environment({ [`FAKE_${provider.prefix}_PORT`]: STAND_IN_PORT, [`FAKE_${provider.prefix}_HOST`]: name }), image, `/tmp/${provider.standIn}`]);
  assert.equal(created.status, 0, created.stderr);
  // Both files go in, since Anthropic's stand-in makes the calls OpenRouter's defines.
  for (const file of [OPENROUTER.standIn, ANTHROPIC.standIn]) {
    const copied = docker(["cp", join(root, "tests", "e2e", file), `${name}:/tmp/${file}`]);
    assert.equal(copied.status, 0, copied.stderr);
  }
  const started = docker(["start", name]);
  assert.equal(started.status, 0, started.stderr);
  // It prints one line once it listens.
  let logs;
  for (let attempt = 0; attempt < 120 && !/^FAKE_\w+_LISTENING /mu.test(logs?.stdout ?? ""); attempt += 1) {
    if (logs !== undefined) await wait(250);
    logs = docker(["logs", name]);
  }
  assert.match(logs.stdout, /^FAKE_\w+_LISTENING /mu, logs.stderr);
  const ask = (path, body) => {
    const asked = docker(["exec", name, "node", "--eval", ASK, `http://${name}:${STAND_IN_PORT}${path}`, ...(body === undefined ? [] : [JSON.stringify(body)])]);
    assert.equal(asked.status, 0, asked.stderr);
    return asked.stdout;
  };
  return { address: `http://${name}:${STAND_IN_PORT}${provider.path}`, ask };
};

/**
 * A container as the pre-launch run sets it (docs/deploy.md, section 8), with one provider's key and nothing else about
 * the model but the stand-in's address: public mode with a synthetic source, which is what lets lab mode and a
 * stand-in's address past the boot check, and generative UI on. The smoke script's `--genui` then plays a round to
 * the catalog explainer, which is the image's model call, and must see the stand-in's panel rendered.
 */
const explainsFromTheImage = async (provider) => {
  const network = `${prefix}-${provider.name}`;
  const made = docker(["network", "create", network]);
  assert.equal(made.status, 0, made.stderr);
  networks.push(network);
  const model = await standIn(provider, network);
  const name = `${prefix}-pre-launch-${provider.name}`;
  containers.push(name);
  const started = docker(["run", "--detach", "--name", name, "--network", network, "--publish", "127.0.0.1::3000", "--volume", `${volume()}:/data`,
    ...environment({ ...PUBLIC, EXPERIMENT_SOURCE: "synthetic", EXPERIMENT_LAB: "1", GENUI_ENABLED: "1",
      [`${provider.prefix}_API_KEY`]: MODEL_KEY, [`${provider.prefix}_BASE_URL`]: model.address }), image]);
  assert.equal(started.status, 0, started.stderr);
  const base = published(name, 3000);
  assert.equal((await answering(`${base}/api/health`))?.status, 200, docker(["logs", name]).stderr);

  const passed = smoke(base, "--genui");
  assert.equal(passed.status, 0, `${passed.stdout}\n${passed.stderr}`);
  assert.match(passed.stdout, /^SMOKE_OK one explainer from the model$/mu);
  assert.match(passed.stdout, /^SMOKE_PASSED$/mu);
  // One request reached the stand-in: the server's key where this provider reads it, for the provider's default model.
  const asked = JSON.parse(model.ask("/requests"));
  assert.deepEqual(asked.map((request) => [provider.key(request) === MODEL_KEY, request.body.model]), [[true, provider.model]]);
  // The server logged the call as codes and counts, the stand-in's two render calls among them, and no value.
  const logs = docker(["logs", name]);
  const printed = `${logs.stdout}${logs.stderr}`;
  assert.match(printed, /^GENUI_FINISHED catalog after-lock tool-calls calls=2 /mu);
  assert.doesNotMatch(printed, /GAME_ENVIRONMENT_REJECTED|GENUI_STREAM_FAILED|GENUI_RENDER_REJECTED/u);
  assert.doesNotMatch(`${printed}${passed.stdout}${passed.stderr}`, new RegExp(SENTINEL, "u"));
  return { name, base, model };
};

before(() => {
  if (process.env.CODEGUESSR_IMAGE) return;
  const built = docker(["build", "--tag", image, "."], { cwd: root, timeout: 900_000 });
  assert.equal(built.status, 0, `docker build failed\n${built.stderr}`);
});

after(() => {
  for (const name of containers) docker(["rm", "--force", name]);
  for (const name of volumes) docker(["volume", "rm", "--force", name]);
  for (const name of networks) docker(["network", "rm", name]);
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
  const base = published(name, 3000);
  const health = await answering(`${base}/api/health`);
  assert.equal(health?.status, 200, docker(["logs", name]).stderr);
  assert.equal(await health.text(), "ok");

  // The server runs as node (uid 1000) with no capabilities; only the entrypoint ran as root, to hand /data over.
  const status = docker(["exec", name, "cat", "/proc/1/status"]).stdout;
  assert.match(status, /^Uid:\s+1000\s+1000\s+1000\s+1000$/mu);
  assert.match(status, /^CapEff:\s+0+$/mu);

  // The smoke script's own game sends Sec-GPC and records no events, so one plain deal is dealt for the event log.
  const passed = smoke(base, "--rate-limits");
  assert.equal(passed.status, 0, `${passed.stdout}\n${passed.stderr}`);
  assert.match(passed.stdout, /^SMOKE_OK one game in a browser$/mu);
  assert.match(passed.stdout, /^SMOKE_PASSED$/mu);
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

test("a pre-launch container with an OpenRouter key alone makes its model call, and the smoke script's --genui sees the explainer rendered (#256)", async () => {
  await explainsFromTheImage(OPENROUTER);
});

test("a pre-launch container with an Anthropic key alone makes its model call, and --genui fails once the provider refuses the key (#256)", async () => {
  const { name, base, model } = await explainsFromTheImage(ANTHROPIC);
  // The provider now answers 402, as it does for a spent key: the explainer falls back to the static reveal, which is
  // the one check that fails. The log names the status, and the provider's own words reach neither it nor the player.
  assert.equal(model.ask("/control", { status: 402 }).trim(), "ok");
  const refused = smoke(base, "--genui");
  assert.equal(refused.status, 1, `${refused.stdout}\n${refused.stderr}`);
  const failed = refused.stdout.split("\n").filter((line) => line.startsWith("SMOKE_FAILED "));
  assert.equal(failed.length, 2, refused.stdout);
  assert.match(failed[0], /^SMOKE_FAILED one explainer from the model: the explainer fell back to the static reveal/u);
  assert.equal(failed[1], "SMOKE_FAILED 1 check(s)");
  const logs = docker(["logs", name]);
  const printed = `${logs.stdout}${logs.stderr}`;
  assert.match(printed, /^GENUI_STREAM_FAILED 402$/mu);
  assert.doesNotMatch(`${printed}${refused.stdout}${refused.stderr}`, /fake provider body/u);
  assert.doesNotMatch(`${printed}${refused.stdout}${refused.stderr}`, new RegExp(SENTINEL, "u"));
});
