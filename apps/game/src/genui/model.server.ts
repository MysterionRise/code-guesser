import "server-only";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { jsonSchema, stepCountIs, streamText, tool, type ModelMessage, type StopCondition, type ToolSet } from "ai";

import { COMPOSER_TOOL_DESCRIPTION, ComposerRejected, composerInputSchema, parseComposerSpec } from "./composer-spec";
import type { Design } from "./designs";
import { VISUALIZER_TOOL_DESCRIPTION, VisualizerRejected, parseVisualizer } from "./visualizer-spec";
import { RENDER_CATALOG, RenderCallRejected, componentsFor, inputSchemaFor, parseRenderCall, type RenderLimits } from "./render-catalog";
import { modelInput, type RoundContext } from "./round-context.server";

/**
 * The one module that calls a model (#101). Every request is built from the answer-lock guard's context
 * (`round-context.server.ts`), never from anything the browser sends except the player's own short chat turns,
 * and the only tools are the render catalog's components, whose props are checked here before they stream out.
 */

export const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";
export const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
/** Room for a few render calls or one composed panel; reasoning is off, so none of it goes to thinking. */
const MAX_OUTPUT_TOKENS = 2_500;
const TIMEOUT_MS = 20_000;
/** A composed panel is one long call, and may take a repair round; a visualizer page is longer still. */
const LONG_TIMEOUT_MS: Readonly<Partial<Record<Design, number>>> = Object.freeze({ composer: 45_000, visualizer: 90_000 });
const LONG_OUTPUT_TOKENS: Readonly<Partial<Record<Design, number>>> = Object.freeze({ visualizer: 9_000 });

/**
 * One step, except that a composed panel the checks refused gets one repair round: the model sees which check
 * failed and calls again. The run stops as soon as a panel passes.
 */
const stopFor = (design: Design): StopCondition<ToolSet> | StopCondition<ToolSet>[] => design !== "composer" && design !== "visualizer" ? stepCountIs(1)
  : [stepCountIs(2), ({ steps }) => steps.at(-1)?.content.some((part) => part.type === "tool-result") ?? false];
/** Turns of chat the model sees, and how long one may be. */
export const MAX_TURNS = 8;
export const MAX_TURN_LENGTH = 500;
/** A code line this long, found in a player's turn before the lock, means the code was pasted in. */
const PASTE_LINE_LENGTH = 12;

export type GenuiRefusal = "GENUI_UNAVAILABLE" | "MESSAGES_REJECTED" | "PASTED_CODE";

export interface PlayerTurn {
  readonly role: "user" | "assistant";
  readonly text: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The text of a chat's turns, when it is a short list of user and assistant messages; tool parts and anything
 * else the browser sends are dropped, since only the server's own context and tools reach the model. The last
 * turn must be the player's.
 */
export const playerTurns = (messages: unknown): readonly PlayerTurn[] | null => {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_TURNS * 2) return null;
  const turns: PlayerTurn[] = [];
  for (const message of messages) {
    if (!isRecord(message) || (message.role !== "user" && message.role !== "assistant") || !Array.isArray(message.parts)) return null;
    // The host's earlier replies are its own host_message calls; they go back as its turns, so a chat stays coherent.
    const text = message.parts.flatMap((part): string[] => {
      if (!isRecord(part)) return [];
      if (part.type === "text" && typeof part.text === "string") return [part.text];
      if (message.role === "assistant" && part.type === "tool-host_message" && part.state === "output-available"
        && isRecord(part.output) && typeof part.output.text === "string") return [part.output.text];
      return [];
    }).join("\n").trim();
    if (message.role === "user" && (text.length === 0 || text.length > MAX_TURN_LENGTH)) return null;
    if (text.length > 0) turns.push(Object.freeze({ role: message.role, text: text.slice(0, MAX_TURN_LENGTH * 2) }));
  }
  if (turns.at(-1)?.role !== "user") return null;
  return Object.freeze(turns.slice(-MAX_TURNS));
};

const collapse = (text: string): string => text.replace(/\s+/gu, " ").trim();

/**
 * A turn as the paste check reads it: itself, plus any base64 run in it decoded. The red-team playtest got code
 * past the plain-text check by encoding it.
 */
const readable = (text: string): string => {
  const decoded = (text.match(/[A-Za-z0-9+/]{16,}={0,2}/gu) ?? []).map((run) => {
    try {
      return Buffer.from(run, "base64").toString("utf8");
    } catch {
      return "";
    }
  });
  return [text, ...decoded].join("\n");
};

/** Whether a player's turns quote a line of the round's code, as typed or base64-encoded. */
export const mentionsCode = (turns: readonly PlayerTurn[], codeLines: readonly string[]): boolean => {
  const said = turns.filter(({ role }) => role === "user").map(({ text }) => collapse(readable(text))).join("\n");
  return codeLines.map(collapse).some((line) => line.length >= PASTE_LINE_LENGTH && said.includes(line));
};

