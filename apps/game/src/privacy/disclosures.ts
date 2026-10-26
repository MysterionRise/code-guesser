import "server-only";

import { CHALLENGE_TTL_MS, MAX_TOKEN_LENGTH, RESULT_TTL_MS } from "../demo/local-real-experiment-duel-token.server";
import { GAME_TTL_MS } from "../demo/local-real-experiment-session.server";
import { BASE_FIELD_DOCS, EVENT_DOCS, type EventDoc } from "../experiment/event-docs";
import { RAW_RETENTION_DAYS } from "../experiment/event-store.server";
import { PLAYS_CAPACITY } from "../server/state-store.server";

/**
 * What each feature keeps or sends (#99), as the privacy page tells it: one entry per feature, its fields or keys,
 * and how long anything lasts, read from the code's own limits so the page can't drift from them. A feature that
 * starts keeping or sending something adds its entry here, and the page shows it.
 */

/** One field, key, or piece of data a feature keeps or sends, and what it says. */
export interface DisclosureItem {
  readonly name: string;
  readonly description: string;
}

export interface Disclosure {
  readonly id: string;
  readonly title: string;
  /** What the feature keeps or sends, where it goes, and for how long, a paragraph each. */
  readonly summary: readonly string[];
  /** Its fields or keys. An empty list says the feature keeps none yet, and `empty` says so in words. */
  readonly items: readonly DisclosureItem[];
  readonly empty?: string;
  /** The events it records, each with its own fields: the event log's schema in words. */
  readonly events?: Readonly<Record<string, EventDoc>>;
  readonly links?: readonly Readonly<{ href: string; label: string }>[];
}

/** What nothing in CodeGuessr records, stores, or logs. */
export const NEVER_RECORDED: readonly string[] = Object.freeze([
  "Your IP address.",
  "Your browser's user agent.",
  "A cookie, or any id that follows you from one game to the next.",
  "A name you put in a duel link.",
  "Anything you type to the host.",
  "A round's code or options, or which option you picked.",
]);

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const items = (described: Readonly<Record<string, string>>): readonly DisclosureItem[] =>
  Object.freeze(Object.entries(described).map(([name, description]) => Object.freeze({ name, description })));

export const DISCLOSURES: readonly Disclosure[] = Object.freeze([
  {
    id: "event-log",
    title: "The event log",
    summary: [
      "A server that keeps an event log writes one line for each thing that happens in a game: a deal, a hint, an answer, a finished game, where its player went next, and what they did with an explainer. It counts games, never players, so it can tell whether a design or a theme makes the game more fun.",
      `The lines are kept as they are for ${RAW_RETENTION_DAYS} days, then only as daily totals per deck and arms. Every event carries the fields below, and each event its own; the server refuses to store a field this list doesn't name.`,
    ],
    items: items(BASE_FIELD_DOCS),
    events: EVENT_DOCS,
  },
  {
    id: "game",
    title: "Your game in progress",
    summary: [
      "Your game's progress lives in a signed token the page holds, not in a cookie. So that a round takes one answer, the server keeps your game's random id and how many steps it has taken (each hint and each answer is one), in memory and in its own state file, until the game expires.",
    ],
    items: items({
      "game id": "The game's random id, the same one the event log names.",
      step: "How many hints and answers the game has taken.",
      expiry: `${GAME_TTL_MS / HOUR_MS} hours after the deal, when both are deleted.`,
    }),
  },
  {
    id: "plays",
    title: "Plays of a deal",
    summary: [
      "For each seeded deal and each duel challenge, the server counts how many games revealed a round, so a challenge can say whether it was its deal's first try. A count names a deal or a challenge, never a player or a game.",
    ],
    items: items({
      count: `Games that revealed a round, for up to ${PLAYS_CAPACITY.toLocaleString("en-US")} deals and challenges; the ones touched longest ago are dropped first.`,
    }),
  },
  {
    id: "share",
    title: "Shared results",
    summary: [
      "Sharing a finished game sends nothing to CodeGuessr. Your browser's share sheet, or the clipboard, gets a line with the deck, how many rounds were right, the score, a grid of right, right after hints, and missed, and the game's own address.",
    ],
    items: items({
      deck: "Which deck the game was dealt from.",
      deal: "The deal's seed, so whoever opens the link plays the same five rounds.",
      game: "Which game of the deal it was.",
      date: "For today's five, the line names its date.",
    }),
  },
  {
    id: "duel",
    title: "Duel links",
    summary: [
      `A challenge or result link carries a token sealed with AES-256-GCM under the server's key, so nobody can read or change it, and nobody can learn the deal's seed from it. A challenge deals for ${CHALLENGE_TTL_MS / DAY_MS} days, a result shows for ${RESULT_TTL_MS / DAY_MS}, and neither is longer than ${MAX_TOKEN_LENGTH.toLocaleString("en-US")} characters.`,
      "A name you add goes after the link's #, which a browser never sends to any server: CodeGuessr never sees it.",
    ],
    items: items({
      challenge: "The deal, a digest of the rounds it dealt, the challenger's arms, whether each round was right, its hints and points, the best score, whether it was the deal's first try, a keyed id for the challenge, and when it was made.",
      result: "Both games' rounds as above, the deck, the date of a challenge on today's five, and which play of the link it was.",
      names: "Only in the part after #, as from= and vs=.",
    }),
  },
  {
    id: "browser",
    title: "Your browser's storage",
    summary: ["CodeGuessr sets no cookies and keeps nothing in your browser's storage."],
    items: [],
    empty: "No keys yet. If a later version keeps your own records in this browser, each key is listed here.",
  },
  {
    id: "address",
    title: "Your network address",
    summary: [
      "So that one script can't flood the server, each request spends from a small allowance per player. The server reads your address from its proxy's header, cuts an IPv6 address to its /64, and keeps only a keyed hash of it, under a key made fresh each time the server starts, in memory, until its allowance is full again. The address itself is never stored, logged, or put in an event.",
    ],
    items: [],
  },
  {
    id: "model",
    title: "Explainers and the host",
    summary: [
      "Some games draw an explainer or a chat host, written by a language model. Those games send the round to OpenRouter and the model provider it routes to: before you answer, the deck, the question, the options' labels, the hints you bought, and your score; after you answer, the code and the reveal too; and whatever you type to the host. Nothing that identifies you goes with it, unless you type it.",
      "Each request asks OpenRouter to route only to providers that neither store nor train on prompts, and zero data retention is an OpenRouter account setting the server's operator turns on for its key. CodeGuessr stores no chat: the event log records only that a call happened, how it went, how long it took, and its token counts.",
    ],
    items: [],
    links: [
      { href: "https://openrouter.ai/docs/features/privacy-and-logging", label: "OpenRouter: provider logging" },
      { href: "https://openrouter.ai/docs/features/zdr", label: "OpenRouter: zero data retention" },
    ],
  },
  {
    id: "logs",
    title: "Server logs",
    summary: ["The server logs codes and counts, such as a refused link's code or a model call's token count: never a request's address, a link, a token, or a round's content."],
    items: [],
  },
  {
    id: "gpc",
    title: "Global Privacy Control",
    summary: [
      "A browser that sends Sec-GPC: 1 when a game is dealt gets a game that records no events. In a duel, the friend's own browser decides for the friend's game.",
    ],
    items: [],
  },
] satisfies Disclosure[]);
