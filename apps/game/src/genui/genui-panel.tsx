"use client";

import * as React from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, getToolName, isToolUIPart, type UIMessage } from "ai";

import { CatalogView } from "./catalog-view";
import { parseRenderCall, type RenderCall, type RenderLimits, type RoundPhase } from "./render-catalog";

export interface GenuiPanelProps {
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

/** Checked render calls in a chat's assistant messages; anything that fails the catalog is left out. */
export const renderCalls = (messages: readonly UIMessage[], phase: RoundPhase, limits: RenderLimits): RenderCall[] =>
  messages.filter(({ role }) => role === "assistant").flatMap(({ parts }) => parts.flatMap((part) => {
    if (!isToolUIPart(part) || part.state !== "output-available") return [];
    try {
      return [parseRenderCall({ component: getToolName(part), props: part.output }, phase, limits)];
    } catch {
      return [];
    }
  }));

/** Whether a finished request rendered nothing: an error, or an answer with no usable render call at all. */
export const fellBack = (status: string, sent: boolean, rendered: number, error: unknown): boolean =>
  error !== undefined || (status === "ready" && sent && rendered === 0);

/**
 * Generative UI's foundation (#101): one request to the server's guarded route, rendered through the catalog.
 * Any failure (no key, a refused or limited key, a timeout, a malformed call) leaves the static reveal as it is.
 */
export default function GenuiPanel({ roundId, pick, phase, panes, optionLabels, sessionToken }: GenuiPanelProps) {
  const transport = React.useMemo(() => new DefaultChatTransport({
    api: "/api/genui",
    prepareSendMessagesRequest: ({ messages }) => ({ body: { sessionToken: sessionToken(), roundId, messages } }),
  }), [roundId, sessionToken]);
  const { messages, sendMessage, status, error } = useChat({ id: `genui-${roundId}`, transport });
  const limits = React.useMemo(() => ({
    paneLineCounts: panes.map(({ text }) => text.split("\n").length),
    optionLabels,
  }), [panes, optionLabels]);
  const calls = renderCalls(messages, phase, limits);
  const busy = status === "submitted" || status === "streaming";
  // A step that ends with no usable call (cut off, or every call refused) adds no assistant message, so the request
  // having been sent is what counts.
  const failed = fellBack(status, messages.length > 0, calls.length, error);
  const headingId = `genui-heading-${roundId}`;

  return (
    <section className="genui-panel" aria-labelledby={headingId} data-genui-status={failed ? "fallback" : status}>
      <h3 id={headingId}>Explainer</h3>
      {messages.length === 0 && (
        <button type="button" className="secondary-action" onClick={() => { void sendMessage({ text: explainRequest(pick) }); }}>
          Explain this round
        </button>
      )}
      <div className="genui-output" aria-live="polite" aria-busy={busy}>
        {busy && <p className="genui-status">Working on it…</p>}
        {calls.map((call, index) => <CatalogView key={index} call={call} panes={panes} />)}
        {failed && <p className="genui-status">{GENUI_FALLBACK_MESSAGE}</p>}
      </div>
    </section>
  );
}