/** The render catalog's components for this phase as tools whose output is the checked props. */
const renderTools = (context: RoundContext, limits: RenderLimits): ToolSet => Object.fromEntries(
  componentsFor(context.phase).map((name) => [name, tool({
    description: RENDER_CATALOG[name].description,
    inputSchema: jsonSchema<Record<string, unknown>>(inputSchemaFor(name) as never),
    execute: async (input: Record<string, unknown>) => {
      try {
        return parseRenderCall({ component: name, props: input }, context.phase, limits).props;
      } catch (error) {
        // The code names the component and the failed check, never the text.
        if (error instanceof RenderCallRejected) console.error(`GENUI_RENDER_REJECTED ${name} ${error.code}`);
        throw error;
      }
    },
  })]),
);

/**
 * A design that renders one thing (a composed panel, a visualizer page) keeps only the first that passes; a model
 * that writes several in parallel (seen live) has the rest refused rather than shown in turn.
 */
const firstOnly = (name: string) => {
  let accepted = false;
  return <Value>(value: Value): Value => {
    if (accepted) {
      console.error(`GENUI_RENDER_REJECTED ${name} ONE_ONLY`);
      throw new Error(`${name} was already called for this round. Do not call it again.`);
    }
    accepted = true;
    return value;
  };
};

/** Designs whose single tool may be called once per request. */
const SINGLE_CALL: ReadonlySet<Design> = new Set(["composer", "visualizer"]);

/** The composer lays out the whole panel in one call (#114). */
const composerTools = (limits: RenderLimits): ToolSet => { const once = firstOnly("compose_panel"); return {
  compose_panel: tool({
    description: COMPOSER_TOOL_DESCRIPTION,
    inputSchema: jsonSchema<Record<string, unknown>>(composerInputSchema() as never),
    execute: async (input: Record<string, unknown>) => {
      try {
        return once(parseComposerSpec(input, limits));
      } catch (error) {
        if (error instanceof ComposerRejected) console.error(`GENUI_RENDER_REJECTED compose_panel ${error.code}`);
        throw error;
      }
    },
  }),
}; };

/** The visualizer writes one sandboxed page (#115). */
const visualizerTools = (): ToolSet => { const once = firstOnly("render_visualizer"); return {
  render_visualizer: tool({
    description: VISUALIZER_TOOL_DESCRIPTION,
    inputSchema: jsonSchema<Record<string, unknown>>({
      type: "object",
      properties: {
        title: { type: "string", minLength: 1, maxLength: 80, description: "What the visualization shows. At most 80 characters." },
        summary: { type: "string", minLength: 1, maxLength: 600, description: "What it shows, in words, for players who can't see it. At most 600 characters." },
        html: { type: "string", minLength: 1, description: "The page's body markup, with inline <style> and <script>." },
      },
      required: ["title", "summary", "html"],
      additionalProperties: false,
    } as never),
    execute: async (input: Record<string, unknown>) => {
      try {
        return once(parseVisualizer(input));
      } catch (error) {
        if (error instanceof VisualizerRejected) console.error(`GENUI_RENDER_REJECTED render_visualizer ${error.code}`);
        throw error;
      }
    },
  }),
}; };

/** What each design asks of the model, on top of the guard's own rules. */
const DESIGN_RULES: Readonly<Partial<Record<Design, string>>> = Object.freeze({
  composer: [
    "Design one explainer panel for this round with a single compose_panel call, and nothing else.",
    "Lead with a short verdict: a Callout or a Heading and Text.",
    "Show the decisive lines with one or two CodeExcerpts, highlighting them with notes.",
    "Set the options side by side in a Table or Cards when that helps.",
    "Finish with a Quiz that checks the takeaway, with exactly one right choice.",
    "Aim for 8 to 20 elements and vary the layout to suit the round. A Callout's title is a short label; its text is a full sentence.",
  ].join(" "),
  host: [
    "You are chatting with the player during the round, as the game's host.",
    "Always reply with one or two short host_message calls, never plain text; be warm, brief, and a little playful.",
    "Before the lock, when the player asks for help, tips, or the answer, also call offer_hint once in that reply (only while a hint is left), so they can buy the next hint with one press.",
    "After the lock, answer questions about the code and the answer in a few short host_message lines, quoting at most one line of code, and use takeaway or signal_list when they help.",
  ].join(" "),
  visualizer: [
    "Build one interactive visualization of this round with a single render_visualizer call, and nothing else.",
    "Show the code at work on a small concrete input taken from the round: step through the algorithm, trace the call, or show what the fix changes.",
    "Keep it under 250 lines. Use a dark background and light text, readable at 14px, and label every control with text. Show each value in its own box or cell, never run together. The frame is about 700px wide: stack two versions rather than squeezing them side by side, and keep the controls at the top.",
  ].join(" "),
});

