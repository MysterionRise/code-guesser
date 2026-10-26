import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const game = join(root, "apps", "game");
export const built = join(game, ".next");

/** What the production build is made from: the game's sources and settings, the artifact package it bundles, and the lockfile. */
const INPUTS = [
  join(game, "src"),
  join(game, "next.config.mjs"),
  join(game, "package.json"),
  join(root, "packages", "artifact", "src"),
  join(root, "pnpm-lock.yaml"),
];

function newestUnder(path) {
  const stat = statSync(path);
  if (!stat.isDirectory()) return stat.mtimeMs;
  return Math.max(0, ...readdirSync(path).map((name) => newestUnder(join(path, name))));
}

/**
 * Whether `.next` holds a production build newer than everything it is made from. `next dev` writes its own output to
 * the same directory and drops `BUILD_ID`, so a dev server run since the build counts as no build.
 */
export const buildIsFresh = () => existsSync(join(built, "BUILD_ID")) && existsSync(join(built, "server", "instrumentation.js"))
  && statSync(join(built, "BUILD_ID")).mtimeMs > Math.max(...INPUTS.map(newestUnder));

/**
 * Reuses a fresh production build, such as the one CI makes before its checks, and builds one otherwise; a loaded
 * machine takes over three minutes to build. Returns whether it built.
 */
export function ensureProductionBuild() {
  if (buildIsFresh()) return false;
  const result = spawnSync("pnpm", ["--filter", "@codeguessr/game", "build"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    timeout: 400_000,
  });
  if (result.status !== 0) throw new Error(`game build failed\n${result.stdout}\n${result.stderr}`);
  return true;
}
