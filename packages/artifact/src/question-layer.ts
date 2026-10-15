import { labelStems, mentionsLabel, namesAlgorithm } from "./artifact";
import { STACK_LANGUAGES, type DeckId, type ParsedDeck, type ParsedFixture } from "./domain";

/**
 * Question layers (#127, #128): generative UI inside the question, written at preparation time by a model that
 * knows the answer, checked here, and frozen beside the artifact. A layer has a free scaffold, shown with the
 * question, that changes how a player reads the code and never what they know; and two generated hints, sold like
 * the static ones and partial on purpose. Every text is bounded and plain, and none may name an option, so a layer
 * that would give a round away is refused, and that round keeps its static question and hints.
 */
export const QUESTION_LAYER_SCHEMA_VERSION = "question-layer.v1";

/** Each deck's design; a deck missing here has no layers yet. */
export const QUESTION_DESIGNS = Object.freeze({ algorithm: "trace-it", language: "marker-hunt" } as const);
export type QuestionDesign = (typeof QUESTION_DESIGNS)[keyof typeof QUESTION_DESIGNS];

/**
 * What a Trace it scaffold may say a watched name holds: its kind of value, from this closed list, so the scaffold
 * can point at names without describing how the code uses them (free text named the mechanism in a live pilot).
 */
export const WATCH_KINDS = Object.freeze([
  "the input", "the result", "a list", "a list of lists", "a list of pairs", "a map", "a set", "a queue", "a stack",
  "an index", "a lower bound", "an upper bound", "a count", "a number", "a running total", "a value", "a flag",
  "a string", "a node", "a graph", "a matrix",
] as const);

/**
 * The questions a Marker hunt scaffold picks three of. Every one fits all twelve languages, so the questions a round
 * asks say nothing about which pair its code is in (tailored questions named features that did, in a live pilot).
 */
export const MARKER_PROMPTS = Object.freeze([
  "How does a block of code end?",
  "How does a statement end?",
  "How is a new name declared?",
  "How is a function defined?",
  "How are types written, if at all?",
  "How are comments written?",
  "How are strings written?",
  "How is a list or array written?",
  "How is a missing value written?",
  "How are names spelled: with underscores or capitals?",
  "How is a loop written?",
  "How does the code bring in other code?",
] as const);

/** A hint as plain text: what the static hint path shows, and what any structured hint falls back to. */
export interface TextHint { readonly kind: "text"; readonly text: string }
/** Lines of the pane to look at, highlighted by the game. */
export interface LinesHint { readonly kind: "lines"; readonly text: string; readonly lines: readonly number[] }
/** A step-through on a tiny input: the state of what the scaffold says to watch, frame by frame. */
export interface TraceHint {
  readonly kind: "trace";
  readonly text: string;
  readonly input: string;
  readonly frames: readonly Readonly<{ label: string; state: string }>[];
}
export type LayerHint = TextHint | LinesHint | TraceHint;

/**
 * Which algorithm? — "Trace it": the variables to follow, by name and kind of value; then what the code needs from
 * its input or gives back; then, the strongest, a step-through on a tiny input.
 */
export interface TraceItLayer {
  readonly roundId: string;
  readonly design: "trace-it";
  readonly scaffold: Readonly<{ watch: readonly Readonly<{ name: string; role: string }>[] }>;
  readonly hints: readonly [TextHint, TraceHint];
}
/** Which language? — "Marker hunt": three neutral prompts, then the deciding lines, then the deciding feature. */
export interface MarkerHuntLayer {
  readonly roundId: string;
  readonly design: "marker-hunt";
  readonly scaffold: Readonly<{ prompts: readonly string[] }>;
  readonly hints: readonly [LinesHint, TextHint];
}
export type QuestionLayer = TraceItLayer | MarkerHuntLayer;

export interface QuestionLayers {
  readonly schemaVersion: typeof QUESTION_LAYER_SCHEMA_VERSION;
  /** The canonical hash of the artifact the layers were written for. */
  readonly artifactHash: string;
  /** The model that wrote them, an OpenRouter id. */
  readonly model: string;
  /** One layer per round that has one, in round-id order. */
  readonly layers: readonly QuestionLayer[];
}

/** A refused layer, with the check that refused it; the preparer logs the code and drops the layer. */
export class QuestionLayerRejected extends Error {
  public constructor(public readonly code: string) {
    super(`QUESTION_LAYER_REJECTED ${code}`);
    this.name = "QuestionLayerRejected";
  }
}
const reject = (code: string): never => { throw new QuestionLayerRejected(code); };

