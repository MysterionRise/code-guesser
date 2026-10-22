"use client";

// First, so zod runs without eval (`z.config` there) before the chat libraries below build their schemas (#97).
import "./composer-spec";

import * as React from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";

import type { GenuiEvent } from "../experiment/events";
import { CatalogView, type HintOffer } from "./catalog-view";
import { renderViews, type GenuiPanelProps } from "./genui-panel";
import { isSafeText, type RoundPhase } from "./render-catalog";

export interface HostChatProps {
  readonly roundId: string;
  /** Before the lock the host is blind to the code (#102); the server decides, this only labels the chat. */
  readonly phase: RoundPhase;
  readonly panes: readonly Readonly<{ label: string | null; text: string }>[];
  readonly optionLabels: readonly string[];
  readonly sessionToken: () => string;
  readonly hint: HintOffer;
  /** After the lock, what the player picked and whether it was right; the server never tells the model, so the chat does. */
  readonly pick?: GenuiPanelProps["pick"];
  /** Told when the player writes to the host and when the host falls back, for the event log (#107). */
  readonly onEvent?: (event: GenuiEvent) => void;
}

export const HOST_FALLBACK = "The host isn’t available right now. The game plays on without them.";
export const HOST_PASTE_REFUSED = "The host can’t look at code before you lock in. Ask without pasting it.";
export const HOST_SILENT = "The host had nothing to add.";
/**
 * The most messages a request carries: the route refuses more (`MAX_TURNS * 2` in `model.server.ts`) and reads only
 * the latest turns anyway. Sending the whole history made a chat past eight exchanges fail for the rest of its round.
 */
export const HOST_HISTORY = 16;
/** The longest turn the route takes from a player (`MAX_TURN_LENGTH`), the pick's note included. */
export const HOST_TURN_LENGTH = 500;

/** The refusal code a failed request carries in its body, if any. */
const refusalOf = (error: Error | undefined): string | null => {
  if (error === undefined) return null;
  try {
    const parsed = JSON.parse(error.message) as { reason?: unknown };
    return typeof parsed.reason === "string" ? parsed.reason : null;
  } catch {
    return null;
  }
};

/** Plain text the model wrote outside its tools, shown only if it passes the same check as a tool's text. */
const replyText = (message: UIMessage): string[] => message.parts.flatMap((part) =>
  part.type === "text" && part.text.trim().length > 0 && part.text.length <= 600 && isSafeText(part.text) ? [part.text.trim()] : []);

/**
 * The outgoing turn, told the player's pick after the lock. Only the request carries it, so the transcript shows what
 * the player typed; without it the host took "I got it wrong" at its word after a right answer.
 */
export const withPick = (messages: readonly UIMessage[], pick: HostChatProps["pick"]): UIMessage[] => {
  const last = messages.at(-1);
  if (pick === undefined || last?.role !== "user") return [...messages];
  const note = `(I picked “${pick.label}”, which was ${pick.correct ? "right" : "wrong"}.)`;
  let told = false;
  const parts = last.parts.map((part) => {
    if (told || part.type !== "text") return part;
    told = true;
    return { ...part, text: `${note} ${part.text}`.slice(0, HOST_TURN_LENGTH) };
  });
  return [...messages.slice(0, -1), { ...last, parts }];
};

/** The phase a past reply's components belong to, so a before-lock offer still shows (spent) after the lock. */
const phaseOf = (message: UIMessage): RoundPhase => message.parts.some((part) => part.type === "tool-offer_hint") ? "before-lock" : "after-lock";

/**
 * The host design (#104): a chat beside the round. Before the lock the host sees no code and may offer the next
 * hint, which the player buys with the round's own button logic; after the lock the same chat can discuss the code.
 */
