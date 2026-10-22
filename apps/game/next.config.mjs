import { dirname } from "node:path";
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

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: gameRoot,
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
