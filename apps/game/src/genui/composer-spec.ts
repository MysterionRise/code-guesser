import { z } from "zod";

import { isSafeText } from "./render-catalog";

// Zod compiles faster checks with `new Function` when it can, and probes for that when it builds its first object
// schema; the game's CSP (#97) refuses eval, and the refused probe is still reported as a violation. The panel and
// the host import this module before the AI SDK, whose schemas are built as it loads, so no schema ever probes.
z.config({ jitless: true });

/**
 * The composer design (#114): after the lock, the model lays out the whole explainer panel itself, as a tree of
 * building blocks. The tree becomes a json-render spec, but only plain layout is allowed: every element carries a
 * type, its props, and its children, and nothing else. No state, actions, visibility rules, repeats, watchers, or
 * expressions. Every text passes the render catalog's safety check, and every code reference must fit the round.
 */

const MAX_ELEMENTS = 40;
const MAX_DEPTH = 6;
const MAX_EXCERPT_LINES = 25;

const Id = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/u).describe("A short element id: lowercase letters, digits, and hyphens.");
const text = (max: number, description: string) =>
  z.string().min(1).max(max).refine((value) => value.trim().length > 0 && isSafeText(value), "UNSAFE_TEXT")
    .describe(`${description} Plain text, at most ${max} characters.`);
const Children = z.array(Id).max(12).describe("Ids of the child elements, in order.");
// Models often leave a leaf's children out (the first live run); an absent list means none.
const NoChildren = z.array(Id).max(0).optional().describe("Empty or left out: this block has no children.");
const element = <Type extends string, Props extends z.ZodRawShape>(type: Type, description: string, props: Props, container: boolean) =>
  z.strictObject({
    id: Id,
    type: z.literal(type),
    props: z.strictObject(props),
    children: container ? Children : NoChildren,
  }).describe(description);

const Line = z.number().int().min(1).max(400);

const ELEMENT_SCHEMAS = [
  element("Stack", "A vertical stack of children.", { gap: z.enum(["small", "medium", "large"]) }, true),
  element("Row", "Children side by side, wrapping on narrow screens.", {}, true),
  element("Card", "A titled box grouping its children.", { title: text(80, "The card's title.") }, true),
  element("Details", "A collapsed section the player can open.", { summary: text(100, "What the section holds.") }, true),
  element("Heading", "A short heading.", { text: text(100, "The heading.") }, false),
  element("Text", "A paragraph.", { text: text(400, "The paragraph.") }, false),
  element("Callout", "A highlighted note.", {
    tone: z.enum(["tip", "note", "warning"]),
    title: text(80, "The callout's title."),
    text: text(300, "The callout's body."),
  }, false),
  element("CodeExcerpt", "Lines of the round's own code, with some highlighted. Numbers are the round's line numbers.", {
    pane: z.number().int().min(1).max(2).describe("1, or 2 for the second of two versions."),
    from: Line.describe("First line shown."),
    to: Line.describe(`Last line shown; at most ${MAX_EXCERPT_LINES} lines after from.`),
    highlights: z.array(z.strictObject({
      line: Line,
      kind: z.enum(["helpful", "misleading"]),
      note: text(120, "Why this line matters."),
    })).max(8),
  }, false),
  element("List", "A short list.", {
    ordered: z.boolean(),
    items: z.array(text(160, "One item.")).min(1).max(6),
  }, false),
  element("Table", "A small table; every row has one cell per column.", {
    caption: text(80, "What the table compares."),
    columns: z.array(text(40, "A column heading.")).min(2).max(4),
    rows: z.array(z.array(text(160, "A cell.")).min(2).max(4)).min(1).max(6),
  }, false),
  element("Badge", "A short label.", { text: text(30, "The label."), tone: z.enum(["good", "bad", "neutral"]) }, false),
  element("Divider", "A thin rule between sections.", {}, false),
  element("Quiz", "A one-question check of the takeaway; the player picks a choice and sees its feedback.", {
    question: text(200, "The question."),
    choices: z.array(z.strictObject({
      label: text(80, "The choice."),
      correct: z.boolean(),
      feedback: text(200, "What the player sees after picking it."),
    })).min(2).max(4),
  }, false),
] as const;

const ComposerElement = z.discriminatedUnion("type", ELEMENT_SCHEMAS);
export type ComposerElement = z.infer<typeof ComposerElement>;
export type ComposerBlock = ComposerElement["type"];

/** The `compose_panel` tool's input: the elements as a list, which models write more reliably than a map. */
export const ComposerInput = z.strictObject({
  root: Id.describe("The id of the outermost element."),
  elements: z.array(ComposerElement).min(1).max(MAX_ELEMENTS),
});

export const COMPOSER_TOOL_DESCRIPTION = "Lay out the whole explainer panel as a tree of building blocks. "
  + `Use 6 to ${MAX_ELEMENTS} elements and nest at most ${MAX_DEPTH} deep. Containers are Stack, Row, Card, and Details; `
  + "every other block has no children. Every id must be used exactly once, and every element must hang from the root.";