/** What the checks need beyond the decks: each algorithm's known spellings, from the artifact's snapshot. */
export interface LayerContext {
  readonly decks: readonly ParsedDeck[];
  readonly algorithms: readonly Readonly<{ label: string; names: readonly string[] }>[];
}

const record = (value: unknown, keys: readonly string[], code: string): Readonly<Record<string, unknown>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return reject(code);
  if (Object.keys(value).sort().join("|") !== [...keys].sort().join("|")) return reject(code);
  return value as Readonly<Record<string, unknown>>;
};
const list = (value: unknown, minimum: number, maximum: number, code: string): readonly unknown[] =>
  Array.isArray(value) && value.length >= minimum && value.length <= maximum ? value : reject(code);

/** Plain text on one line: no control characters, addresses, markup, or links. */
const PLAIN = /^[^\u0000-\u001f\u007f<>]+$/u;
const UNSAFE = /https?:|www\.|\]\(|@[A-Za-z0-9]/iu;
const text = (value: unknown, maximum: number): string =>
  typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= maximum && PLAIN.test(value) && !UNSAFE.test(value)
    ? value : reject("TEXT");

const LANGUAGE_EXTENSIONS = /\.(?:py|js|mjs|ts|tsx|rb|go|rs|java|kt|kts|c|h|cc|cpp|hpp|cs|php|swift|scala|m|mm|lua|pl|sh)\b/iu;

/** Every text a layer shows, scaffold and hints alike. */
const textsOf = (layer: QuestionLayer): readonly string[] => [
  ...(layer.design === "trace-it"
    ? layer.scaffold.watch.flatMap(({ name, role }) => [name, role])
    : layer.scaffold.prompts),
  ...layer.hints.flatMap((hint) => [hint.text, ...(hint.kind === "trace" ? [hint.input, ...hint.frames.flatMap(({ label, state }) => [label, state])] : [])]),
];

/** Language names a text may not use, case aside, as whole words: the longer labels and their common spellings. */
const LANGUAGE_WORDS = new RegExp(`(^|[^a-z0-9_])(?:${[...STACK_LANGUAGES.filter((language) => /^[A-Za-z]{4,}$/u.test(language)), "golang", "csharp", "cpp"]
  .map((word) => word.toLocaleLowerCase("en-US")).join("|")})([^a-z0-9_]|$)`, "iu");

const folded = (value: string): string => value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/gu, "");

/**
 * No text may name an option. For an algorithm round that is any option's label, known spelling, or label stem
 * (`heap` for Heapsort), case and separators aside; for a language round, any language of the deck as a whole word
 * (exact case for C, Go, C++, and C#; any case for the longer names) or a file extension.
 */
const requireNoOption = (layer: QuestionLayer, fixture: ParsedFixture, context: LayerContext): void => {
  const texts = textsOf(layer);
  if (layer.design === "trace-it") {
    for (const { label } of fixture.candidates) {
      const algorithm = context.algorithms.find((entry) => entry.label === label) ?? { label, names: [] };
      const stems = labelStems(label);
      if (texts.some((value) => namesAlgorithm(value, algorithm) || stems.some((stem) => folded(value).includes(stem)))) reject("NAMES_OPTION");
    }
    return;
  }
  if (texts.some((value) => STACK_LANGUAGES.some((language) => mentionsLabel(value, language)) || LANGUAGE_WORDS.test(value) || LANGUAGE_EXTENSIONS.test(value))) {
    reject("NAMES_LANGUAGE");
  }
};

const textHint = (value: unknown): TextHint => {
  const hint = record(value, ["kind", "text"], "HINT");
  return hint.kind === "text" ? Object.freeze({ kind: "text", text: text(hint.text, 200) }) : reject("HINT");
};

const linesHint = (value: unknown, paneLines: number): LinesHint => {
  const hint = record(value, ["kind", "text", "lines"], "HINT");
  if (hint.kind !== "lines") reject("HINT");
  const lines = list(hint.lines, 1, 2, "HINT").map((line) => Number.isSafeInteger(line) && (line as number) >= 1 && (line as number) <= paneLines ? line as number : reject("LINE_RANGE"));
  if (new Set(lines).size !== lines.length) reject("HINT");
  return Object.freeze({ kind: "lines", text: text(hint.text, 160), lines: Object.freeze(lines) });
};

