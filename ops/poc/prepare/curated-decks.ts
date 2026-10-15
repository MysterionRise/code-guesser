import { generateAlgorithmRounds } from "./algorithm-rounds";
import { CURATED_DECK_IDS, type CuratedDeckId } from "./curated-deck-ids";
import type { DeckAttempts, DeckOutcome, RunState } from "./diagnostics";
import { generateFixRounds } from "./fix-rounds";
import { generateMissingLineRounds } from "./missing-line-rounds";
import { generateOutputRounds } from "./output-rounds";
import type { CrawlProfile } from "./profile";
import type { GeneratedRounds } from "./round-helpers";
import { selectAlgorithm } from "./select-algorithm";
import { selectFix } from "./select-fix";
import { selectMissingLine } from "./select-missing-line";
import { selectOutput } from "./select-output";
import type { Context, PreparationDependencies } from "./types";

/**
 * The curated decks (#36): each one is an entry here, run in this order after the Stack and search decks. The
 * pipeline selects them in a loop, each seeing the candidates of every deck selected before it, and generates them
 * through one dependency; composition reads each deck's title from the profile section keyed by its id. Adding one
 * needs no edit to the pipeline, the dependencies, or composition.
 */
export interface CuratedDeck<Selection = unknown> {
  readonly id: CuratedDeckId;
  /** Whether the profile's curated section configures this deck; an unconfigured deck is neither run nor skipped. */
  readonly configured: (profile: CrawlProfile) => boolean;
  /** Fills the deck's pool, refusing any candidate that collides with `otherDecks`. */
  readonly select: (
    context: Context,
    deps: PreparationDependencies,
    hashes: string[],
    state: RunState,
    attempt: DeckAttempts,
    otherDecks: () => readonly unknown[],
  ) => Promise<DeckOutcome<Selection>>;
  /** The deck's rounds from its selections, each bound to the final crawl snapshot. */
  readonly generate: (options: Readonly<{ profile: CrawlProfile; candidates: readonly unknown[] }>) => GeneratedRounds;
}

/** One registry entry, type-checked against its own selection type. */
const deck = <Selection>(entry: CuratedDeck<Selection>): CuratedDeck => entry as unknown as CuratedDeck;

/** In selection order: a deck sees the candidates of every deck before it. */
export const CURATED_DECKS: readonly CuratedDeck[] = Object.freeze([
  deck({
    id: "algorithm",
    configured: (profile) => profile.curated?.algorithm !== undefined,
    select: selectAlgorithm,
    generate: generateAlgorithmRounds,
  }),
  deck({
    id: "output",
    configured: (profile) => profile.curated?.output !== undefined,
    select: selectOutput,
    generate: generateOutputRounds,
  }),
  deck({
    id: "fix",
    configured: (profile) => profile.curated?.fix !== undefined,
    select: selectFix,
    generate: generateFixRounds,
  }),
  deck({
    id: "missing-line",
    configured: (profile) => profile.curated?.["missing-line"] !== undefined,
    select: selectMissingLine,
    generate: generateMissingLineRounds,
  }),
]);

if (CURATED_DECKS.map(({ id }) => id).join() !== CURATED_DECK_IDS.join()) throw new Error("INVARIANT_REJECTED");

export { CURATED_DECK_IDS, type CuratedDeckId };

export const curatedDeck = (id: CuratedDeckId): CuratedDeck => CURATED_DECKS.find((deck) => deck.id === id)!;
