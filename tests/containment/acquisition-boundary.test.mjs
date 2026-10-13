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
  ];
  assertContainsNoFingerprint(participantSources, "participant dependency surface");
  assert.equal(participantSources.some((path) => /(?:^|\/)(?:route|middleware|instrumentation)\.[cm]?[jt]sx?$/u.test(path)), false);
  assert.equal(participantSources.some((path) => /\bfetch\s*\(/u.test(read(path))), false);

  const contentPackage = JSON.parse(read(join(root, "packages", "content", "package.json")));
  assert.equal(contentPackage.exports["./operator/acquisition"].browser, null);
  assert.equal(contentPackage.exports["./operator/acquisition"].default, null);
});

test("public attribution can enter the browser only through authorized reveal", () => {
  const publicContract = read(join(game, "src", "components", "arcade", "mode-contract.ts"));
  const shell = read(join(game, "src", "components", "arcade", "arcade-shell.tsx"));
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
  assert.match(shell, /session\.reveal\s*&&/u);
  assert.match(shell, /session\.reveal\.attribution/u);

  const staticFiles = filesUnder(join(built, "static")).filter((path) => textExtensions.has(extname(path)));
  for (const path of staticFiles) {
    assert.doesNotMatch(read(path), /"sourceUrl"\s*:\s*"https:\/\/github\.com\//iu);
    assert.doesNotMatch(read(path), /"commitSha"\s*:/iu);
    assert.doesNotMatch(read(path), /"licenseSpdx"\s*:/iu);
    assert.doesNotMatch(read(path), /crawlSnapshot|correctCandidateId|"attribution"\s*:|LOCAL_UNREVIEWED_EXPERIMENT|aiCreditRecorded|aiAssistant|changedLineHash/u);
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
