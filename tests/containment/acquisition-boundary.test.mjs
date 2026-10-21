import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { before, test } from "node:test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const game = join(root, "apps", "game");
const built = join(game, ".next");
const textExtensions = new Set([".css", ".html", ".js", ".json", ".map", ".rsc", ".txt"]);
const acquisitionFingerprints = [
  /@codeguessr\/content\/operator\/acquisition/iu,
  /api\.github\.com\/repos\//iu,
  /GITHUB_TOKEN/u,
  /ops\/content\/acquire/iu,
  /repository-admission\.v1/iu,
  /attribution-markers\.v1/iu,
  /approved-policy-register\.v1/iu,
  /operator-authorization\.v1/iu,
  /DRAFT_REVIEW_REQUIRED/u,
  /RAW_OBJECT_CREATED/u,
  /encrypted-store/iu,
];

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function read(path) {
  return readFileSync(path, "utf8");
}

function assertContainsNoFingerprint(paths, label) {
  for (const path of paths) {
    const content = read(path);
    for (const fingerprint of acquisitionFingerprints) {
      assert.doesNotMatch(content, fingerprint, `${label} leaked through ${relative(root, path)}`);
    }
  }
}

before(() => {
  const result = spawnSync("pnpm", ["--filter", "@codeguessr/game", "build"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    timeout: 180_000,
  });
  assert.equal(result.status, 0, `game build failed\n${result.stdout}\n${result.stderr}`);
  assert.ok(statSync(join(built, "BUILD_ID")).isFile(), "production build has no BUILD_ID");
});

