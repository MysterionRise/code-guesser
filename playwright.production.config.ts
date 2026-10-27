import { defineConfig } from "@playwright/test";

// The production checks (#45, #66): accessibility and performance against `next start` on the production build, run
// by `tests/production/run-production.mjs`, which builds first unless a fresh build exists. `next dev` writes into the
// same `.next`, so they never run beside the browser tests' dev server.
const nodeExecutable = JSON.stringify(process.execPath);
/** Ten ports above the browser tests' dev server (E2E_PORT), clear of it and its stand-in for OpenRouter. */
export const PRODUCTION_PORT = Number(process.env.E2E_PORT ?? 3000) + 10;
const baseURL = `http://127.0.0.1:${PRODUCTION_PORT}`;
/** The server's session secret, so a test can seal a duel link the way the server does, such as an expired one. */
export const PRODUCTION_SESSION_SECRET = "production-checks-session-secret-not-for-real-use";

export default defineConfig({
  forbidOnly: true,
  retries: 0,
  // One production server answers every worker; the checks spread over the runner's cores.
  workers: process.env.CI ? 3 : 4,
  use: {
    headless: true,
    baseURL,
  },
  webServer: {
    command: `${nodeExecutable} node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port ${PRODUCTION_PORT}`,
    cwd: "apps/game",
    env: {
      NEXT_TELEMETRY_DISABLED: "1",
      // Generative UI stays off, so every game is the static one, and no request may leave the game's origin.
      GENUI_ENABLED: "0",
      CODEGUESSR_SESSION_SECRET: PRODUCTION_SESSION_SECRET,
      // Lab mode lets a test pick a game's theme and question layer by query (#106); a game that names neither plays
      // the original theme with no layer, so the budgets measure one game, not a random draw.
      EXPERIMENT_LAB: "1",
      EXPERIMENT_SOURCE: "synthetic",
      EXPERIMENT_DISABLED: "theme:paper,theme:arcade,theme:contrast,layer:on",
    },
    url: baseURL,
    timeout: 60_000,
    reuseExistingServer: false,
  },
  projects: [
    {
      // axe on every page and game state at 320 and 1280 px, keyboard-only play, and the pages odd addresses end on.
      name: "a11y",
      testDir: "./tests/accessibility",
      fullyParallel: true,
      timeout: 90_000,
      // A new round's card slides in; axe reads it settled.
      use: { contextOptions: { reducedMotion: "reduce" } },
    },
    {
      // Budgets and the game's network, measured one test at a time.
      name: "performance",
      testDir: "./tests/performance",
      workers: 1,
    },
  ],
});
