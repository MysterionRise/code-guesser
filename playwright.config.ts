import { defineConfig } from "@playwright/test";

const nodeExecutable = JSON.stringify(process.execPath);
// E2E_PORT moves the local dev server off 3000 when something else already listens there.
const port = Number(process.env.E2E_PORT ?? 3000);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  forbidOnly: true,
  retries: 0,
  workers: 1,
  use: {
    headless: true,
  },
  webServer: {
    command: `${nodeExecutable} node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${port}`,
    cwd: "apps/game",
    url: baseURL,
    timeout: 300_000,
    reuseExistingServer: false,
  },
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
      testMatch: /(?:arcade-shell|accessibility-local)\.spec\.ts/,
      use: { baseURL },
    },
  ],
});