test("browser and gameplay dependency surfaces exclude acquisition capabilities", () => {
  const gamePackage = JSON.parse(read(join(game, "package.json")));
  const participantDependencies = {
    ...gamePackage.dependencies,
    ...gamePackage.devDependencies,
    ...gamePackage.optionalDependencies,
  };
  assert.equal(participantDependencies["@codeguessr/content"], undefined);
  assert.equal(Object.keys(participantDependencies).some((name) => /acquisition|github/iu.test(name)), false);

  const participantSources = [
    ...filesUnder(join(game, "src")),
    ...filesUnder(join(root, "packages", "domain", "src")),
    ...filesUnder(join(root, "packages", "measurement", "src")),
    ...filesUnder(join(root, "packages", "artifact", "src")),
  ];
  assertContainsNoFingerprint(participantSources, "participant dependency surface");
  // Four server endpoints: generative UI's guarded route (#101), off unless enabled and reading round data only
  // through the answer-lock guard; the event log's beacon (#107), which reads no round data at all; each deck's link
  // preview (#171), an image of its title drawn at build time; and the health check (#164), which reads neither the
  // request nor round data and records nothing. One boot hook (#97), which only checks the environment and prints
  // codes.
  const routes = participantSources.filter((path) => /(?:^|\/)(?:route|middleware|instrumentation)\.[cm]?[jt]sx?$/u.test(path));
  assert.deepEqual(routes.map((path) => relative(root, path)).sort(), [
    "apps/game/src/app/api/events/route.ts",
    "apps/game/src/app/api/genui/route.ts",
    "apps/game/src/app/api/health/route.ts",
    "apps/game/src/app/og/[deck]/route.tsx",
    "apps/game/src/instrumentation.ts",
  ]);
  const eventsRoute = read(join(game, "src", "app", "api", "events", "route.ts"));
  assert.match(eventsRoute, /const MAX_BODY_LENGTH = 1024;/u);
  assert.deepEqual([...eventsRoute.matchAll(/experiment\.(\w+)\(/gu)].map(([, method]) => method), ["recordClientEvent"]);
  const genuiRoute = read(join(game, "src", "app", "api", "genui", "route.ts"));
  assert.match(genuiRoute, /process\.env\.GENUI_ENABLED !== "1"/u);
  assert.match(genuiRoute, /experiment\.modelContext\(/u);
  const health = read(join(game, "src", "app", "api", "health", "route.ts"));
  assert.deepEqual([...health.matchAll(/^export (?:async )?function (\w+)\(([^)]*)\)/gmu)].map(([, name, parameters]) => `${name}(${parameters})`), ["GET()"]);
  assert.match(health, /if \(!loaded\.ok\) return `ARTIFACT_\$\{loaded\.reason\}`;/u);
  assert.doesNotMatch(health, /\bloaded\.experiment\b|headers\(|cookies\(|console\.|append|write(?:File)?Sync|recordStep|recordLedgerStep/u);
  const boot = read(join(game, "src", "instrumentation.ts"));
  assert.deepEqual([...boot.matchAll(/(?:\bfrom|\bimport\s*\()\s*"([^"]+)"/gu)].map(([, specifier]) => specifier), ["./server/environment.server"]);
  assert.doesNotMatch(boot, /^import\b/mu);
  assert.match(boot, /if \(process\.env\.NEXT_RUNTIME === "nodejs"\)/u);
  assert.deepEqual([...boot.matchAll(/console\.\w+\(([^;]*)\);/gu)].map(([, argument]) => argument), ["`GAME_ENVIRONMENT_REJECTED ${code}`"]);
  assert.match(boot, /process\.exit\(78\);/u);
  assert.doesNotMatch(boot, /experiment|activeLocalRealExperiment|readFileSync|process\.env\.(?!NEXT_RUNTIME\b)\w/u);
  // The preview reads deck titles alone, through the one list of what a game is dealt from, and that list reads only
  // each deck's id, title, and description: no round, option, or deal reaches either. Comments are left out.
  const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gmu, "");
  const roundData = /\b(?:fixtures?|rounds?|candidates?|privateReveals|panes?|prompt|clues?|hints?|deal\w*|answer|revealHint|modelContext|recordClientEvent)\b/iu;
  const ogRoute = code(join(game, "src", "app", "og", "[deck]", "route.tsx"));
  assert.match(ogRoute, /^export const dynamic = "force-static";$/mu);
  assert.match(ogRoute, /^export const dynamicParams = false;$/mu);
  assert.deepEqual([...ogRoute.matchAll(/\bloaded\.(\w+)/gu)].map(([, key]) => key), ["ok", "experiment"]);
  assert.match(ogRoute, /gameSources\(loaded\.experiment\)\.map\(\(\{ id, title \}\) => \[id, title\]\)/u);
  assert.doesNotMatch(ogRoute, roundData);
  assert.doesNotMatch(ogRoute, /\bdescription\b|\bfetch\b|process\.env|headers\(/u);
  const sources = code(join(game, "src", "demo", "game-sources.server.ts"));
  assert.match(sources, /= \(\{ decks, mixed \}: Pick<LocalRealExperiment, "decks" \| "mixed">\)/u);
  assert.match(sources, /decks\.map\(\(\{ id, title, description \}\) => \(\{ id, title, description \}\)\)/u);
  assert.doesNotMatch(sources, roundData);
  assert.equal(participantSources.some((path) => /\bfetch\s*\(/u.test(read(path))), false);

  const contentPackage = JSON.parse(read(join(root, "packages", "content", "package.json")));
  assert.equal(contentPackage.exports["./operator/acquisition"].browser, null);
  assert.equal(contentPackage.exports["./operator/acquisition"].default, null);
});

test("public attribution can enter the browser only through authorized reveal", () => {
  const publicContract = read(join(game, "src", "components", "arcade", "mode-contract.ts"));
  const shell = read(join(game, "src", "components", "arcade", "arcade-shell.tsx"));
  const reveal = read(join(game, "src", "components", "arcade", "round-reveal.tsx"));
  const page = read(join(game, "src", "app", "page.tsx"));
  const action = read(join(game, "src", "app", "actions.ts"));

  assert.doesNotMatch(publicContract, /\battribution\b/iu);
  const loader = read(join(game, "src", "demo", "local-real-experiment-loader.server.ts"));
  assert.doesNotMatch(page, /\battribution\b|github\.com|commitSha|licenseSpdx/iu);
  assert.doesNotMatch(page, /generated\/local-real-rounds\.json/u);
  assert.match(page, /experiment\.decks/u);
  assert.match(page, /chooseAnotherDeckHref/u);
  assert.match(action, /authorizeLocalExperimentReveal/u);
  assert.match(action, /activeLocalRealExperiment/u);
  assert.match(loader, /^import "server-only";/u);
  // The shell renders the reveal only once the server authorized it, and only the reveal reads attribution.
  assert.match(shell, /session\.reveal\s*&&\s*\(\s*<RoundReveal /u);
  assert.doesNotMatch(shell, /attribution/u);
  assert.match(reveal, /reveal\.attribution/u);

  const staticFiles = filesUnder(join(built, "static")).filter((path) => textExtensions.has(extname(path)));
  for (const path of staticFiles) {
    assert.doesNotMatch(read(path), /"sourceUrl"\s*:\s*"https:\/\/github\.com\//iu);
    assert.doesNotMatch(read(path), /"commitSha"\s*:/iu);
    assert.doesNotMatch(read(path), /"licenseSpdx"\s*:/iu);
    assert.doesNotMatch(read(path), /crawlSnapshot|correctCandidateId|"attribution"\s*:|LOCAL_UNREVIEWED_EXPERIMENT|parentExcerptHash|starEventsCount/u);
  }
});

test("the model provider's key and address never reach the browser", () => {
  const providerFingerprints = [/OPENROUTER_API_KEY/u, /openrouter\.ai/iu, /sk-or-/u, /GENUI_ENABLED/u];
  const clientFiles = filesUnder(join(built, "static")).filter((path) => textExtensions.has(extname(path)));
  assert.ok(clientFiles.length > 0, "production build emitted no client files");
  for (const path of clientFiles) {
    for (const fingerprint of providerFingerprints) {
      assert.doesNotMatch(read(path), fingerprint, `${fingerprint} reached the browser through ${relative(root, path)}`);
    }
  }
  const model = read(join(game, "src", "genui", "model.server.ts"));
  assert.match(model, /^import "server-only";/u);
});

test("the session secret, preparation credentials, and the preparer never reach the browser", () => {
  const serverFingerprints = [/CODEGUESSR_SESSION_SECRET/u, /HF_TOKEN/u, /huggingface\.co/iu, /ops\/poc\/prepare/iu];
  const clientFiles = filesUnder(join(built, "static")).filter((path) => textExtensions.has(extname(path)));
  assert.ok(clientFiles.length > 0, "production build emitted no client files");
  for (const path of clientFiles) {
    for (const fingerprint of serverFingerprints) {
      assert.doesNotMatch(read(path), fingerprint, `${fingerprint} reached the browser through ${relative(root, path)}`);
    }
  }
  for (const path of filesUnder(join(game, "src", "server"))) {
    assert.match(read(path), /^import "server-only";/u, `${relative(root, path)} must be server-only`);
  }
});

test("production artifacts, manifests, telemetry and routes contain no acquisition runtime", () => {
  const artifactFiles = filesUnder(built).filter((path) => textExtensions.has(extname(path)));
  assertContainsNoFingerprint(artifactFiles, "production artifact");

  const manifests = artifactFiles.filter((path) => /manifest/iu.test(path));
  assert.ok(manifests.length > 0, "production build emitted no auditable manifests");
  assertContainsNoFingerprint(manifests, "build manifest");

  const telemetry = filesUnder(join(root, "packages", "measurement", "src"));
  assertContainsNoFingerprint(telemetry, "telemetry schema");
  const rootPackage = JSON.parse(read(join(root, "package.json")));
  assert.equal(rootPackage.scripts["acquire:content"], "node --import tsx ops/content/acquire/index.ts");
  const nonOperatorScripts = Object.entries(rootPackage.scripts)
    .filter(([name]) => name !== "acquire:content")
    .map(([, command]) => command);
  assert.equal(nonOperatorScripts.some((command) => /acquir|github/iu.test(command)), false);
  assertContainsNoFingerprint(
    [join(game, "package.json"), join(game, "next.config.mjs")],
    "game build configuration",
  );

  const config = read(join(game, "next.config.mjs"));
  assert.match(config, /productionBrowserSourceMaps:\s*false/u);
});
