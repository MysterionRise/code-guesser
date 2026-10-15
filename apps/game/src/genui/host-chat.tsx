"use client";

import * as React from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";

import { CatalogView, type HintOffer } from "./catalog-view";
import { renderViews } from "./genui-panel";
import type { RoundPhase } from "./render-catalog";

export interface HostChatProps {
  readonly roundId: string;
  /** Before the lock the host is blind to the code (#102); the server decides, this only labels the chat. */
  readonly phase: RoundPhase;
  readonly panes: readonly Readonly<{ label: string | null; text: string }>[];
  readonly optionLabels: readonly string[];
  readonly sessionToken: () => string;
  readonly hint: HintOffer;
}

export const HOST_FALLBACK = "The host isn’t available right now. The game plays on without them.";

/** The phase a past reply's components belong to, so a before-lock offer still shows (spent) after the lock. */
const phaseOf = (message: UIMessage): RoundPhase => message.parts.some((part) => part.type === "tool-offer_hint") ? "before-lock" : "after-lock";

/**
 * The host design (#104): a chat beside the round. Before the lock the host sees no code and may offer the next
 * hint, which the player buys with the round's own button logic; after the lock the same chat can discuss the code.
 */
export default function HostChat({ roundId, phase, panes, optionLabels, sessionToken, hint }: HostChatProps) {
  const transport = React.useMemo(() => new DefaultChatTransport({
    api: "/api/genui",
    prepareSendMessagesRequest: ({ messages }) => ({ body: { sessionToken: sessionToken(), roundId, design: "host", messages } }),
  }), [roundId, sessionToken]);
  const { messages, sendMessage, status, error } = useChat({ id: `host-${roundId}`, transport });
  const [draft, setDraft] = React.useState("");
  const limits = React.useMemo(() => ({ paneLineCounts: panes.map(({ text }) => text.split("\n").length), optionLabels }), [panes, optionLabels]);
  const busy = status === "submitted" || status === "streaming";
  const headingId = `host-heading-${roundId}`;
  const inputId = `host-input-${roundId}`;

  const send = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text.length === 0 || busy) return;
    setDraft("");
    void sendMessage({ text });
  };

  return (
    <aside className="host-chat" aria-labelledby={headingId} data-genui-design="host" data-genui-status={error ? "fallback" : status}>
      <h2 id={headingId}>Host</h2>
      <p className="host-note">{phase === "before-lock" ? "The host hasn’t seen the code and can’t tell you the answer." : "The round is over: ask about the code."}</p>
      <ol className="host-transcript" aria-live="polite" aria-busy={busy}>
        {messages.map((message) => message.role === "user"
          ? <li key={message.id} className="host-turn player"><span className="visually-hidden">You: </span>{message.parts.map((part) => part.type === "text" ? part.text : "").join("")}</li>
          : (
            <li key={message.id} className="host-turn host">
              <span className="visually-hidden">Host: </span>
              {renderViews([message], phaseOf(message), limits).map((view, index) => view.kind === "catalog"
                ? <CatalogView key={index} call={view.call} panes={panes} {...(phase === "before-lock" ? { hint } : {})} />
                : null)}
            </li>
          ))}
        {busy && <li className="host-turn host genui-status">The host is thinking…</li>}
      </ol>
      {error && <p className="genui-status" role="alert">{HOST_FALLBACK}</p>}
      <form className="host-form" onSubmit={send}>
        <label htmlFor={inputId}>Ask the host</label>
        <input id={inputId} value={draft} maxLength={500} onChange={(event) => setDraft(event.target.value)} disabled={busy} autoComplete="off" />
        <button type="submit" disabled={busy || draft.trim().length === 0}>Send</button>
      </form>
    </aside>
  );
}
