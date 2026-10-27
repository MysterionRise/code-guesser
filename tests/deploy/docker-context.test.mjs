import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

/**
 * The image's build context (#170). A run journal holds provider bodies and a key file holds a credential, so neither
 * may ever reach `docker build`: `.dockerignore` lets in only what the game's build reads, then leaves out every
 * secret-shaped path again. These tests read `.dockerignore` with Docker's own rules.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path) => readFileSync(join(root, path), "utf8");

/** The rules in order, as Docker reads them: no comments or blank lines, `!` marking an exception. */
const rules = read(".dockerignore").split("\n").map((line) => line.trim()).filter((line) => line !== "" && !line.startsWith("#"))
  .map((line) => ({ exception: line.startsWith("!"), pattern: line.replace(/^!/u, "").replace(/^\/+|\/+$/gu, "") }));

/** A pattern with Docker's glob rules: `**` crosses directories, `*` and `?` stay inside one. */
const toRegExp = (pattern) => new RegExp(`^${pattern.split(/(\*\*\/|\*\*|\*|\?)/u).map((part) => ({
  "**/": "(?:.*/)?", "**": ".*", "*": "[^/]*", "?": "[^/]",
})[part] ?? part.replace(/[.+^${}()|[\]\\]/gu, "\\$&")).join("")}$`, "u");

/** Whether Docker leaves a path out: the last rule that matches the path, or a directory above it, decides. */
const excluded = (path) => {
  const prefixes = path.split("/").map((_, index, parts) => parts.slice(0, index + 1).join("/"));
  let out = false;
  for (const { exception, pattern } of rules) {
    const regExp = toRegExp(pattern);
    if (prefixes.some((prefix) => regExp.test(prefix))) out = !exception;
  }
  return out;
};

test("leaves out everything but the build's inputs, then every secret-shaped path again", () => {
  assert.equal(rules[0]?.pattern, "*", "the first rule must leave everything out");
  assert.equal(rules[0]?.exception, false);
  const lastException = rules.findLastIndex(({ exception }) => exception);
  const denied = rules.slice(lastException + 1).map(({ pattern }) => pattern);
  for (const pattern of ["**/.git", "**/.claude", "**/node_modules", "**/.next", "**/tmp", "**/.env*", "**/*.pem", "**/*.key",
    "**/id_rsa*", "**/id_ed25519*", "**/credentials", "**/.huggingface", "**/.config", "**/*.sqlite*", "**/*.jsonl*", "docs", "**/*.gif"]) {
    assert.ok(denied.includes(pattern), `.dockerignore must end by leaving out ${pattern}`);
  }
});

test("never sends a journal, a key, local state, the media, or another worktree", () => {
  for (const path of [
    ".git/HEAD", ".git", ".claude/settings.local.json", ".claude/worktrees/agent/apps/game/src/app/page.tsx",
    "node_modules/.pnpm/next/package.json", "apps/game/node_modules/next/package.json", "apps/game/.next/BUILD_ID",
    "ops/poc/stack/tmp/journal/run.jsonl", "ops/poc/stack/tmp/journal/run.jsonl.v7-2026-10-21", "ops/poc/questions/tmp/journal.jsonl",
    "ops/playtest/tmp/session.json", "ops/experiment/tmp/events-server/events-2026-10-26.jsonl", "apps/game/src/tmp/x.json",
    ".env", ".env.local", "apps/game/.env.production", "apps/game/src/.env",
    "apps/game/src/key.pem", "apps/game/src/server.key", "apps/game/src/id_ed25519", "ops/poc/stack/credentials/token",
    "ops/poc/stack/.huggingface/token", "packages/artifact/src/.config/openrouter/key", "apps/game/src/.cache/x",
    "apps/game/src/state.sqlite", "apps/game/src/state.sqlite-wal", "apps/game/src/events-2026-10-26.jsonl",
    "docs/media/demo.gif", "docs/deploy.md", "README.md", "CLAUDE.md", "apps/game/test/genui.test.ts", "tests/e2e/duel.spec.ts",
    "ops/poc/prepare/index.ts", "ops/deploy/smoke.mjs", "packages/content/src/index.ts", "Dockerfile",
  ]) {
    assert.ok(excluded(path), `${path} must stay out of the build context`);
  }
});

/** The files git tracks; a fresh checkout, which the server builds from, holds these and no others. */
const tracked = () => {
  const listed = spawnSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" });
  assert.equal(listed.status, 0, listed.stderr);
  return listed.stdout.split("\0").filter((path) => path !== "");
};

test("sends everything the Dockerfile copies from the context", () => {
  const files = tracked();
  const sources = read("Dockerfile").split("\n").filter((line) => /^COPY\s/u.test(line) && !/--from=/u.test(line))
    .flatMap((line) => line.trim().split(/\s+/u).slice(1, -1));
  assert.ok(sources.length >= 10, "the Dockerfile copies too little from its context");
  for (const source of sources) {
    const sent = files.filter((path) => (path === source || path.startsWith(`${source}/`)) && !excluded(path));
    assert.ok(sent.length > 0, `the Dockerfile copies ${source}, which .dockerignore leaves out`);
  }
  for (const path of ["apps/game/src/app/page.tsx", "apps/game/src/demo/generated/local-real-rounds.json",
    "apps/game/src/demo/generated/question-layers.json", "packages/artifact/src/index.ts"]) {
    assert.ok(!excluded(path), `${path} must reach the build`);
  }
});

test("lets in no tracked file outside the game, the artifact parser, and the workspace manifests", () => {
  const sent = tracked().filter((path) => !excluded(path));
  const allowed = /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|ops\/deploy\/entrypoint\.sh|packages\/[\w-]+\/package\.json|packages\/artifact\/src\/.+|apps\/game\/(?:package\.json|next\.config\.mjs|next-env\.d\.ts|tsconfig\.json|src\/.+))$/u;
  assert.deepEqual(sent.filter((path) => !allowed.test(path)), []);
  assert.ok(sent.includes("apps/game/src/app/page.tsx"));
});