/** The tool's input schema, generated from the same zod schemas that check it. */
export const composerInputSchema = (): Record<string, unknown> => z.toJSONSchema(ComposerInput) as Record<string, unknown>;

/** A spec in json-render's flat format, reduced to plain layout. */
export interface ComposerSpec {
  readonly root: string;
  readonly elements: Readonly<Record<string, Readonly<{ type: ComposerBlock; props: Readonly<Record<string, unknown>>; children: readonly string[] }>>>;
}

export interface ComposerLimits {
  readonly paneLineCounts: readonly number[];
}

/**
 * A refused spec. The message, which the model sees on its one retry, names the failed check and the validator's
 * own wording; it never echoes the model's text back.
 */
export class ComposerRejected extends Error {
  public constructor(public readonly code: string, detail?: string) {
    super(`COMPOSER_SPEC_REJECTED ${code}${detail ? `: ${detail}` : ""}. Fix this and call compose_panel again.`);
    this.name = "ComposerRejected";
  }
}

const reject = (code: string, detail?: string): never => { throw new ComposerRejected(code, detail); };

const deepFreeze = <Value>(value: Value): Value => {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

/** Code checks the schema can't express: an excerpt must fit its pane, and its highlights must fall inside it. */
const checkElement = (item: ComposerElement, limits: ComposerLimits): void => {
  if (item.type === "CodeExcerpt") {
    const lines = limits.paneLineCounts[item.props.pane - 1] ?? reject("EXCERPT_PANE");
    const { from, to } = item.props;
    if (from > to || to > lines || to - from >= MAX_EXCERPT_LINES) reject("EXCERPT_RANGE");
    if (item.props.highlights.some(({ line }) => line < from || line > to)) reject("EXCERPT_HIGHLIGHT");
  }
  if (item.type === "Table" && item.props.rows.some((row) => row.length !== item.props.columns.length)) reject("TABLE_SHAPE");
  if (item.type === "Quiz" && item.props.choices.filter(({ correct }) => correct).length !== 1) reject("QUIZ_ANSWER");
};

/**
 * A composer panel as a frozen json-render spec, when it is a plain tree of known blocks that fits the round;
 * otherwise a refusal with a code. Run on the server before anything streams out, and again in the browser.
 */
export const parseComposerSpec = (value: unknown, limits: ComposerLimits): ComposerSpec => {
  const parsed = ComposerInput.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return reject(`SCHEMA ${(issue?.path ?? []).join(".") || "root"}`, issue?.message);
  }
  const root = parsed.data.root;
  const elements = parsed.data.elements.map((item) => ({ ...item, children: item.children ?? [] })) as (ComposerElement & { children: string[] })[];
  const byId = new Map<string, ComposerElement>();
  for (const item of elements) {
    if (byId.has(item.id)) reject("DUPLICATE_ID");
    byId.set(item.id, item);
    checkElement(item, limits);
  }
  if (!byId.has(root)) reject("ROOT_MISSING");
  // A tree: every element has one parent, except the root, which has none, and all hang from the root.
  const parents = new Map<string, string>();
  for (const item of elements) {
    for (const child of item.children ?? []) {
      if (!byId.has(child)) reject("CHILD_MISSING");
      if (child === root || parents.has(child)) reject("NOT_A_TREE");
      parents.set(child, item.id);
    }
  }
  const childrenOf = (id: string): readonly string[] => byId.get(id)!.children ?? [];
  const depthOf = (id: string, depth: number): number => {
    if (depth > MAX_DEPTH) reject("TOO_DEEP");
    return Math.max(depth, ...childrenOf(id).map((child) => depthOf(child, depth + 1)));
  };
  depthOf(root, 1);
  const reached = new Set<string>();
  const visit = (id: string): void => { reached.add(id); childrenOf(id).forEach(visit); };
  visit(root);
  if (reached.size !== byId.size) reject("ORPHAN");
  return deepFreeze({
    root,
    elements: Object.fromEntries(elements.map(({ id, type, props, children }) => [id, { type, props, children }])),
  }) as ComposerSpec;
};

/** Every block's name and what it is for, for the model's instructions and the renderer's catalog. */
export const COMPOSER_BLOCKS: Readonly<Record<ComposerBlock, string>> = Object.freeze(Object.fromEntries(
  ELEMENT_SCHEMAS.map((schema) => [schema.shape.type.value, schema.description ?? ""]),
)) as Record<ComposerBlock, string>;

/** Each block's props schema, keyed by name, for json-render's catalog. */
export const COMPOSER_PROPS = Object.freeze(Object.fromEntries(
  ELEMENT_SCHEMAS.map((schema) => [schema.shape.type.value, schema.shape.props]),
)) as unknown as Readonly<Record<ComposerBlock, z.ZodType>>;
