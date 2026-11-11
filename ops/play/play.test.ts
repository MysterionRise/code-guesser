import { chmodSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { firstFreePort, KEY_SOURCES, parsePlayArguments, planPlay, PLAY_PROVIDERS, readStoredKey, storePath, type PlayProvider, type StoredKey } from "./play";

// The operator typecheck keeps vitest types out of its program, as the other ops suites do.
const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const stores = (held: Partial<Record<PlayProvider, StoredKey>>) => (provider: PlayProvider): StoredKey => held[provider] ?? { missing: true };
const none = stores({});

describe("pnpm play", () => {
  it("parses a provider and a port, each once, and nothing else", () => {
    expect(parsePlayArguments([])).toEqual({});
    expect(parsePlayArguments(["--provider=anthropic"])).toEqual({ provider: "anthropic" });
    expect(parsePlayArguments(["--port=3300", "--provider=openrouter"])).toEqual({ provider: "openrouter", port: 3300 });
    expect(parsePlayArguments(["--provider=off"])).toEqual({ provider: "off" });
    for (const argv of [["--provider=openai"], ["--provider="], ["--provider=Anthropic"], ["--provider=off", "--provider=off"], ["--port=80"],
      ["--port=65536"], ["--port=3300x"], ["--port=03300"], ["--host=0.0.0.0"], ["--hostname=0.0.0.0"], ["anthropic"], ["--port", "3300"]]) {
      expect(parsePlayArguments(argv), argv.join(" ")).toBeUndefined();
    }
  });

  it("prefers Anthropic's own API, then the OpenAI-compatible endpoint, then the static game", () => {
    const both = stores({ anthropic: { key: "a-stored" }, openrouter: { key: "o-stored" } });
    expect(planPlay({}, {}, both)).toMatchObject({ provider: "anthropic", keyFrom: "store",
      environment: { GENUI_ENABLED: "1", GENUI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "a-stored" } });
    expect(planPlay({}, {}, stores({ openrouter: { key: "o-stored" } }))).toMatchObject({ provider: "openrouter", keyFrom: "store",
      environment: { GENUI_ENABLED: "1", GENUI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "o-stored" } });
    expect(planPlay({}, { PATH: "/bin" }, none)).toEqual({ provider: "off", environment: { PATH: "/bin" } });
    // A key in the environment outranks its store, and an Anthropic key anywhere outranks an OpenRouter one.
    expect(planPlay({}, { ANTHROPIC_API_KEY: "a-given" }, both)).toMatchObject({ provider: "anthropic", keyFrom: "environment",
      environment: { ANTHROPIC_API_KEY: "a-given" } });
    expect(planPlay({}, { OPENROUTER_API_KEY: "o-given" }, stores({ anthropic: { key: "a-stored" } }))).toMatchObject({ provider: "anthropic", keyFrom: "store" });
    expect(planPlay({}, { OPENROUTER_API_KEY: "o-given", ANTHROPIC_API_KEY: "" }, none)).toMatchObject({ provider: "openrouter", keyFrom: "environment" });
  });

  it("names the provider it chose, and hands the server that provider's key and no other", () => {
    const both = stores({ anthropic: { key: "a-stored" }, openrouter: { key: "o-stored" } });
    const env = { PATH: "/bin", OPENROUTER_API_KEY: "o-given", ANTHROPIC_API_KEY: "a-given", GENUI_PROVIDER: "openai", GENUI_ENABLED: "0",
      ANTHROPIC_MODEL_HOST: "claude-sonnet-5-5", OPENROUTER_MODEL: "anthropic/claude-haiku-5.5" };
    const settings = { PATH: "/bin", ANTHROPIC_MODEL_HOST: "claude-sonnet-5-5", OPENROUTER_MODEL: "anthropic/claude-haiku-5.5" };
    expect(planPlay({ provider: "openrouter" }, env, both)).toEqual({ provider: "openrouter", keyFrom: "environment",
      environment: { ...settings, GENUI_ENABLED: "1", GENUI_PROVIDER: "openrouter", OPENROUTER_API_KEY: "o-given" } });
    expect(planPlay({ provider: "anthropic" }, env, both)).toEqual({ provider: "anthropic", keyFrom: "environment",
      environment: { ...settings, GENUI_ENABLED: "1", GENUI_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "a-given" } });
    // Off plays the static game: no key and no generative UI setting reaches the server.
    expect(planPlay({ provider: "off" }, env, both)).toEqual({ provider: "off", environment: settings });
  });

  it("stops on a named provider with no key, and on a store it must not read, whichever provider would have answered", () => {
    expect(planPlay({ provider: "anthropic" }, { OPENROUTER_API_KEY: "o-given" }, stores({ openrouter: { key: "o-stored" } }))).toEqual({ refused: "PLAY_KEY_MISSING" });
    expect(planPlay({ provider: "openrouter" }, {}, stores({ anthropic: { key: "a-stored" } }))).toEqual({ refused: "PLAY_KEY_MISSING" });
    for (const refused of ["PLAY_KEY_MODE", "PLAY_KEY_NOT_A_FILE", "PLAY_KEY_MALFORMED", "PLAY_KEY_UNREADABLE"] as const) {
      expect(planPlay({}, {}, stores({ anthropic: { refused }, openrouter: { key: "o-stored" } })), refused).toEqual({ refused });
      expect(planPlay({ provider: "openrouter" }, {}, stores({ openrouter: { refused } })), refused).toEqual({ refused });
    }
    // A refused store is never read when the environment already holds that provider's key, or when it is not asked.
    expect(planPlay({}, { ANTHROPIC_API_KEY: "a-given" }, stores({ anthropic: { refused: "PLAY_KEY_MODE" } }))).toMatchObject({ provider: "anthropic" });
    expect(planPlay({ provider: "anthropic" }, {}, stores({ anthropic: { key: "a-stored" }, openrouter: { refused: "PLAY_KEY_MODE" } }))).toMatchObject({ provider: "anthropic" });
  });

  it("reads a key store only as a regular file of mode 0600 or tighter holding one printable line", () => {
    const directory = mkdtempSync(join(tmpdir(), "codeguessr-play-"));
    const file = (name: string, text: string, mode: number): string => {
      const path = join(directory, name);
      writeFileSync(path, text);
      chmodSync(path, mode);
      return path;
    };
    expect(readStoredKey(file("key", "sk-test-0123\n", 0o600))).toEqual({ key: "sk-test-0123" });
    expect(readStoredKey(file("tight", "sk-test-0123", 0o400))).toEqual({ key: "sk-test-0123" });
    expect(readStoredKey(join(directory, "absent"))).toEqual({ missing: true });
    for (const mode of [0o640, 0o604, 0o644, 0o660, 0o666, 0o700 | 0o010]) {
      expect(readStoredKey(file(`open-${mode.toString(8)}`, "sk-test-0123\n", mode)), mode.toString(8)).toEqual({ refused: "PLAY_KEY_MODE" });
    }
    for (const text of ["", "\n", "two\nlines\n", "with space\n", "café\n", "tab\tbed\n"]) {
      expect(readStoredKey(file("odd", text, 0o600)), JSON.stringify(text)).toEqual({ refused: "PLAY_KEY_MALFORMED" });
    }
    mkdirSync(join(directory, "folder"), { mode: 0o700 });
    expect(readStoredKey(join(directory, "folder"))).toEqual({ refused: "PLAY_KEY_NOT_A_FILE" });
    symlinkSync(join(directory, "key"), join(directory, "link"));
    expect(readStoredKey(join(directory, "link"))).toEqual({ refused: "PLAY_KEY_NOT_A_FILE" });
  });

  it("looks for each key in its standard store, and for the providers the server knows", () => {
    expect(storePath("anthropic", "/home/ada")).toBe("/home/ada/.config/anthropic/key");
    expect(storePath("openrouter", "/home/ada")).toBe("/home/ada/.config/openrouter/key");
    // The server's own list (`provider.server.ts`, which only the server may import) names the same providers and prefixes.
    const server = readFileSync(new URL("../../apps/game/src/genui/provider.server.ts", import.meta.url), "utf8");
    const listed = /export const PROVIDERS = Object\.freeze\(\[([^\]]+)\] as const\);/u.exec(server)?.[1]?.split(",").map((name) => name.trim().replace(/"/gu, ""));
    expect([...(listed ?? [])].sort()).toEqual([...PLAY_PROVIDERS].sort());
    for (const provider of PLAY_PROVIDERS) {
      const prefix = new RegExp(`${provider}: "([A-Z]+)"`, "u").exec(server)?.[1];
      expect(KEY_SOURCES[provider].variable).toBe(`${prefix}_API_KEY`);
    }
  });

  it("takes the first port nothing answers on", async () => {
    const busy = new Set([3000, 3001]);
    expect(await firstFreePort(async (port) => busy.has(port))).toBe(3002);
    expect(await firstFreePort(async () => true, 3000, 3)).toBeUndefined();
    expect(await firstFreePort(async () => false, 4000)).toBe(4000);
  });
});
