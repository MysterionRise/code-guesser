import "server-only";

/**
 * Which service answers generative UI (#101): OpenRouter's OpenAI-compatible endpoint, or Anthropic's own Messages
 * API with an Anthropic key. `GENUI_PROVIDER` names one; unset, the server takes `anthropic` when only an Anthropic
 * key is present and `openrouter` otherwise, so a server set up for either works with its key alone. Each provider
 * reads its own settings, `<PREFIX>_API_KEY`, `_MODEL`, `_REASONING`, `_BASE_URL`, and the per-design `_MODEL_<DESIGN>`
 * and `_REASONING_<DESIGN>`, since the two name models differently (`anthropic/claude-haiku-5.5` against
 * `claude-haiku-5-5`). `environment.server.ts` holds a public server to these, and `model.server.ts` calls them.
 */
export const PROVIDERS = Object.freeze(["openrouter", "anthropic"] as const);
export type Provider = (typeof PROVIDERS)[number];
export const isProvider = (value: string): value is Provider => (PROVIDERS as readonly string[]).includes(value);
/** The environment prefix each provider's settings carry. */
export const PREFIX: Readonly<Record<Provider, string>> = Object.freeze({ openrouter: "OPENROUTER", anthropic: "ANTHROPIC" });
/** The one address each provider's real games may use; a stand-in address is for tests and smoke runs. */
export const DEFAULT_BASE_URLS: Readonly<Record<Provider, string>> = Object.freeze({
  openrouter: "https://openrouter.ai/api/v1",
  anthropic: "https://api.anthropic.com/v1",
});
/** Claude Haiku 5.5, under each provider's name for it. */
export const DEFAULT_MODELS: Readonly<Record<Provider, string>> = Object.freeze({
  openrouter: "anthropic/claude-haiku-5.5",
  anthropic: "claude-haiku-5-5",
});

type Environment = Readonly<Record<string, string | undefined>>;

/** A setting's value, an empty string reading as unset. */
export const setting = (name: string, env: Environment): string | undefined => {
  const value = env[name];
  return value === undefined || value.length === 0 ? undefined : value;
};

/** The provider this environment names, or implies by its keys; null for a `GENUI_PROVIDER` that names neither. */
export const providerFor = (env: Environment = process.env): Provider | null => {
  const named = setting("GENUI_PROVIDER", env);
  if (named !== undefined) return isProvider(named) ? named : null;
  return setting("ANTHROPIC_API_KEY", env) !== undefined && setting("OPENROUTER_API_KEY", env) === undefined ? "anthropic" : "openrouter";
};

/** The provider's key, or undefined when unset or empty. */
export const apiKeyFor = (provider: Provider, env: Environment = process.env): string | undefined => setting(`${PREFIX[provider]}_API_KEY`, env);