/** The tools a design may call in this phase. */
/** What the host may render in its chat: its own lines, a hint offer before the lock, and short takeaways after it. */
const HOST_COMPONENTS: ReadonlySet<string> = new Set(["host_message", "offer_hint", "takeaway", "signal_list"]);

const toolsFor = (design: Design, context: RoundContext, limits: RenderLimits): ToolSet => {
  if (design === "composer") return composerTools(limits);
  if (design === "visualizer") return visualizerTools();
  const tools = renderTools(context, limits);
  return design === "host" ? Object.fromEntries(Object.entries(tools).filter(([name]) => HOST_COMPONENTS.has(name))) : tools;
};

/** How one model call ended, in counts only, for the event log (#107). */
export interface CallOutcome {
  readonly ok: boolean;
  /** The provider's HTTP status when the call failed with one; 0 otherwise. */
  readonly status: number;
  readonly calls: number;
  readonly tokensIn: number;
  readonly tokensOut: number;
  readonly ms: number;
}

export interface RoundRequest {
  readonly design: Design;
  readonly context: RoundContext;
  readonly limits: RenderLimits;
  readonly codeLines: readonly string[];
  readonly turns: readonly PlayerTurn[];
  readonly signal?: AbortSignal;
  /** Told once how the call ended. */
  readonly onOutcome?: (outcome: CallOutcome) => void;
}

/**
 * Streams one model step for a round, as the AI SDK's UI message stream; or a refusal code when generative UI
 * is not configured or the player pasted the round's code before the lock. Provider errors never reach the
 * browser or the log beyond a code.
 */
export const streamRound = ({ design, context, limits, codeLines, turns, signal, onOutcome }: RoundRequest): Response | GenuiRefusal => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) return "GENUI_UNAVAILABLE";
  if (context.phase === "before-lock" && mentionsCode(turns, codeLines)) return "PASTED_CODE";
  const provider = createOpenAICompatible({
    name: "openrouter",
    baseURL: process.env.OPENROUTER_BASE_URL ?? DEFAULT_BASE_URL,
    apiKey,
    includeUsage: true,
    transformRequestBody: (body) => ({
      ...body,
      // Route only to providers that neither store nor train on prompts.
      provider: { data_collection: "deny" },
      // Rendering a few short components needs no thinking. With it on (Claude Haiku 5.5 thinks by default), the
      // first live check spent the whole output budget on reasoning and returned nothing.
      reasoning: { enabled: false },
      ...(SINGLE_CALL.has(design) ? { parallel_tool_calls: false } : {}),
    }),
  });
  const { system: rules, data } = modelInput(context);
  const system = DESIGN_RULES[design] === undefined ? rules : `${rules}\n${DESIGN_RULES[design]}`;
  const messages: ModelMessage[] = [
    { role: "user", content: data },
    ...turns.map(({ role, text }): ModelMessage => ({ role, content: text })),
  ];
  const started = Date.now();
  const tokens = (value: number | undefined): number => Number.isSafeInteger(value) && value! >= 0 ? value! : 0;
  const result = streamText({
    model: provider.chatModel(process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL),
    system,
    messages,
    tools: toolsFor(design, context, limits),
    stopWhen: stopFor(design),
    maxOutputTokens: LONG_OUTPUT_TOKENS[design] ?? MAX_OUTPUT_TOKENS,
    maxRetries: 1,
    timeout: LONG_TIMEOUT_MS[design] ?? TIMEOUT_MS,
    ...(signal === undefined ? {} : { abortSignal: signal }),
    onError: ({ error }) => {
      const status = isRecord(error) && typeof error.statusCode === "number" ? error.statusCode : "NETWORK";
      console.error(`GENUI_STREAM_FAILED ${status}`);
      onOutcome?.({ ok: false, status: typeof status === "number" && status >= 0 && status <= 599 ? status : 0, calls: 0, tokensIn: 0, tokensOut: 0, ms: Date.now() - started });
    },
    // Counts and codes only: how the step ended, how many render calls it made, and the tokens it used.
    onFinish: ({ finishReason, toolCalls, totalUsage }) => {
      console.info(`GENUI_FINISHED ${design} ${context.phase} ${finishReason} calls=${toolCalls.length} in=${totalUsage.inputTokens ?? "?"} out=${totalUsage.outputTokens ?? "?"}`);
      onOutcome?.({ ok: true, status: 0, calls: Math.min(toolCalls.length, 20), tokensIn: tokens(totalUsage.inputTokens),
        tokensOut: tokens(totalUsage.outputTokens), ms: Date.now() - started });
    },
  });
  return result.toUIMessageStreamResponse({ onError: () => "GENUI_FAILED", headers: { "cache-control": "no-store" } });
};
