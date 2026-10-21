import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next.js needs `jsx: "preserve"` in tsconfig, which Vite 8's Oxc transform would follow and leave JSX
  // untransformed; tests compile it with React's automatic runtime instead.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.{ts,tsx}", "ops/**/*.test.{ts,tsx}"],
    // Vitest 2 never timed out a synchronous test, and Vitest 5 holds it to the 5 s default. The preparer's
    // composition tests (fix rounds and windows) run synchronously for 3 to 12 s on CI runners.
    testTimeout: 30_000,
  },
});
