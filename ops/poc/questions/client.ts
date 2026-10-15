import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { serializeCanonical } from "../../../packages/artifact/src/index";

/**
 * The question layers' one model client (#127): OpenRouter's chat completions, one forced tool call a request, and a
 * journal of every answer so a rebuild replays them. The journal holds provider output (model-written text, which
 * is public game content, and token counts), never a key or a request header, and it is gitignored.
 */
export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}
export interface ModelRequest {
  readonly system: string;
  readonly user: string;
  readonly tool: ToolSpec;
  readonly maxTokens: number;
}
export interface ModelAnswer {
  /** The tool call's arguments, parsed from JSON; the caller checks their shape. */
  readonly value: unknown;
  readonly tokensIn: number;
  readonly tokensOut: number;
}
export interface ModelClient {
  readonly model: string;
  call(request: ModelRequest): Promise<ModelAnswer>;
  /** Answers replayed from the journal and fetched live so far. */
  readonly counts: () => Readonly<{ replayed: number; live: number; tokensIn: number; tokensOut: number }>;
}

/** `resume` replays what the journal holds and fetches the rest; `offline` never fetches; `fresh` ignores the journal. */
export type JournalMode = "resume" | "offline" | "fresh";

export class QuestionsError extends Error {
  public constructor(public readonly code: string) {
    super(code);
    this.name = "QuestionsError";
  }
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_WAIT_MS = 4_000;

export interface ClientOptions {
  readonly model: string;
  readonly apiKey: string | undefined;
  readonly baseUrl: string;
  readonly journalPath: string;
  readonly mode: JournalMode;
  readonly fetch?: typeof fetch;
  readonly wait?: (milliseconds: number) => Promise<void>;
}

/** The request body; the journal key is its canonical hash, so a changed prompt, schema, or model fetches anew. */
const bodyFor = (model: string, request: ModelRequest) => ({
  model,
  messages: [{ role: "system", content: request.system }, { role: "user", content: request.user }],
  tools: [{ type: "function", function: request.tool }],
  tool_choice: { type: "function", function: { name: request.tool.name } },
  temperature: 0,
  max_tokens: request.maxTokens,
  // Only providers that neither store nor train on prompts; no thinking, which would spend the output budget.
  provider: { data_collection: "deny" },
  reasoning: { enabled: false },
});

const parseAnswer = (payload: unknown, tool: string): ModelAnswer => {
  const choice = (payload as { choices?: { message?: { tool_calls?: { function?: { name?: unknown; arguments?: unknown } }[] } }[] })?.choices?.[0];
  const call = choice?.message?.tool_calls?.[0]?.function;
  if (call?.name !== tool || typeof call.arguments !== "string") throw new QuestionsError("QUESTIONS_MALFORMED");
  let value: unknown;
  try {
    value = JSON.parse(call.arguments);
  } catch {
    throw new QuestionsError("QUESTIONS_MALFORMED");
  }
  const usage = (payload as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }).usage;
  const count = (raw: unknown): number => Number.isSafeInteger(raw) && (raw as number) >= 0 ? raw as number : 0;
  return Object.freeze({ value, tokensIn: count(usage?.prompt_tokens), tokensOut: count(usage?.completion_tokens) });
};

export const openRouterClient = (options: ClientOptions): ModelClient => {
  const send = options.fetch ?? fetch;
  const wait = options.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const journal = new Map<string, ModelAnswer>();
  if (options.mode !== "fresh" && existsSync(options.journalPath)) {
    for (const line of readFileSync(options.journalPath, "utf8").split("\n").filter(Boolean)) {
      const entry = JSON.parse(line) as { key: string; answer: ModelAnswer };
      journal.set(entry.key, entry.answer);
    }
  }
  const counts = { replayed: 0, live: 0, tokensIn: 0, tokensOut: 0 };
  return Object.freeze({
    model: options.model,
    counts: () => Object.freeze({ ...counts }),
    call: async (request: ModelRequest): Promise<ModelAnswer> => {
      const body = bodyFor(options.model, request);
      const key = createHash("sha256").update(serializeCanonical(body)).digest("hex");
      const known = journal.get(key);
      if (known !== undefined) { counts.replayed += 1; return known; }
      if (options.mode === "offline") throw new QuestionsError("JOURNAL_MISS");
      if (options.apiKey === undefined || options.apiKey.length === 0) throw new QuestionsError("OPENROUTER_KEY_MISSING");
      for (let attempt = 0; ; attempt += 1) {
        let response: Response;
        try {
          response = await send(`${options.baseUrl}/chat/completions`, {
            method: "POST",
            headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
            body: JSON.stringify(body),
          });
        } catch {
          if (attempt === 0) { await wait(RETRY_WAIT_MS); continue; }
          throw new QuestionsError("QUESTIONS_NETWORK");
        }
        if (RETRY_STATUSES.has(response.status) && attempt === 0) { await wait(RETRY_WAIT_MS); continue; }
        // A spent key answers 402; only the status reaches the log, never the provider's body.
        if (!response.ok) throw new QuestionsError(`QUESTIONS_PROVIDER_${response.status}`);
        const answer = parseAnswer(await response.json(), request.tool.name);
        counts.live += 1;
        counts.tokensIn += answer.tokensIn;
        counts.tokensOut += answer.tokensOut;
        journal.set(key, answer);
        mkdirSync(dirname(options.journalPath), { recursive: true });
        appendFileSync(options.journalPath, `${JSON.stringify({ key, answer })}\n`, { mode: 0o600 });
        return answer;
      }
    },
  });
};
