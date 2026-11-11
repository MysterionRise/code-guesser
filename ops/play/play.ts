/**
 * What `pnpm play` decides before it starts the game's development server: which provider answers generative UI,
 * where its key comes from, and the environment the server gets.
 *
 * Local play prefers Anthropic's own API and keeps OpenRouter's OpenAI-compatible endpoint beside it. The server's
 * own rule for an unnamed provider (`apps/game/src/genui/provider.server.ts`) is unchanged: `pnpm play` always
 * names the provider it chose, in `GENUI_PROVIDER`.
 *
 * A key comes from the environment, or else from its standard store, a file of mode 0600 that only this module
 * reads. It goes to the server through its environment and is never printed, logged, or put on a command line.
 */
import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** The providers in the order local play tries them. */
export const PLAY_PROVIDERS = Object.freeze(["anthropic", "openrouter"] as const);
export type PlayProvider = (typeof PLAY_PROVIDERS)[number];
const isPlayProvider = (value: string): value is PlayProvider => (PLAY_PROVIDERS as readonly string[]).includes(value);

/** Each provider's key: the variable the server reads, and its standard store under the home directory. */
export const KEY_SOURCES: Readonly<Record<PlayProvider, Readonly<{ variable: string; store: string }>>> = Object.freeze({
  anthropic: Object.freeze({ variable: "ANTHROPIC_API_KEY", store: ".config/anthropic/key" }),
  openrouter: Object.freeze({ variable: "OPENROUTER_API_KEY", store: ".config/openrouter/key" }),
});

export const PLAY_USAGE = "usage: pnpm play [--provider=anthropic|openrouter|off] [--port=<1024-65535>]";

export interface PlayOptions {
  /** The provider asked for; `off` plays the static game. Unset, the first provider with a key. */
  readonly provider?: PlayProvider | "off";
  /** The port asked for. Unset, the first free one from 3000. */
  readonly port?: number;
}

/** The command's flags, each at most once; `undefined` for anything else. */
export const parsePlayArguments = (argv: readonly string[]): PlayOptions | undefined => {
  const seen = new Map<string, string>();
  for (const argument of argv) {
    const match = /^--(provider|port)=(.+)$/u.exec(argument);
    if (match === null || seen.has(match[1]!)) return undefined;
    seen.set(match[1]!, match[2]!);
  }
  const provider = seen.get("provider");
  if (provider !== undefined && provider !== "off" && !isPlayProvider(provider)) return undefined;
  const asked = seen.get("port");
  if (asked !== undefined && !/^[1-9]\d{3,4}$/u.test(asked)) return undefined;
  const port = asked === undefined ? undefined : Number(asked);
  if (port !== undefined && (port < 1024 || port > 65_535)) return undefined;
  return Object.freeze({
    ...(provider === undefined ? {} : { provider: provider as PlayProvider | "off" }),
    ...(port === undefined ? {} : { port }),
  });
};

/** A key's standard store, read: the key, nothing there, or the code of why it was refused. */
export type StoredKey =
  | Readonly<{ key: string }>
  | Readonly<{ missing: true }>
  | Readonly<{ refused: "PLAY_KEY_NOT_A_FILE" | "PLAY_KEY_MODE" | "PLAY_KEY_MALFORMED" | "PLAY_KEY_UNREADABLE" }>;

/**
 * Reads one key store. It must be a regular file that only its owner can read or write (mode 0600 or tighter): a
 * link, a directory, or a file its group or anyone else can open is refused, not read.
 */
export const readStoredKey = (path: string): StoredKey => {
  let mode: number;
  try {
    const stats = lstatSync(path);
    if (!stats.isFile()) return Object.freeze({ refused: "PLAY_KEY_NOT_A_FILE" });
    mode = stats.mode;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? Object.freeze({ missing: true }) : Object.freeze({ refused: "PLAY_KEY_UNREADABLE" });
  }
  if ((mode & 0o077) !== 0) return Object.freeze({ refused: "PLAY_KEY_MODE" });
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { return Object.freeze({ refused: "PLAY_KEY_UNREADABLE" }); }
  const key = text.trim();
  // A key is one line of printable characters; an empty file or anything else is not put into an environment.
  return /^[\x21-\x7e]+$/u.test(key) ? Object.freeze({ key }) : Object.freeze({ refused: "PLAY_KEY_MALFORMED" });
};

export const storePath = (provider: PlayProvider, home: string = homedir()): string => join(home, KEY_SOURCES[provider].store);

type Environment = Readonly<Record<string, string | undefined>>;

export interface PlayPlan {
  /** The provider that answers generative UI, or `off` for the static game. */
  readonly provider: PlayProvider | "off";
  /** Where the key came from; undefined when generative UI is off. */
  readonly keyFrom?: "environment" | "store";
  /** The server's environment: the caller's, with the generative UI settings replaced. */
  readonly environment: Record<string, string>;
}
export type PlayRefusal = Readonly<{ refused: string }>;

const set = (value: string | undefined): value is string => value !== undefined && value.length > 0;

/**
 * Plans the server's environment. A named provider must have a key, in the environment or its store. With none
 * named, the first provider in `PLAY_PROVIDERS` that has one is taken, and with no key anywhere the game plays
 * static. A store that exists and is refused always stops the command: its mode is the owner's to fix, never a
 * reason to fall through to another key.
 */
export const planPlay = (
  options: PlayOptions,
  env: Environment,
  read: (provider: PlayProvider) => StoredKey = (provider) => readStoredKey(storePath(provider)),
): PlayPlan | PlayRefusal => {
  const base: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) if (value !== undefined) base[name] = value;
  // The server gets the chosen provider's key and no other.
  for (const provider of PLAY_PROVIDERS) delete base[KEY_SOURCES[provider].variable];
  delete base.GENUI_ENABLED;
  delete base.GENUI_PROVIDER;
  const off = (): PlayPlan => Object.freeze({ provider: "off", environment: base });
  if (options.provider === "off") return off();

  for (const provider of options.provider === undefined ? PLAY_PROVIDERS : [options.provider]) {
    const { variable } = KEY_SOURCES[provider];
    const given = env[variable];
    let key: string | undefined;
    let keyFrom: "environment" | "store" = "environment";
    if (set(given)) key = given;
    else {
      const stored = read(provider);
      if ("refused" in stored) return Object.freeze({ refused: stored.refused });
      if ("key" in stored) { key = stored.key; keyFrom = "store"; }
    }
    if (key === undefined) continue;
    return Object.freeze({ provider, keyFrom, environment: { ...base, GENUI_ENABLED: "1", GENUI_PROVIDER: provider, [variable]: key } });
  }
  return options.provider === undefined ? off() : Object.freeze({ refused: "PLAY_KEY_MISSING" });
};

/** The first port from `first` that `taken` reports free, among `count`; undefined when none is. */
export const firstFreePort = async (taken: (port: number) => Promise<boolean>, first = 3000, count = 20): Promise<number | undefined> => {
  for (let port = first; port < first + count; port += 1) if (!await taken(port)) return port;
  return undefined;
};
