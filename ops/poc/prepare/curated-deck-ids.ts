/**
 * The curated decks' ids, in the order they run (#36). This module imports nothing, so composition can name them
 * without importing the registry (`curated-decks.ts`), whose selectors reach composition through `selection.ts`.
 * A curated deck's profile section is keyed by its id and carries the deck's `templates`.
 */
export const CURATED_DECK_IDS = Object.freeze(["algorithm", "output", "fix", "missing-line", "name-function", "framework"] as const);
export type CuratedDeckId = (typeof CURATED_DECK_IDS)[number];

export const isCuratedDeck = (id: string): id is CuratedDeckId => (CURATED_DECK_IDS as readonly string[]).includes(id);
