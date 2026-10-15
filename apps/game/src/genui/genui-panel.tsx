"use client";

import * as React from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from "ai";

import { CatalogView } from "./catalog-view";
import { parseComposerSpec, type ComposerSpec } from "./composer-spec";
import { ComposerView } from "./composer-view";
import type { Design } from "./designs";
import { parseRenderCall, type RenderCall, type RenderLimits, type RoundPhase } from "./render-catalog";
import { parseVisualizer, type Visualizer } from "./visualizer-spec";
import { VisualizerView } from "./visualizer-view";

export interface GenuiPanelProps {
  readonly design: Design;
  readonly roundId: string;
  /** What the player picked and whether it was right; the server never tells the model, so the panel does. */
  readonly pick?: Readonly<{ label: string; correct: boolean }>;
  readonly phase: RoundPhase;
  readonly panes: readonly Readonly<{ label: string | null; text: string }>[];
  readonly optionLabels: readonly string[];
  /** The game's latest session token, read when a request is sent. */
  readonly sessionToken: () => string;
}

/** The fixed request the player's button sends; free chat arrives with the host arm (#104). */
export const explainRequest = (pick?: Readonly<{ label: string; correct: boolean }>): string =>
  pick === undefined ? "Explain this round."
    : `Explain this round. I picked “${pick.label}”, which was ${pick.correct ? "right" : "wrong"}.`;
export const GENUI_FALLBACK_MESSAGE = "The explainer isn’t available right now. The reveal above has the full answer.";

export type RenderedView =
  | Readonly<{ kind: "catalog"; call: RenderCall }>
  | Readonly<{ kind: "composer"; spec: ComposerSpec }>
  | Readonly<{ kind: "visualizer"; visualizer: Visualizer }>;

/**
 * Checked views in a chat's assistant messages, checked again here though the server already did: a catalog call
 * or a composed panel. Anything that fails its check is left out.
 */
export const renderViews = (messages: readonly UIMessage[], phase: RoundPhase, limits: RenderLimits): RenderedView[] =>
  messages.filter(({ role }) => role === "assistant").flatMap(({ parts }) => parts.flatMap((part): RenderedView[] => {
    if (!isToolUIPart(part) || part.state !== "output-available") return [];
    try {
      const name = getToolName(part);
      if (name === "compose_panel") return [{ kind: "composer", spec: parseComposerSpec(composerInput(part.output), limits) }];
      if (name === "render_visualizer") return [{ kind: "visualizer", visualizer: parseVisualizer(part.output) }];
      return [{ kind: "catalog", call: parseRenderCall({ component: name, props: part.output }, phase, limits) }];
    } catch {
      return [];
    }
  }));

/** A checked spec turned back into the tool's list form, so the browser runs the same check as the server. */
const composerInput = (output: unknown): unknown => {
  if (typeof output !== "object" || output === null) return output;
  const { root, elements } = output as { root?: unknown; elements?: unknown };
  if (typeof elements !== "object" || elements === null) return output;
  return { root, elements: Object.entries(elements).map(([id, item]) => ({ id, ...(item as object) })) };
};

/** How each design names its panel, its button, and its wait. */
const PANEL_TEXT: Readonly<Record<Design, Readonly<{ heading: string; button: string; busy: string }>>> = Object.freeze({
  catalog: { heading: "Explainer", button: "Explain this round", busy: "Working on it…" },
  composer: { heading: "Explainer", button: "Explain this round", busy: "Laying out an explanation…" },
  visualizer: { heading: "Visualizer", button: "Visualize this round", busy: "Building a visualization; this can take half a minute…" },
  host: { heading: "Host", button: "Ask the host", busy: "The host is thinking…" },
});

/** Whether a finished request rendered nothing: an error, or an answer with no usable render call at all. */
export const fellBack = (status: string, sent: boolean, rendered: number, error: unknown): boolean =>
  error !== undefined || (status === "ready" && sent && rendered === 0);

/**
 * Generative UI's foundation (#101): one request to the server's guarded route, rendered through the catalog.
 * Any failure (no key, a refused or limited key, a timeout, a malformed call) leaves the static reveal as it is.
 */
export default function GenuiPanel({ design, roundId, pick, phase, panes, optionLabels, sessionToken }: GenuiPanelProps) {
  const transport = React.useMemo(() => new DefaultChatTransport({
    api: "/api/genui",
    prepareSendMessagesRequest: ({ messages }) => ({ body: { sessionToken: sessionToken(), roundId, design, messages } }),
  }), [roundId, design, sessionToken]);
  const { messages, sendMessage, status, error } = useChat({ id: `genui-${roundId}`, transport });
  const limits = React.useMemo(() => ({
    paneLineCounts: panes.map(({ text }) => text.split("\n").length),
    optionLabels,
  }), [panes, optionLabels]);
  const views = renderViews(messages, phase, limits);
  const busy = status === "submitted" || status === "streaming";
  // A step that ends with no usable call (cut off, or every call refused) adds no assistant message, so the request
  // having been sent is what counts.
  const failed = fellBack(status, messages.length > 0, views.length, error);
  const headingId = `genui-heading-${roundId}`;

  return (
    <section className="genui-panel" aria-labelledby={headingId} data-genui-status={failed ? "fallback" : status} data-genui-design={design}>
      <h3 id={headingId}>{PANEL_TEXT[design].heading}</h3>
      {messages.length === 0 && (
        <button type="button" className="secondary-action" onClick={() => { void sendMessage({ text: explainRequest(pick) }); }}>
          {PANEL_TEXT[design].button}
        </button>
      )}
      <div className="genui-output" aria-live="polite" aria-busy={busy}>
        {busy && <p className="genui-status">{PANEL_TEXT[design].busy}</p>}
        {views.filter((view, index) => view.kind === "catalog" || !views.slice(index + 1).some(({ kind }) => kind === view.kind)).map((view, index) => view.kind === "composer"
          ? <ComposerView key={index} spec={view.spec} panes={panes} />
          : view.kind === "visualizer" ? <VisualizerView key={index} visualizer={view.visualizer} />
            : <CatalogView key={index} call={view.call} panes={panes} />)}
        {failed && <p className="genui-status">{GENUI_FALLBACK_MESSAGE}</p>}
      </div>
    </section>
  );
}
