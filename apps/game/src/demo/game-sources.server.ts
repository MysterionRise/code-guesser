import "server-only";

import { DAILY_DECK, MIXED_DECK, type SessionDeckId } from "./local-real-experiment-domain.server";
import type { LocalRealExperiment } from "./local-real-experiment.server";

/** What a game is dealt from: a deck, the mix of five (#56), or today's five (#74). */
export interface GameSource {
  readonly id: SessionDeckId;
  readonly title: string;
  readonly description: string;
}

/** Today's five as the chooser and a link preview name it; its game adds the date. */
export const DAILY_TITLE = "Today’s five";
export const DAILY_DESCRIPTION = "The same mixed five all day, new tomorrow.";

/**
 * Everything this artifact deals a game from, by the titles and descriptions its decks publish: today's five and the
 * mix first when it offers them, then each deck. Nothing here reads a round.
 */
export const gameSources = ({ decks, mixed }: Pick<LocalRealExperiment, "decks" | "mixed">): readonly GameSource[] => Object.freeze([
  ...(mixed ? [
    { id: DAILY_DECK, title: DAILY_TITLE, description: DAILY_DESCRIPTION },
    { id: MIXED_DECK, title: mixed.title, description: mixed.description },
  ] as const : []),
  ...decks.map(({ id, title, description }) => ({ id, title, description })),
]);