export default function HostChat({ roundId, phase, panes, optionLabels, sessionToken, hint, pick, onEvent }: HostChatProps) {
  // The transport outlives the lock, so it reads the pick when it sends.
  const pickNow = React.useRef(pick);
  pickNow.current = phase === "after-lock" ? pick : undefined;
  const transport = React.useMemo(() => new DefaultChatTransport({
    api: "/api/genui",
    prepareSendMessagesRequest: ({ messages }) =>
      ({ body: { sessionToken: sessionToken(), roundId, design: "host", messages: withPick(messages.slice(-HOST_HISTORY), pickNow.current) } }),
  }), [roundId, sessionToken]);
  const { messages, sendMessage, setMessages, status, error, clearError } = useChat({ id: `host-${roundId}`, transport });
  const [notice, setNotice] = React.useState<string | null>(null);
  const input = React.useRef<HTMLInputElement>(null);
  // A refused paste would ride along in every later request and be refused again; it leaves the history instead.
  React.useEffect(() => {
    if (error === undefined) return;
    if (refusalOf(error) !== "PASTED_CODE") { onEvent?.({ type: "genui_fallback", reason: "failed" }); return; }
    onEvent?.({ type: "genui_fallback", reason: "refused" });
    setMessages((current) => current.at(-1)?.role === "user" ? current.slice(0, -1) : current);
    clearError();
    setNotice(HOST_PASTE_REFUSED);
  }, [error, setMessages, clearError, onEvent]);
  // Only the latest offer can still be bought; earlier ones read as spent.
  const lastOffer = messages.reduce((last, message, at) => message.parts.some((part) => part.type === "tool-offer_hint") ? at : last, -1);
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
    setNotice(null);
    onEvent?.({ type: "genui_interaction", action: "chat" });
    void sendMessage({ text });
    // The input stays enabled while the host replies, so keyboard focus stays here.
    input.current?.focus();
  };

  return (
    <aside className="host-chat" aria-labelledby={headingId} data-genui-design="host" data-genui-status={error ? "fallback" : status}>
      <h2 id={headingId}>Host</h2>
      <p className="host-note">{phase === "before-lock" ? "The host hasn’t seen the code and can’t tell you the answer." : "The round is over: ask about the code."}</p>
      <ol className="host-transcript" aria-live="polite" aria-busy={busy}>
        {messages.map((message, at) => {
          if (message.role === "user") {
            return <li key={message.id} className="host-turn player"><span className="visually-hidden">You: </span>{message.parts.map((part) => part.type === "text" ? part.text : "").join("")}</li>;
          }
          const views = renderViews([message], phaseOf(message), limits);
          // Plain text stands in only for a reply with no component: beside a tool call it was the model talking to
          // itself ("The player wants… Per the rules…"), which a player should never read.
          const texts = views.length === 0 ? replyText(message) : [];
          return (
            <li key={message.id} className="host-turn host">
              <span className="visually-hidden">Host: </span>
              {texts.map((text, index) => <p key={`text-${index}`} className="genui-host">{text}</p>)}
              {views.map((view, index) => view.kind === "catalog"
                ? <CatalogView key={index} call={view.call} panes={panes} {...(phase === "before-lock" && at === lastOffer ? { hint } : {})} />
                : null)}
              {status !== "streaming" && texts.length === 0 && views.length === 0 && <p className="genui-host genui-status">{HOST_SILENT}</p>}
            </li>
          );
        })}
        {busy && <li className="host-turn host genui-status">The host is thinking…</li>}
      </ol>
      {notice && <p className="genui-status" role="alert">{notice}</p>}
      {error && refusalOf(error) !== "PASTED_CODE" && <p className="genui-status" role="alert">{HOST_FALLBACK}</p>}
      <form className="host-form" onSubmit={send}>
        <label htmlFor={inputId}>Ask the host</label>
        <input id={inputId} ref={input} value={draft} maxLength={HOST_TURN_LENGTH} onChange={(event) => setDraft(event.target.value)} autoComplete="off" />
        <button type="submit" disabled={busy || draft.trim().length === 0}>Send</button>
      </form>
    </aside>
  );
}
