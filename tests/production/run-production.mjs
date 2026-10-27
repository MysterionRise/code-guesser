import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

import { normalizePlaywrightArgs } from "../e2e/run-playwright.mjs";
import { ensureProductionBuild, root } from "./build.mjs";

// Runs one Playwright project against `next start` on the production build (#45, #66): `pnpm test:a11y` names `a11y`,
// and `pnpm test:performance` names `performance`; anything after it goes to Playwright. A fresh build, such as the
// one CI makes, is reused; otherwise the game is built first.
const [project, ...rest] = process.argv.slice(2);
try {
  if (project === undefined || project.startsWith("-")) throw new Error("usage: run-production.mjs <project> [playwright arguments]");
  if (ensureProductionBuild()) console.log("Built the game for production.");
  const require = createRequire(import.meta.url);
  const result = spawnSync(process.execPath, [require.resolve("@playwright/test/cli"), "test", "--config", "playwright.production.config.ts",
    `--project=${project}`, ...normalizePlaywrightArgs(rest)], { cwd: root, stdio: "inherit" });
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
