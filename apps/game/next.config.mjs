import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const gameRoot = dirname(fileURLToPath(import.meta.url));

/**
 * Headers on every response (#97). They are fixed when the game is built, so anything that depends on how the server
 * runs, the Content Security Policy's nonce and HSTS in public mode, is set per request in `src/middleware.ts`. The
 * Permissions-Policy turns off what the game never uses and leaves Web Share and the clipboard to the share button.
 */
const SECURITY_HEADERS = [
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
];

/**
 * The container image (#170) sets `CODEGUESSR_STANDALONE=1` to build Next's standalone server: only the files the
 * server needs, traced from the workspace root so pnpm's linked packages come along. TypeScript and the image
 * optimizer's sharp are traced but never loaded, since the config is plain JavaScript and the optimizer is off. Every
 * other build keeps `next start` and the game's own root.
 */
const standalone = process.env.CODEGUESSR_STANDALONE === "1";

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(standalone ? {
    output: "standalone",
    outputFileTracingExcludes: { "*": ["**/node_modules/typescript/**", "**/node_modules/sharp/**", "**/node_modules/@img/**"] },
  } : {}),
  outputFileTracingRoot: standalone ? join(gameRoot, "..", "..") : gameRoot,
  // The game shows no `next/image`, so `/_next/image` answers 404 rather than resize images on request.
  images: { unoptimized: true },
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  reactStrictMode: true,
  // A hint or an answer is a few hundred bytes; nothing a player sends a server action comes near this.
  experimental: { serverActions: { bodySizeLimit: "16kb" } },
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // The visualizer's frame is framed by the game itself; the later rule wins for the same header.
      { source: "/genui/frame", headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }] },
    ];
  },
};

export default nextConfig;
