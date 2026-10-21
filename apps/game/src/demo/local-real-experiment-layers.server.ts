import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  canonicalHash, parseQuestionLayers, type LayerContext, type LayerHint, type ParsedDeck, type QuestionLayer,
} from "../../../../packages/artifact/src/index";
import type { HintDetail, RoundScaffold } from "../components/arcade/mode-contract";
import { TRUSTED_QUESTION_LAYERS_HASH } from "./question-layers.pin.server";

/**
 * Question layers in the game (#127, #128): the file `pnpm prepare:questions` froze, read once beside the artifact.
 * The game shows a layer only when the file matches its pin, was written for this artifact, and passes the shared
 * parser again; otherwise every round keeps its static question and hints.
 */
export const QUESTION_LAYERS_RELATIVE_PATH = "src/demo/generated/question-layers.json";

export type RoundLayers = ReadonlyMap<string, QuestionLayer>;

export interface LayerLoadOptions {
  readonly path?: string;
  readonly trustedHash?: string;
}

/**
 * The artifact as the game loaded it: matched to its pin and parsed once (#166), so the layers check against those
 * decks and that hash instead of parsing and hashing the artifact again.
 */
export interface PinnedArtifact {
  readonly value: Readonly<Record<string, unknown>>;
  readonly decks: readonly ParsedDeck[];
  readonly hash: string;
}

/** The layers by round id, or none: a missing, mismatched, or refused file leaves the game without layers. */
export const loadQuestionLayers = (artifact: PinnedArtifact, options: LayerLoadOptions = {}): RoundLayers => {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(options.path ?? join(process.cwd(), QUESTION_LAYERS_RELATIVE_PATH), "utf8"));
  } catch {
    return new Map();
  }
  try {
    if (canonicalHash(value) !== (options.trustedHash ?? TRUSTED_QUESTION_LAYERS_HASH)) throw new Error("QUESTION_LAYERS_PIN");
    const context: LayerContext = {
      decks: artifact.decks,
      algorithms: ((artifact.value as { crawlSnapshot?: { curated?: { algorithms?: unknown } } }).crawlSnapshot?.curated?.algorithms ?? []) as LayerContext["algorithms"],
    };
    const file = parseQuestionLayers(value, artifact.hash, context);
    return new Map(file.layers.map((layer) => [layer.roundId, layer]));
  } catch (error) {
    console.error(`QUESTION_LAYERS_UNAVAILABLE ${error instanceof Error && /^[A-Z_ ]+$/u.test(error.message) ? error.message.replaceAll(" ", "_") : "REJECTED"}`);
    return new Map();
  }
};

/** The scaffold a round shows with its question. */
export const scaffoldOf = (layer: QuestionLayer): RoundScaffold => layer.design === "trace-it"
  ? Object.freeze({ design: "trace-it", watch: layer.scaffold.watch })
  : Object.freeze({ design: "marker-hunt", prompts: layer.scaffold.prompts });

/** What a layer hint shows beside its text, if anything. */
export const detailOf = (hint: LayerHint): HintDetail | null =>
  hint.kind === "lines" ? Object.freeze({ kind: "lines", lines: hint.lines })
    : hint.kind === "trace" ? Object.freeze({ kind: "trace", input: hint.input, frames: hint.frames })
      : null;

/** A round's hints in a game: the layer's when the game shows layers and the round has one, otherwise the static ones. */
export const roundHints = (roundId: string, staticHints: readonly string[], layers: RoundLayers, showLayers: boolean)
  : readonly Readonly<{ text: string; detail: HintDetail | null }>[] => {
  const layer = showLayers ? layers.get(roundId) : undefined;
  return layer === undefined
    ? staticHints.map((text) => Object.freeze({ text, detail: null }))
    : layer.hints.map((hint) => Object.freeze({ text: hint.text, detail: detailOf(hint) }));
};
