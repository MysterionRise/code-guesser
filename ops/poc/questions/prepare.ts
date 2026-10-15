import {
  QUESTION_LAYER_SCHEMA_VERSION, QuestionLayerRejected, canonicalHash, parseArtifactDecks, parseQuestionLayer, parseQuestionLayers,
  type DeckId, type LayerContext, type ParsedDeck, type ParsedFixture, type QuestionLayer, type QuestionLayers,
} from "../../../packages/artifact/src/index";
import { auditRound, deckAudit, roundLeak, type RoundAudit } from "./audit";
import { QuestionsError, type ModelClient } from "./client";
import { designFor, layerFrom, writerRequest } from "./designs";

/**
 * `pnpm prepare:questions` (#127): writes each round's question layer with a model that knows the answer, refuses
 * any layer the parser or the code-blind audit catches, and keeps the rest. A refused layer leaves its round with
 * the static question and hints. Logs carry codes and counts only.
 */
export interface PrepareQuestionsOptions {
  readonly artifact: unknown;
  readonly client: ModelClient;
  /** Decks to write layers for; every deck with a design when unset. */
  readonly decks?: readonly DeckId[];
  /** At most this many rounds a deck, for a pilot. */
  readonly limit?: number;
  /** Rounds written at once. */
  readonly concurrency?: number;
  readonly log: (line: string) => void;
}

export interface DeckReport {
  readonly deck: DeckId;
  readonly attempted: number;
  readonly kept: number;
  readonly refused: Readonly<Record<string, number>>;
  readonly audit: ReturnType<typeof deckAudit>;
  readonly rounds: readonly (RoundAudit & Readonly<{ kept: boolean; code?: string }>)[];
}

export interface PreparedQuestions {
  readonly file: QuestionLayers;
  readonly decks: readonly DeckReport[];
}

const layerContext = (artifact: unknown, decks: readonly ParsedDeck[]): LayerContext => ({
  decks,
  algorithms: ((artifact as { crawlSnapshot?: { curated?: { algorithms?: unknown } } }).crawlSnapshot?.curated?.algorithms ?? []) as LayerContext["algorithms"],
});

/** Runs `work` over `items`, `limit` at a time, keeping their order. */
const pooled = async <Item, Result>(items: readonly Item[], limit: number, work: (item: Item) => Promise<Result>): Promise<Result[]> => {
  const results: Result[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await work(items[index]!);
    }
  }));
  return results;
};

type RoundOutcome = Readonly<{ fixture: ParsedFixture; layer?: QuestionLayer; audit?: RoundAudit; code?: string }>;

/** One round: write, repair once if refused, then audit. A provider failure ends the run; a refusal drops the layer. */
const prepareRound = async (client: ModelClient, fixture: ParsedFixture, deck: ParsedDeck, context: LayerContext): Promise<RoundOutcome> => {
  let refused: string | undefined;
  let layer: QuestionLayer | undefined;
  for (let attempt = 0; attempt < 2 && layer === undefined; attempt += 1) {
    const answer = await client.call(writerRequest(fixture, deck.id, deck.title, context, refused));
    try {
      layer = parseQuestionLayer(layerFrom(fixture, deck.id, answer.value), fixture, deck.id, context);
    } catch (error) {
      if (!(error instanceof QuestionLayerRejected)) throw error;
      refused = error.code;
    }
  }
  if (layer === undefined) return { fixture, code: refused! };
  const audit = await auditRound(client, fixture, layer);
  const leak = roundLeak(audit);
  return leak === undefined ? { fixture, layer, audit } : { fixture, audit, code: leak };
};

export const prepareQuestions = async (options: PrepareQuestionsOptions): Promise<PreparedQuestions> => {
  const decks = parseArtifactDecks(options.artifact);
  const artifactHash = canonicalHash(options.artifact);
  const context = layerContext(options.artifact, decks);
  const wanted = decks.filter((deck) => designFor(deck.id) !== undefined && (options.decks === undefined || options.decks.includes(deck.id)));
  if (options.decks?.some((id) => designFor(id) === undefined)) throw new QuestionsError("QUESTIONS_DECK_UNSUPPORTED");
  const kept: QuestionLayer[] = [];
  const reports: DeckReport[] = [];
  for (const deck of wanted) {
    const fixtures = [...deck.fixtures].sort((left, right) => left.roundId < right.roundId ? -1 : 1).slice(0, options.limit);
    const outcomes = await pooled(fixtures, options.concurrency ?? 4, (fixture) => prepareRound(options.client, fixture, deck, context));
    const audits = outcomes.flatMap(({ layer, audit }) => layer !== undefined && audit !== undefined ? [audit] : []);
    const summary = deckAudit(audits);
    const refused: Record<string, number> = {};
    for (const { code } of outcomes) if (code !== undefined) refused[code] = (refused[code] ?? 0) + 1;
    if (summary.within) kept.push(...outcomes.flatMap(({ layer }) => layer === undefined ? [] : [layer]));
    else options.log(`QUESTIONS_DECK_REFUSED ${deck.id}`);
    options.log(`QUESTIONS_DECK ${deck.id} attempted=${fixtures.length} kept=${summary.within ? audits.length : 0} ${Object.entries(refused)
      .sort().map(([code, count]) => `${code}=${count}`).join(" ")}`.trimEnd());
    reports.push(Object.freeze({
      deck: deck.id, attempted: fixtures.length, kept: summary.within ? audits.length : 0, refused: Object.freeze(refused), audit: summary,
      rounds: Object.freeze(outcomes.flatMap(({ fixture, layer, audit, code }) => audit === undefined ? []
        : [Object.freeze({ ...audit, roundId: fixture.roundId, kept: layer !== undefined && summary.within, ...(code ? { code } : {}) })])),
    }));
  }
  kept.sort((left, right) => left.roundId < right.roundId ? -1 : 1);
  const file = parseQuestionLayers({ schemaVersion: QUESTION_LAYER_SCHEMA_VERSION, artifactHash, model: options.client.model, layers: kept },
    artifactHash, context);
  return Object.freeze({ file, decks: Object.freeze(reports) });
};
