import { FACTORS } from "./arms";
import {
  DEAL_TARGETS,
  DUEL_DECIDERS,
  DUEL_LINKS,
  DUEL_OUTCOMES,
  EVENT_SCHEMA_VERSION,
  FIRST_PLAYS,
  GENUI_ACTIONS,
  GENUI_FALLBACKS,
  ORIGINS,
  PHASES,
  SHARE_ROUTES,
  SOURCES,
  VIEWPORTS,
  type CurrentEventType,
} from "./events";

/**
 * The event log's schema in words (#99), for the privacy page: what every event carries, and each event's own fields.
 * A test holds its keys to the schema's (`EVENT_BASE_KEYS`, `EVENT_FIELDS`), so the page can neither describe a field
 * the parser refuses nor leave one out, and every closed choice is listed from the schema's own values.
 */

/** One event as the privacy page tells it: what happened, and what each of its own fields says. */
export interface EventDoc {
  readonly summary: string;
  readonly fields: Readonly<Record<string, string>>;
}

const choices = (values: readonly string[]): string => values.join(", ");

const ROUND = "The round, 1 to 5.";
const SINCE_ROUND = "Milliseconds since the round began.";

/** What every event carries. */
export const BASE_FIELD_DOCS: Readonly<Record<string, string>> = Object.freeze({
  v: `The schema's version, ${EVENT_SCHEMA_VERSION}.`,
  type: "Which event it is, from the list below.",
  game: "A random id made when the game is dealt. It ties one game's events together and nothing else: the next game gets a new one.",
  day: "The day it happened, in UTC, with no time of day.",
  source: `Who played (${choices(SOURCES)}): a real game, an automated playtest, or a test.`,
  origin: `How the game was dealt (${choices(ORIGINS)}): a deal of its own, or a friend's game of a duel challenge.`,
  deck: "The deck the game was dealt from, or the mix, or today's five.",
  design: `The explainer design the game drew (${choices(FACTORS.design)}).`,
  theme: `The look the game drew (${choices(FACTORS.theme)}).`,
  layer: `Whether the game drew question layers (${choices(FACTORS.layer)}).`,
});

/** Each event the current version writes. */
export const EVENT_DOCS: Readonly<Record<CurrentEventType, EventDoc>> = Object.freeze({
  game_dealt: { summary: "A game was dealt.", fields: {} },
  game_viewed: {
    summary: "The game showed in a browser.",
    fields: { viewport: `The screen's width as a bucket (${choices(VIEWPORTS)}): under 640 pixels, under 1,024, or wider.` },
  },
  hint_revealed: {
    summary: "A hint was bought.",
    fields: { round: ROUND, hint: "Which hint, 1 or 2.", ms: SINCE_ROUND },
  },
  round_revealed: {
    summary: "An answer was locked in and revealed.",
    fields: { round: ROUND, correct: "Whether the answer was right; never which option was picked.", hints: "Hints bought in the round, 0 to 2.", ms: SINCE_ROUND },
  },
  game_completed: {
    summary: "The fifth round was revealed.",
    fields: { score: "The game's score.", correct: "Rounds answered right, 0 to 5.", hints: "Hints bought in the whole game.", ms: "Milliseconds since the deal." },
  },
  deal_again: {
    summary: "A finished game's player went on to another game.",
    fields: { to: `Where (${choices(DEAL_TARGETS)}): a new deal of the same deck, the deck chooser, or a duel's rematch.` },
  },
  result_shared: {
    summary: "A finished game's spoiler-free result was shared.",
    fields: { via: `How (${choices(SHARE_ROUTES)}): the browser's share sheet or the clipboard.` },
  },
  genui_call: {
    summary: "The server asked the model for an explainer or a host reply.",
    fields: {
      round: ROUND,
      phase: `Before or after the answer was locked (${choices(PHASES)}).`,
      ok: "Whether the call succeeded.",
      status: "The provider's HTTP status when the call failed; 0 otherwise.",
      calls: "How many pieces the model rendered.",
      tokensIn: "Tokens sent to the model, as the provider counts them.",
      tokensOut: "Tokens the model sent back.",
      ms: "How long the call took, in milliseconds.",
    },
  },
  genui_interaction: {
    summary: "The player used an explainer or the host.",
    fields: { round: ROUND, action: `What they did (${choices(GENUI_ACTIONS)}); never what they typed.` },
  },
  genui_fallback: {
    summary: "An explainer or the host gave way to the plain reveal.",
    fields: { round: ROUND, reason: `Why (${choices(GENUI_FALLBACKS)}).` },
  },
  duel_created: {
    summary: "A finished game became a duel challenge; counted once, however often its link is asked for.",
    fields: { firstPlay: `Whether the game was its deal's first try on this server (${choices(FIRST_PLAYS)}; today's five is everyone's, so "shared").` },
  },
  duel_completed: {
    summary: "A friend's finished game of a challenge was compared with the challenger's, the first time.",
    fields: {
      outcome: `How the friend did (${choices(DUEL_OUTCOMES)}); never either player's score.`,
      decidedBy: `What decided it (${choices(DUEL_DECIDERS)}): the score, then fewer hints, then more rounds right.`,
    },
  },
  duel_link_copied: {
    summary: "A duel link went out. The link itself is never recorded.",
    fields: { link: `Which (${choices(DUEL_LINKS)}).`, via: `How (${choices(SHARE_ROUTES)}).` },
  },
});
