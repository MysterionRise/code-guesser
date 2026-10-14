import "server-only";

import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { jsonSchema, stepCountIs, streamText, tool, type ModelMessage, type ToolSet } from "ai";

import { RENDER_CATALOG, RenderCallRejected, componentsFor, inputSchemaFor, parseRenderCall, type RenderLimits } from "./render-catalog";
import { modelInput, type RoundContext } from "./round-context.server";

/**
 * The one module that calls a model (#101). Every request is built from the answer-lock guard's context
 * (`round-context.server.ts`), never from anything the browser sends except the player's own short chat turns,
 * and the only tools are the render catalog's components, whose props are checked here before they stream out.
 */

export const DEFAULT_MODEL = "anthropic/claude-haiku-5.5";
export const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
/** Room for two or three render calls; reasoning is off, so none of it goes to thinking. */
const MAX_OUTPUT_TOKENS = 1_200;
const TIMEOUT_MS = 20_000;
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
    const text = message.parts
      .filter((part): part is { type: "text"; text: string } => isRecord(part) && part.type === "text" && typeof part.text === "string")
      .map(({ text: partText }) => partText).join("\n").trim();
    if (message.role === "user" && (text.length === 0 || text.length > MAX_TURN_LENGTH)) return null;
    if (text.length > 0) turns.push(Object.freeze({ role: message.role, text: text.slice(0, MAX_TURN_LENGTH * 2) }));
  }
  if (turns.at(-1)?.role !== "user") return null;
  return Object.freeze(turns.slice(-MAX_TURNS));
};

const collapse = (text: string): string => text.replace(/\s+/gu, " ").trim();

/** Whether a player's turns quote a line of the round's code. */
export const mentionsCode = (turns: readonly PlayerTurn[], codeLines: readonly string[]): boolean => {
  const said = turns.filter(({ role }) => role === "user").map(({ text }) => collapse(text)).join("\n");
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

export interface RoundRequest {
  readonly context: RoundContext;
  readonly limits: RenderLimits;
  readonly codeLines: readonly string[];
  readonly turns: readonly PlayerTurn[];
  readonly signal?: AbortSignal;
}

/**
 * Streams one model step for a round, as the AI SDK's UI message stream; or a refusal code when generative UI
 * is not configured or the player pasted the round's code before the lock. Provider errors never reach the
 * browser or the log beyond a code.
 */
export const streamRound = ({ context, limits, codeLines, turns, signal }: RoundRequest): Response | GenuiRefusal => {
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
    }),
  });
  const { system, data } = modelInput(context);
  const messages: ModelMessage[] = [
    { role: "user", content: data },
    ...turns.map(({ role, text }): ModelMessage => ({ role, content: text })),
  ];
  const result = streamText({
    model: provider.chatModel(process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL),
    system,
    messages,
    tools: renderTools(context, limits),
    stopWhen: stepCountIs(1),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    maxRetries: 1,
    timeout: TIMEOUT_MS,
    ...(signal === undefined ? {} : { abortSignal: signal }),
    onError: ({ error }) => {
      const status = isRecord(error) && typeof error.statusCode === "number" ? error.statusCode : "NETWORK";
      console.error(`GENUI_STREAM_FAILED ${status}`);
    },
    // Counts and codes only: how the step ended, how many render calls it made, and the tokens it used.
    onFinish: ({ finishReason, toolCalls, totalUsage }) => {
      console.info(`GENUI_FINISHED ${context.phase} ${finishReason} calls=${toolCalls.length} in=${totalUsage.inputTokens ?? "?"} out=${totalUsage.outputTokens ?? "?"}`);
    },
  });
  return result.toUIMessageStreamResponse({ onError: () => "GENUI_FAILED", headers: { "cache-control": "no-store" } });
};
