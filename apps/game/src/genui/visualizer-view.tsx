"use client";

import * as React from "react";

import { TERMINAL_PALETTE, paletteFrom, visualizerDocument, type Visualizer } from "./visualizer-spec";

/** The frame's height before the page reports, and the range a report may set. */
const START_HEIGHT = 480;
const MIN_HEIGHT = 240;
const MAX_HEIGHT = 1_100;

/** A height a visualizer frame reported, clamped; anything else from the frame is ignored. */
export const reportedHeight = (data: unknown): number | null => {
  if (typeof data !== "object" || data === null) return null;
  const height = (data as Record<string, unknown>).codeguessrVisualizerHeight;
  return typeof height === "number" && Number.isFinite(height) ? Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(height) + 4)) : null;
};

/**
 * A checked visualizer page in a sandbox: scripts may run, but with an opaque origin, so the page can't reach the
 * game, its storage, or its cookies; it may not open windows, submit forms, or navigate the game; and its own CSP
 * allows no network. The summary beside it says in words what it shows.
 */
export function VisualizerView({ visualizer }: { readonly visualizer: Visualizer }) {
  const frame = React.useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = React.useState(START_HEIGHT);
  // The page's theme tokens, read once in the browser, so the model's page starts in the player's colours.
  const palette = React.useMemo(() => typeof window === "undefined" ? TERMINAL_PALETTE
    : paletteFrom((token) => getComputedStyle(document.documentElement).getPropertyValue(token)), []);
  React.useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const next = reportedHeight(event.data);
      if (next !== null) setHeight(next);
    };
    window.addEventListener("message", listen);
    return () => window.removeEventListener("message", listen);
  }, []);
  return (
    <figure className="genui-visualizer">
      <figcaption>{visualizer.title}</figcaption>
      <iframe ref={frame} className="visualizer-frame" title={visualizer.title} sandbox="allow-scripts" allow="" referrerPolicy="no-referrer"
        srcDoc={visualizerDocument(visualizer.html, palette)} style={{ height }} />
      <p className="visualizer-summary">{visualizer.summary}</p>
    </figure>
  );
}
