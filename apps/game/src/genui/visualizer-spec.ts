import { isSafeText } from "./render-catalog";

/**
 * The visualizer design (#115): after the lock, the model writes one small self-contained HTML page that shows the
 * round's code at work, for example a sort step by step or a doctest traced.
 *
 * The sandbox is the boundary: the page runs in an iframe with `sandbox="allow-scripts"` and no same-origin, so
 * it gets an opaque origin, and the CSP this module puts ahead of the model's markup allows no network at all.
 * The checks here are defence in depth: they refuse a page that even tries to reach out, so a mistake in the
 * sandbox is not the only thing between the page and the player.
 */

export const MAX_VISUALIZER_BYTES = 40_000;

export interface Visualizer {
  readonly title: string;
  readonly summary: string;
  readonly html: string;
}

export class VisualizerRejected extends Error {
  public constructor(public readonly code: string) {
    super(`VISUALIZER_REJECTED ${code}. Fix this and call render_visualizer again.`);
    this.name = "VisualizerRejected";
  }
}

const reject = (code: string): never => { throw new VisualizerRejected(code); };

/**
 * Markup and script that reach beyond the page, each with the code a refusal names. They match access, not words,
 * so a page may still say "the top of the heap" or style `margin-top`.
 */
const FORBIDDEN: readonly (readonly [string, RegExp])[] = [
  ["URL", /\b(?:https?|wss?|ftp|file|blob|javascript):|(?:src|href|action|srcset|poster)\s*=\s*["']?\s*\/\/|\bwww\.[a-z0-9-]+\./iu],
  ["TAG", /<\s*\/?\s*(?:meta|base|link|iframe|frame|frameset|object|embed|form|a|portal|applet)\b/iu],
  ["NETWORK", /\bfetch\s*\(|\b(?:XMLHttpRequest|WebSocket|EventSource|RTCPeerConnection)\b|\bsendBeacon\b|\bimportScripts\b|\bnew\s+(?:Shared)?Worker\b|\bimport\s*\(/u],
  ["STORAGE", /\b(?:localStorage|sessionStorage|indexedDB)\b|\bdocument\s*\.\s*cookie\b|\bcaches\s*\./u],
  ["ESCAPE", /\b(?:window|self|globalThis|document)\s*\.\s*(?:parent|top|opener|frameElement|location)\b|\b(?:parent|top|opener)\s*\.\s*(?:document|location|window|postMessage)\b|\bpostMessage\b|\blocation\s*(?:\.\s*(?:href|assign|replace)\b|=[^=])|\bwindow\s*\.\s*open\s*\(/u],
  ["CSS_IMPORT", /@import\b|url\s*\(\s*['"]?\s*(?!#|data:)/iu],
];

/** A visualizer page the browser may run, or a refusal with a code. */
export const parseVisualizer = (value: unknown): Visualizer => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return reject("SHAPE");
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join("|") !== "html|summary|title") return reject("SHAPE");
  const { title, summary, html } = record;
  if (typeof title !== "string" || title.trim().length === 0 || title.length > 80 || !isSafeText(title)) return reject("TITLE");
  if (typeof summary !== "string" || summary.trim().length === 0 || summary.length > 600 || !isSafeText(summary)) return reject("SUMMARY");
  if (typeof html !== "string" || html.trim().length === 0) return reject("HTML_EMPTY");
  if (new TextEncoder().encode(html).length > MAX_VISUALIZER_BYTES) return reject("HTML_SIZE");
  for (const [code, pattern] of FORBIDDEN) if (pattern.test(html)) reject(`HTML_${code}`);
  return Object.freeze({ title: title.trim(), summary: summary.trim(), html });
};

/** No network, frames, forms, or plugins: only the page's own inline script and style, and inline images. */
export const VISUALIZER_CSP = [
  "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'", "img-src data:", "font-src 'none'",
  "connect-src 'none'", "media-src 'none'", "frame-src 'none'", "worker-src 'none'", "form-action 'none'", "base-uri 'none'",
].join("; ");

/** The game's colours a visualizer page starts from, so it follows the player's theme (#125). */
export interface VisualizerPalette {
  readonly panel: string;
  readonly text: string;
  readonly border: string;
  readonly chip: string;
  readonly accent: string;
  readonly focus: string;
}

/** The original Terminal colours, used until the page's own theme is read. */
export const TERMINAL_PALETTE: VisualizerPalette = Object.freeze({
  panel: "#0b1c16", text: "#effff8", border: "#527565", chip: "#10251d", accent: "#baff65", focus: "#baff65",
});

/** A colour as a theme token holds it: hex, or rgb()/rgba() of numbers; nothing else reaches the frame's style. */
const COLOUR = /^(?:#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d+)\s*)?\))$/u;

/** The palette from theme tokens as read off the page, each falling back to Terminal's when it isn't a plain colour. */
export const paletteFrom = (read: (token: string) => string): VisualizerPalette => {
  const pick = (token: string, fallback: string): string => { const value = read(token).trim(); return COLOUR.test(value) ? value : fallback; };
  return Object.freeze({
    panel: pick("--panel", TERMINAL_PALETTE.panel), text: pick("--text", TERMINAL_PALETTE.text), border: pick("--border-soft", TERMINAL_PALETTE.border),
    chip: pick("--chip", TERMINAL_PALETTE.chip), accent: pick("--accent", TERMINAL_PALETTE.accent), focus: pick("--focus", TERMINAL_PALETTE.focus),
  });
};

/**
 * The document the iframe loads: the CSP first, then a base style, then the model's markup, then a small script
 * of the game's own that reports the body's height (not the document's, which never drops below the frame's own
 * and would grow the frame on every report), so the frame can fit the page without an inner scroll. The model's
 * markup may not post messages itself (`parseVisualizer`); the parent only reads a clamped number.
 */
export const visualizerDocument = (html: string, palette: VisualizerPalette = TERMINAL_PALETTE): string => `<!doctype html>
<html lang="en"><head><meta http-equiv="Content-Security-Policy" content="${VISUALIZER_CSP}"><meta charset="utf-8">
<style>body{margin:0;padding:12px;background:${palette.panel};color:${palette.text};font:14px/1.5 ui-sans-serif,system-ui,sans-serif}
button{font:inherit;padding:6px 12px;border-radius:8px;border:1px solid ${palette.border};background:${palette.chip};color:${palette.accent};cursor:pointer}
button:focus-visible{outline:3px solid ${palette.focus};outline-offset:2px}code,pre{font-family:ui-monospace,Menlo,monospace}</style>
</head><body>${html}<script>
(() => { const report = () => parent.postMessage({ codeguessrVisualizerHeight: document.body.getBoundingClientRect().height }, "*");
  new ResizeObserver(report).observe(document.body); report(); })();
</script></body></html>`;

export const VISUALIZER_TOOL_DESCRIPTION = "Write one self-contained HTML page that visualizes this round's code at work. "
  + `Inline CSS and JavaScript only, at most ${MAX_VISUALIZER_BYTES} bytes. No external resources, links, URLs, network, storage, or `
  + "access to any other window. Give it Step, Back, and Reset buttons with text labels, and a status line that "
  + "says in words what the current step shows.";
