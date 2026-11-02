"use client";

import * as React from "react";

import { TERMINAL_PALETTE, paletteFrom, visualizerDocument, type Visualizer } from "./visualizer-spec";

/** The frame's height before the page reports, and the range a report may set. */
const START_HEIGHT = 480;
const MIN_HEIGHT = 240;
const MAX_HEIGHT = 1_100;
/** How long a page may take to report its height before it counts as dead, and how long after its load an error does. */
export const NO_REPORT_MS = 6_000;
export const ERROR_WINDOW_MS = 4_000;
/** The frame's accessible name; the figure's caption beside it carries the page's own title. */
export const FRAME_TITLE = "Visualization of this round's code";

/** A height a visualizer frame reported, clamped; anything else from the frame is ignored. */
export const reportedHeight = (data: unknown): number | null => {
  if (typeof data !== "object" || data === null) return null;
  const height = (data as Record<string, unknown>).codeguessrVisualizerHeight;
  return typeof height === "number" && Number.isFinite(height) ? Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(height) + 4)) : null;
};

/** Whether a message from the frame is the game's own report of a script error in the page. */
export const reportedError = (data: unknown): boolean =>
  typeof data === "object" && data !== null && (data as Record<string, unknown>).codeguessrVisualizerError === true;

/**
 * A checked visualizer page in a sandbox: scripts may run, but with an opaque origin, so the page can't reach the
 * game, its storage, or its cookies; it may not open windows, submit forms, or navigate the game; and its own CSP
 * allows no network. The summary beside it says in words what it shows.
 *
 * The frame loads the game's constant shell (`app/genui/frame/route.ts`), which brings the visualizer's own policy,
 * and is then sent the page once. A `srcdoc` frame would inherit the game's nonce policy and block the page's scripts.
 * The shell's origin is opaque, so the message can only be addressed to `"*"`; it goes once, to the shell just loaded.
 *
 * A page that dies is reported (#238): one whose script errors within a few seconds of its load, or that never
 * reports its height, leaves a blank or broken frame, which playtest run 3 met with no way out. `onDead` tells the
 * panel, which then shows the static reveal and one "Try again" instead.
 */
export function VisualizerView({ visualizer, onDead }: { readonly visualizer: Visualizer; readonly onDead?: () => void }) {
  const frame = React.useRef<HTMLIFrameElement>(null);
  const sent = React.useRef(false);
  const [height, setHeight] = React.useState(START_HEIGHT);
  // When the page was posted to the frame, whether it has reported a height, and the dead-page timer.
  const posted = React.useRef<number | null>(null);
  const reported = React.useRef(false);
  const dead = React.useRef(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const died = React.useRef(onDead);
  died.current = onDead;
  const declareDead = React.useCallback(() => {
    if (dead.current) return;
    dead.current = true;
    if (timer.current !== null) clearTimeout(timer.current);
    died.current?.();
  }, []);
  // The page's theme tokens, read once in the browser, so the model's page starts in the player's colours.
  const palette = React.useMemo(() => typeof window === "undefined" ? TERMINAL_PALETTE
    : paletteFrom((token) => getComputedStyle(document.documentElement).getPropertyValue(token)), []);
  React.useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      if (reportedError(event.data)) {
        // An error while the page is still setting itself up means a dead page; one later, in a button's handler,
        // leaves a page the player can still read.
        if (posted.current === null || Date.now() - posted.current <= ERROR_WINDOW_MS) declareDead();
        return;
      }
      const next = reportedHeight(event.data);
      if (next === null) return;
      reported.current = true;
      if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; }
      setHeight(next);
    };
    window.addEventListener("message", listen);
    return () => {
      window.removeEventListener("message", listen);
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [declareDead]);
  return (
    <figure className="genui-visualizer">
      <figcaption>{visualizer.title}</figcaption>
      <iframe ref={frame} className="visualizer-frame" title={FRAME_TITLE} sandbox="allow-scripts" allow="" referrerPolicy="no-referrer"
        src="/genui/frame" style={{ height }} onLoad={() => {
          if (sent.current) return;
          sent.current = true;
          posted.current = Date.now();
          frame.current?.contentWindow?.postMessage(visualizerDocument(visualizer.html, palette), "*");
          timer.current = setTimeout(() => { if (!reported.current) declareDead(); }, NO_REPORT_MS);
        }} />
      <p className="visualizer-summary">{visualizer.summary}</p>
    </figure>
  );
}