const traceHint = (value: unknown): TraceHint => {
  const hint = record(value, ["kind", "text", "input", "frames"], "HINT");
  if (hint.kind !== "trace") reject("HINT");
  const frames = list(hint.frames, 2, 8, "HINT").map((frame) => {
    const entry = record(frame, ["label", "state"], "HINT");
    return Object.freeze({ label: text(entry.label, 60), state: text(entry.state, 120) });
  });
  return Object.freeze({ kind: "trace", text: text(hint.text, 160), input: text(hint.input, 80), frames: Object.freeze(frames) });
};

/** An identifier the code itself shows, so the scaffold points only at names the player can find. */
const showsIdentifier = (code: string, name: string): boolean =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name) && new RegExp(`(^|[^A-Za-z0-9_$])${name.replace(/\$/gu, "\\$")}([^A-Za-z0-9_$]|$)`, "u").test(code);

/** One layer, checked against its round: the deck's design, plain bounded text, lines in range, and no option named. */
export const parseQuestionLayer = (value: unknown, fixture: ParsedFixture, deck: DeckId, context: LayerContext): QuestionLayer => {
  const design = (QUESTION_DESIGNS as Readonly<Partial<Record<DeckId, QuestionDesign>>>)[deck] ?? reject("DECK");
  const raw = record(value, ["roundId", "design", "scaffold", "hints"], "SHAPE");
  if (raw.roundId !== fixture.roundId || raw.design !== design) reject("SHAPE");
  const code = fixture.panes.map(({ text: pane }) => pane).join("\n");
  const hints = list(raw.hints, 2, 2, "HINT");
  let layer: QuestionLayer;
  if (design === "trace-it") {
    const scaffold = record(raw.scaffold, ["watch"], "SCAFFOLD");
    const watch = list(scaffold.watch, 1, 3, "SCAFFOLD").map((entry) => {
      const item = record(entry, ["name", "role"], "SCAFFOLD");
      const name = text(item.name, 40);
      if (!showsIdentifier(code, name)) reject("WATCH_NAME");
      if (!(WATCH_KINDS as readonly unknown[]).includes(item.role)) reject("WATCH_KIND");
      return Object.freeze({ name, role: item.role as string });
    });
    layer = { roundId: fixture.roundId, design, scaffold: Object.freeze({ watch: Object.freeze(watch) }),
      hints: Object.freeze([textHint(hints[0]), traceHint(hints[1])]) as readonly [TextHint, TraceHint] };
  } else {
    const scaffold = record(raw.scaffold, ["prompts"], "SCAFFOLD");
    const prompts = list(scaffold.prompts, 3, 3, "SCAFFOLD").map((prompt) => (MARKER_PROMPTS as readonly unknown[]).includes(prompt) ? prompt as string : reject("PROMPT"));
    if (new Set(prompts).size !== prompts.length) reject("PROMPT");
    layer = { roundId: fixture.roundId, design, scaffold: Object.freeze({ prompts: Object.freeze(prompts) }),
      hints: Object.freeze([linesHint(hints[0], fixture.panes[0]!.text.split("\n").length), textHint(hints[1])]) as readonly [LinesHint, TextHint] };
  }
  requireNoOption(layer, fixture, context);
  return Object.freeze(layer);
};

/**
 * The layers file, when it was written for this artifact and every layer passes its round's checks; anything else
 * is refused whole. Layers come in round-id order, at most one a round, only for decks with a design.
 */
export const parseQuestionLayers = (value: unknown, artifactHash: string, context: LayerContext): QuestionLayers => {
  const file = record(value, ["schemaVersion", "artifactHash", "model", "layers"], "FILE");
  if (file.schemaVersion !== QUESTION_LAYER_SCHEMA_VERSION || file.artifactHash !== artifactHash
    || typeof file.model !== "string" || !/^[a-z0-9-]+\/[a-z0-9.:-]+$/u.test(file.model)) reject("FILE");
  const rounds = new Map(context.decks.flatMap((deck) => deck.fixtures.map((fixture) => [fixture.roundId, { fixture, deck: deck.id }] as const)));
  const layers = list(file.layers, 0, rounds.size, "FILE").map((entry) => {
    const roundId = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>).roundId : undefined;
    const round = typeof roundId === "string" ? rounds.get(roundId) : undefined;
    return round === undefined ? reject("ROUND") : parseQuestionLayer(entry, round.fixture, round.deck, context);
  });
  if (layers.some((layer, index) => index > 0 && layers[index - 1]!.roundId >= layer.roundId)) reject("ORDER");
  return Object.freeze({ schemaVersion: QUESTION_LAYER_SCHEMA_VERSION, artifactHash, model: file.model as string, layers: Object.freeze(layers) });
};
