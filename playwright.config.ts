import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineConfig } from "@playwright/test";

const nodeExecutable = JSON.stringify(process.execPath);
// E2E_PORT moves the local dev server off 3000 when something else already listens there.
const port = Number(process.env.E2E_PORT ?? 3000);
const baseURL = `http://127.0.0.1:${port}`;
// Generative UI (#101) runs against a local stand-in for OpenRouter on the next port, never the real service.
export const FAKE_OPENROUTER_PORT = port + 1;
// The anonymous event log (#107) writes here during the browser tests, tagged as synthetic.
export const E2E_EVENTS_DIR = join(tmpdir(), `codeguessr-e2e-events-${port}`);
// Rate limits (#98) apply to the browser tests at ten times their public rates, so no test is throttled by the ones
// before it, while a test that names its own client in X-Forwarded-For can still spend its allowance.
export const E2E_RATE_LIMITS = 10;

export default defineConfig({
  testDir: "./tests/e2e",
  forbidOnly: true,
  retries: 0,
  workers: 1,
  use: {
    headless: true,
  },
  webServer: [
    {
      command: `${nodeExecutable} tests/e2e/fake-openrouter.mjs`,
      env: { FAKE_OPENROUTER_PORT: String(FAKE_OPENROUTER_PORT) },
      url: `http://127.0.0.1:${FAKE_OPENROUTER_PORT}/health`,
      timeout: 30_000,
      reuseExistingServer: false,
    },
    {
      command: `${nodeExecutable} node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${port}`,
      cwd: "apps/game",
      env: {
        GENUI_ENABLED: "1",
        OPENROUTER_API_KEY: "e2e-fake-key",
        OPENROUTER_BASE_URL: `http://127.0.0.1:${FAKE_OPENROUTER_PORT}/api/v1`,
        EXPERIMENT_EVENTS_DIR: E2E_EVENTS_DIR,
        EXPERIMENT_SOURCE: "synthetic",
        CODEGUESSR_RATE_LIMITS: String(E2E_RATE_LIMITS),
        CODEGUESSR_CLIENT_IP_HEADER: "X-Forwarded-For",
        // A game with no ?design=, ?theme=, or ?layer= plays static, in the original theme, with no question layer,
        // so tests that name none aren't dealt one at random (#106).
        EXPERIMENT_DISABLED: "design:catalog,design:composer,design:visualizer,design:host,theme:paper,theme:arcade,theme:contrast,layer:on",
      },
      url: baseURL,
      timeout: 300_000,
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: "provenance-accessibility",
      testMatch: /provenance-accessibility\.spec\.ts/,
      use: { baseURL },
    },
    {
      name: "language-accessibility",
      testMatch: /language-accessibility\.spec\.ts/,
      use: { baseURL },
    },
    {
      name: "privacy-accessibility",
      testMatch: /privacy-accessibility\.spec\.ts/,
      use: { baseURL },
    },
    {
      name: "arcade",
      testMatch: /(?:arcade-shell|accessibility-local|genui|events|themes|layers|share|rate-limits|duel|records)\.spec\.ts/,
      use: { baseURL },
    },
    {
      name: "security-headers",
      testMatch: /security-headers\.spec\.ts/,
      use: { baseURL },
    },
  ],
});
