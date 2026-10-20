import { defineConfig } from "vitest/config";

export default defineConfig({
  // Next.js needs `jsx: "preserve"` in tsconfig, which Vite 8's Oxc transform would follow and leave JSX
  // untransformed; tests compile it with React's automatic runtime instead.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.{ts,tsx}", "ops/**/*.test.{ts,tsx}"],
  },
});
