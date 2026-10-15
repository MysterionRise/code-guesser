/**
 * The only things a model may put on screen: a closed set of components whose props are plain text, small
 * integers, and fixed choices. A render call is checked against this catalog before anything renders, React
 * escapes every string, and nothing here can carry HTML, a link, or markup.
 */

/** Where a round stands: before the answer is locked the model sees no code, so it may only talk. */
export type RoundPhase = "before-lock" | "after-lock";

export type Field =
  | Readonly<{ kind: "text"; max: number; description: string }>
  | Readonly<{ kind: "integer"; min: number; max: number; description: string }>
  | Readonly<{ kind: "choice"; values: readonly string[]; description: string }>
  | Readonly<{ kind: "list"; of: Field; max: number; description: string }>
  | Readonly<{ kind: "object"; fields: Readonly<Record<string, Field>>; description: string }>;

export interface CatalogComponent {
  readonly description: string;
  readonly phases: readonly RoundPhase[];
  readonly props: Readonly<Record<string, Field>>;
}

/** A text prop; its description states the hard limit, since a model reads descriptions more reliably than schema bounds. */
const text = (max: number, description: string): Field => ({ kind: "text", max, description: `${description} At most ${max} characters.` });

export const RENDER_CATALOG = Object.freeze({
  host_message: {
    description: "A short line from the game host, shown in the host's speech bubble.",
    phases: ["before-lock", "after-lock"],
    props: { text: text(280, "What the host says, in plain text.") },
  },
  takeaway: {
    description: "One sentence the player can carry to the next round.",
    phases: ["after-lock"],
    props: { text: text(200, "The takeaway, in plain text.") },
  },
  signal_list: {
    description: "What in the code pointed to the answer, and what pointed away from it.",
    phases: ["after-lock"],
    props: {
      helpful: { kind: "list", of: text(160, "A signal that points to the answer."), max: 4, description: "Signals that point to the answer." },
      misleading: { kind: "list", of: text(160, "A signal that points away."), max: 4, description: "Signals that point away from it." },
    },
  },
  code_view: {
    description: "The round's code again, with lines highlighted and briefly annotated.",
    phases: ["after-lock"],
    props: {
      pane: { kind: "integer", min: 1, max: 2, description: "Which pane of code: 1, or 2 for the second of two versions." },
      highlights: {
        kind: "list", max: 6, description: "Lines to highlight.",
        of: {
          kind: "object", description: "One highlighted line.",
          fields: {
            line: { kind: "integer", min: 1, max: 200, description: "The line number in that pane, counting from 1." },
            kind: { kind: "choice", values: ["helpful", "misleading"], description: "Whether the line points to the answer or away from it." },
            note: text(120, "Why this line matters, in plain text."),
          },
        },
      },
    },
  },
  comparison: {
    description: "The options side by side: what spoke for and against each.",
    phases: ["after-lock"],
    props: {
      rows: {
        kind: "list", max: 4, description: "One row per option.",
        of: {
          kind: "object", description: "One option.",
          fields: {
            option: text(80, "The option's label, exactly as the round shows it."),
            for: text(160, "What spoke for this option."),
            against: text(160, "What spoke against it."),
          },
        },
      },
    },
  },
} as const satisfies Record<string, CatalogComponent>);

export type ComponentName = keyof typeof RENDER_CATALOG;

export interface RenderCall {
  readonly component: ComponentName;
  readonly props: Readonly<Record<string, unknown>>;
}

/** What a render call may refer to: the round's own panes and options, so it cannot point past them. */
export interface RenderLimits {
  readonly paneLineCounts: readonly number[];
  readonly optionLabels: readonly string[];
}

export class RenderCallRejected extends Error {
  public constructor(public readonly code: string) {
    super(`RENDER_CALL_REJECTED ${code}`);
    this.name = "RenderCallRejected";
  }
}

const reject = (code: string): never => { throw new RenderCallRejected(code); };

// Control characters, bidirectional overrides, links, and active markup are refused outright. React would render
// markup as inert text anyway; refusing it keeps a model that was talked into writing it from showing anything.
// Generic types such as `Vec<i64>` stay legal.
const UNSAFE_TEXT = /[\u0000-\u001f\u007f‪-‮⁦-⁩]|https?:\/\/|www\.|javascript:|<\/?(?:script|style|iframe|img|svg|a|object|embed|link|meta|form|input)\b/iu;

