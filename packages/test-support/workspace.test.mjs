import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const workspaceFile = (path) => new URL(`../../${path}`, import.meta.url);
const readWorkspaceFile = (path) => readFileSync(workspaceFile(path), "utf8");

test("defines the pnpm workspace boundary", () => {
  assert.equal(
    existsSync(workspaceFile("pnpm-workspace.yaml")),
    true,
    "pnpm-workspace.yaml must define the workspace boundary",
  );
});

test("ships an MIT licence naming the author and declares it in the root manifest", () => {
  assert.equal(existsSync(workspaceFile("LICENSE")), true, "LICENSE must exist at the repository root");
  const licence = readWorkspaceFile("LICENSE");
  assert.match(licence, /^MIT License\n/u);
  assert.match(licence, /Copyright \(c\) 2026 Konstantin Perikov/u);
  assert.match(licence, /Permission is hereby granted, free of charge/u);
  const manifest = JSON.parse(readWorkspaceFile("package.json"));
  assert.equal(manifest.license, "MIT");
});

test("defines one CI workflow that pins the toolchain and runs every verification suite", () => {
  const workflowPath = ".github/workflows/ci.yml";
  assert.equal(existsSync(workspaceFile(workflowPath)), true, `${workflowPath} must exist`);
  const workflow = readWorkspaceFile(workflowPath);
  for (const expected of [
    "node-version: 24.22.0",
    "version: 9.15.9",
    "pnpm install --frozen-lockfile",
    "pnpm audit --audit-level=high",
    "pnpm typecheck",
    "pnpm test\n",
    "pnpm test:a11y",
    "pnpm test:performance",
    "pnpm test:deploy",
    "pnpm --filter @codeguessr/game build",
    "pnpm exec node --test tests/containment/acquisition-boundary.test.mjs",
    "pnpm exec playwright install --with-deps chromium",
    "pnpm test:e2e",
    "docker build --tag codeguessr:ci .",
    "pnpm test:container",
    "uv sync --locked --project ops/poc/stack",
    "uv run --project ops/poc/stack --locked python -m unittest discover -s ops/poc/stack",
    "permissions:\n  contents: read",
  ]) {
    assert.ok(workflow.includes(expected), `ci.yml must contain ${JSON.stringify(expected)}`);
  }
  assert.doesNotMatch(workflow, /secrets\.|HF_TOKEN|AWS_|GITHUB_TOKEN|prepare:poc/u, "CI must need no provider secrets and never run live preparation");
});

test("pins one Node version in the manifest, the version files, CI, and the README", () => {
  const { engines } = JSON.parse(readWorkspaceFile("package.json"));
  const version = engines.node;
  assert.match(version, /^\d+\.\d+\.\d+$/u, "engines.node must pin an exact version");
  for (const path of [".nvmrc", ".node-version"]) {
    assert.equal(existsSync(workspaceFile(path)), true, `${path} must exist`);
    assert.equal(readWorkspaceFile(path), `${version}\n`, `${path} must pin Node ${version}`);
  }
  assert.ok(readWorkspaceFile(".github/workflows/ci.yml").includes(`node-version: ${version}\n`), `ci.yml must pin Node ${version}`);
  assert.ok(readWorkspaceFile("README.md").includes(`Node.js \`${version}\``), `README prerequisites must name Node ${version}`);
  // The container image (#170) builds and runs on that Node, by digest; Dependabot moves the digest, a person the version.
  const bases = [...readWorkspaceFile("Dockerfile").matchAll(/^FROM (\S+)/gmu)].map((match) => match[1]);
  assert.equal(bases.length, 2, "the Dockerfile must have a build and a runtime stage");
  for (const base of bases) assert.match(base, new RegExp(`^node:${version.replaceAll(".", "\\.")}-bookworm-slim@sha256:[0-9a-f]{64}$`, "u"));
});

test("only the container image binds every interface", () => {
  // Spelled in parts, so this file doesn't match its own search.
  const anyAddress = ["0", "0", "0", "0"].join(".");
  const listed = spawnSync("git", ["ls-files", "-z"], { cwd: new URL("../../", import.meta.url), encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  // Prose may name the address; the frozen artifact's panes are third-party code shown to players, never run.
  const binding = listed.stdout.split("\0").filter((path) => path !== "" && !path.endsWith(".md") && !path.startsWith("apps/game/src/demo/generated/"))
    .filter((path) => existsSync(workspaceFile(path)) && readWorkspaceFile(path).includes(anyAddress));
  assert.deepEqual(binding, ["Dockerfile"]);
  assert.match(readWorkspaceFile("Dockerfile"), new RegExp(`^ +HOSTNAME=${anyAddress.replaceAll(".", "\\.")} \\\\$`, "mu"));
});

test("binds the game's dev and production servers to 127.0.0.1 only", () => {
  const { scripts } = JSON.parse(readWorkspaceFile("apps/game/package.json"));
  for (const [name, command] of [
    ["dev", "next dev"],
    ["start", "next start"],
  ]) {
    const script = scripts[name];
    assert.ok(script?.startsWith(`${command} `), `apps/game "${name}" must run ${command}`);
    const hosts = [...script.matchAll(/(?:^|\s)(?:--hostname|-H)(?:\s+|=)(\S+)/gu)].map((match) => match[1]);
    assert.deepEqual(hosts, ["127.0.0.1"], `apps/game "${name}" must bind --hostname 127.0.0.1 and no other host`);
  }
});

test("links the CI badge from the README", () => {
  const readme = readWorkspaceFile("README.md");
  assert.ok(
    readme.includes("https://github.com/MysterionRise/code-guesser/actions/workflows/ci.yml/badge.svg"),
    "README must carry the CI badge",
  );
});
