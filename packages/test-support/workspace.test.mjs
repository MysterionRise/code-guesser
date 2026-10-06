import assert from "node:assert/strict";
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
    "node-version: 20.18.0",
    "version: 9.15.9",
    "pnpm install --frozen-lockfile",
    "pnpm typecheck",
    "pnpm test\n",
    "pnpm test:a11y",
    "pnpm test:performance",
    "pnpm --filter @codeguessr/game build",
    "pnpm exec node --test tests/containment/acquisition-boundary.test.mjs",
    "pnpm exec playwright install --with-deps chromium",
    "pnpm test:e2e",
    "uv sync --locked --project ops/poc/stack",
    "uv run --project ops/poc/stack --locked python -m unittest discover -s ops/poc/stack",
    "permissions:\n  contents: read",
  ]) {
    assert.ok(workflow.includes(expected), `ci.yml must contain ${JSON.stringify(expected)}`);
  }
  assert.doesNotMatch(workflow, /secrets\.|HF_TOKEN|AWS_|GITHUB_TOKEN|prepare:poc/u, "CI must need no provider secrets and never run live preparation");
});

test("links the CI badge from the README", () => {
  const readme = readWorkspaceFile("README.md");
  assert.ok(
    readme.includes("https://github.com/MysterionRise/code-guesser/actions/workflows/ci.yml/badge.svg"),
    "README must carry the CI badge",
  );
});