/** Whether a model-written text may be shown: no control characters, bidi overrides, links, or active markup. */
export const isSafeText = (value: string): boolean => !UNSAFE_TEXT.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseField = (field: Field, value: unknown, path: string): unknown => {
  switch (field.kind) {
    case "text":
      if (typeof value !== "string") return reject(`${path}_NOT_TEXT`);
      if (value.trim().length === 0 || value.length > field.max) return reject(`${path}_LENGTH`);
      if (UNSAFE_TEXT.test(value)) return reject(`${path}_UNSAFE`);
      return value.trim();
    case "integer":
      if (!Number.isSafeInteger(value) || (value as number) < field.min || (value as number) > field.max) return reject(`${path}_RANGE`);
      return value;
    case "choice":
      if (typeof value !== "string" || !field.values.includes(value)) return reject(`${path}_CHOICE`);
      return value;
    case "list":
      if (!Array.isArray(value) || value.length === 0 || value.length > field.max) return reject(`${path}_COUNT`);
      return Object.freeze(value.map((item, index) => parseField(field.of, item, `${path}_${index}`)));
    case "object":
      return parseProps(field.fields, value, path);
  }
};

const parseProps = (fields: Readonly<Record<string, Field>>, value: unknown, path: string): Readonly<Record<string, unknown>> => {
  if (!isRecord(value)) return reject(`${path}_NOT_OBJECT`);
  const keys = Object.keys(fields);
  if (Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) return reject(`${path}_KEYS`);
  return Object.freeze(Object.fromEntries(keys.map((key) => [key, parseField(fields[key]!, value[key], `${path}_${key.toUpperCase()}`)])));
};

/**
 * A render call when it names a catalog component allowed in this phase and every prop fits; otherwise it is
 * refused with a code, and the caller shows the static UI instead.
 */
export const parseRenderCall = (value: unknown, phase: RoundPhase, limits: RenderLimits): RenderCall => {
  if (!isRecord(value) || Object.keys(value).sort().join("|") !== "component|props") reject("SHAPE");
  const { component, props } = value as { component: unknown; props: unknown };
  if (typeof component !== "string" || !Object.hasOwn(RENDER_CATALOG, component)) return reject("UNKNOWN_COMPONENT");
  const entry: CatalogComponent = RENDER_CATALOG[component as ComponentName];
  if (!entry.phases.includes(phase)) return reject("PHASE");
  const parsed = parseProps(entry.props, props, "PROPS");
  if (component === "code_view") {
    const lines = limits.paneLineCounts[(parsed.pane as number) - 1] ?? reject("PANE");
    for (const highlight of parsed.highlights as readonly Readonly<Record<string, unknown>>[]) {
      if ((highlight.line as number) > lines) reject("LINE");
    }
  }
  if (component === "comparison") {
    for (const row of parsed.rows as readonly Readonly<Record<string, unknown>>[]) {
      if (!limits.optionLabels.includes(row.option as string)) reject("OPTION");
    }
  }
  return Object.freeze({ component: component as ComponentName, props: parsed });
};

type JsonSchema = Readonly<Record<string, unknown>>;

const schemaOf = (field: Field): JsonSchema => {
  switch (field.kind) {
    case "text":
      return { type: "string", minLength: 1, maxLength: field.max, description: field.description };
    case "integer":
      return { type: "integer", minimum: field.min, maximum: field.max, description: field.description };
    case "choice":
      return { type: "string", enum: [...field.values], description: field.description };
    case "list":
      return { type: "array", items: schemaOf(field.of), minItems: 1, maxItems: field.max, description: field.description };
    case "object":
      return objectSchema(field.fields, field.description);
  }
};

const objectSchema = (fields: Readonly<Record<string, Field>>, description?: string): JsonSchema => ({
  type: "object",
  properties: Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, schemaOf(field)])),
  required: Object.keys(fields),
  additionalProperties: false,
  ...(description === undefined ? {} : { description }),
});

/** A component's props as JSON Schema, the form a model's tool definition takes; `parseRenderCall` still decides. */
export const inputSchemaFor = (name: ComponentName): JsonSchema => objectSchema(RENDER_CATALOG[name].props);

/** The components a model may call in this phase, by name. */
export const componentsFor = (phase: RoundPhase): readonly ComponentName[] =>
  Object.freeze((Object.keys(RENDER_CATALOG) as ComponentName[]).filter((name) => (RENDER_CATALOG[name].phases as readonly RoundPhase[]).includes(phase)));
