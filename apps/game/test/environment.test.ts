import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { ENVIRONMENT_CODES, OPENROUTER_BASE_URL, checkEnvironment, publicMode } = await import("../src/server/environment.server");
const { DEFAULT_BASE_URL } = await import("../src/genui/model.server");
const { openGame } = await import("../src/demo/local-real-experiment-session.server");
const { register } = await import("../src/instrumentation");

/** A public server configured for anonymous play. */
const PUBLIC = Object.freeze({
  CODEGUESSR_PUBLIC: "1",
  CODEGUESSR_SESSION_SECRET: "s".repeat(32),
  CODEGUESSR_PUBLIC_ORIGIN: "https://codeguessr.example",
  CODEGUESSR_STATE_DIR: "/data/state",
  EXPERIMENT_EVENTS_DIR: "/data/events",
  CODEGUESSR_CLIENT_IP_HEADER: "X-Forwarded-For",
});
const SENTINEL = "planted-sentinel-7f3a9c";
const SESSION_GLOBALS = Symbol.for("codeguessr.game-session");
const forgetSessionGlobals = (): void => { delete (globalThis as Record<symbol, unknown>)[SESSION_GLOBALS]; };

/** Each code, and one public environment that fails with exactly that code. */
const FAILURES = [
  ["CODEGUESSR_SESSION_SECRET_MISSING", { CODEGUESSR_SESSION_SECRET: undefined }],
  ["CODEGUESSR_SESSION_SECRET_TOO_SHORT", { CODEGUESSR_SESSION_SECRET: "s".repeat(31) }],
  ["CODEGUESSR_PUBLIC_ORIGIN_MISSING", { CODEGUESSR_PUBLIC_ORIGIN: "" }],
  ["CODEGUESSR_PUBLIC_ORIGIN_INVALID", { CODEGUESSR_PUBLIC_ORIGIN: "http://codeguessr.example" }],
  ["CODEGUESSR_PUBLIC_ORIGIN_INVALID", { CODEGUESSR_PUBLIC_ORIGIN: "https://codeguessr.example/" }],
  ["CODEGUESSR_PUBLIC_ORIGIN_INVALID", { CODEGUESSR_PUBLIC_ORIGIN: "https://codeguessr.example/play" }],
  ["CODEGUESSR_PUBLIC_ORIGIN_INVALID", { CODEGUESSR_PUBLIC_ORIGIN: "https://user@codeguessr.example" }],
  ["CODEGUESSR_PUBLIC_ORIGIN_INVALID", { CODEGUESSR_PUBLIC_ORIGIN: "codeguessr.example" }],
  ["CODEGUESSR_STATE_DIR_MISSING", { CODEGUESSR_STATE_DIR: undefined }],
  ["CODEGUESSR_STATE_DIR_RELATIVE", { CODEGUESSR_STATE_DIR: "data/state" }],
  ["EXPERIMENT_EVENTS_DIR_MISSING", { EXPERIMENT_EVENTS_DIR: "" }],
  ["EXPERIMENT_EVENTS_DIR_RELATIVE", { EXPERIMENT_EVENTS_DIR: "./events" }],
  ["CODEGUESSR_CLIENT_IP_HEADER_MISSING", { CODEGUESSR_CLIENT_IP_HEADER: undefined }],
  ["CODEGUESSR_CLIENT_IP_HEADER_INVALID", { CODEGUESSR_CLIENT_IP_HEADER: "X-Forwarded-For: 10.0.0.1" }],
  ["OPENROUTER_API_KEY_MISSING", { GENUI_ENABLED: "1" }],
  ["OPENROUTER_BASE_URL_REJECTED", { OPENROUTER_BASE_URL: "http://127.0.0.1:3201/api/v1" }],
  ["OPENROUTER_BASE_URL_REJECTED", { OPENROUTER_BASE_URL: "" }],
  ["EXPERIMENT_LAB_REJECTED", { EXPERIMENT_LAB: "1" }],
  ["EXPERIMENT_LAB_REJECTED", { EXPERIMENT_LAB: "1", EXPERIMENT_SOURCE: "admin" }],
  ["EXPERIMENT_DISABLED_UNKNOWN", { EXPERIMENT_DISABLED: "design:host,design:hologram" }],
  ["EXPERIMENT_DISABLED_UNKNOWN", { EXPERIMENT_DISABLED: "layer" }],
] as const;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  forgetSessionGlobals();
});

describe("the boot check (#97)", () => {
  it("asks nothing new outside public mode", () => {
    expect(checkEnvironment({})).toEqual([]);
    expect(checkEnvironment({ CODEGUESSR_PUBLIC: "0", EXPERIMENT_LAB: "1", EXPERIMENT_DISABLED: "junk", OPENROUTER_BASE_URL: "http://127.0.0.1/api/v1",
      CODEGUESSR_SESSION_SECRET: "short", GENUI_ENABLED: "1" })).toEqual([]);
    expect(checkEnvironment({ CODEGUESSR_PUBLIC: "" })).toEqual([]);
    expect(publicMode({ CODEGUESSR_PUBLIC: "0" })).toBe(false);
  });

  it("refuses a public flag it can't read rather than guessing", () => {
    for (const value of ["true", "yes", "1 ", "on"]) expect(checkEnvironment({ ...PUBLIC, CODEGUESSR_PUBLIC: value })).toEqual(["CODEGUESSR_PUBLIC_INVALID"]);
  });

  it("passes a public server configured for anonymous play", () => {
    expect(checkEnvironment(PUBLIC)).toEqual([]);
    expect(checkEnvironment({ ...PUBLIC, GENUI_ENABLED: "1", OPENROUTER_API_KEY: "key", OPENROUTER_BASE_URL: OPENROUTER_BASE_URL,
      EXPERIMENT_DISABLED: " design:host, theme:arcade ,", CODEGUESSR_CLIENT_IP_HEADER: "CF-Connecting-IP" })).toEqual([]);
  });

  it.each(FAILURES)("names %s for one wrong setting", (code, change) => {
    expect(checkEnvironment({ ...PUBLIC, ...change })).toEqual([code]);
  });

  it("has a failing environment for every code it can give", () => {
    expect(new Set([...FAILURES.map(([code]) => code), "CODEGUESSR_PUBLIC_INVALID"])).toEqual(new Set(ENVIRONMENT_CODES));
  });

  it("names every failure at once, in a fixed order", () => {
    expect(checkEnvironment({ CODEGUESSR_PUBLIC: "1", GENUI_ENABLED: "1", EXPERIMENT_LAB: "1", OPENROUTER_BASE_URL: "http://x", EXPERIMENT_DISABLED: "x:y" }))
      .toEqual(["CODEGUESSR_SESSION_SECRET_MISSING", "CODEGUESSR_PUBLIC_ORIGIN_MISSING", "CODEGUESSR_STATE_DIR_MISSING", "EXPERIMENT_EVENTS_DIR_MISSING",
        "CODEGUESSR_CLIENT_IP_HEADER_MISSING", "OPENROUTER_API_KEY_MISSING", "OPENROUTER_BASE_URL_REJECTED", "EXPERIMENT_LAB_REJECTED", "EXPERIMENT_DISABLED_UNKNOWN"]);
  });

  it("lets a smoke run tagged non-real use lab mode and a stand-in model", () => {
    for (const source of ["agent", "synthetic"]) {
      expect(checkEnvironment({ ...PUBLIC, EXPERIMENT_SOURCE: source, EXPERIMENT_LAB: "1", OPENROUTER_BASE_URL: "http://127.0.0.1:3201/api/v1" })).toEqual([]);
    }
  });

  it("holds real games to the address generative UI uses by default", () => {
    expect(OPENROUTER_BASE_URL).toBe(DEFAULT_BASE_URL);
  });

  it("never returns a value, only codes", () => {
    const planted = Object.fromEntries([
      "CODEGUESSR_PUBLIC_ORIGIN", "CODEGUESSR_STATE_DIR", "EXPERIMENT_EVENTS_DIR", "CODEGUESSR_CLIENT_IP_HEADER", "OPENROUTER_BASE_URL", "EXPERIMENT_DISABLED",
    ].map((name) => [name, `${SENTINEL}:${name}`]));
    const codes = checkEnvironment({ ...planted, CODEGUESSR_PUBLIC: "1", CODEGUESSR_SESSION_SECRET: SENTINEL, GENUI_ENABLED: "1" });
    expect(codes.length).toBeGreaterThan(5);
    expect(codes.every((code) => (ENVIRONMENT_CODES as readonly string[]).includes(code))).toBe(true);
    expect(JSON.stringify(codes)).not.toContain(SENTINEL);
  });
});

describe("boot (#97)", () => {
  /** Every variable the check reads, unset first, so the shell running the tests can't change the outcome. */
  const CHECKED = ["CODEGUESSR_PUBLIC", "CODEGUESSR_SESSION_SECRET", "CODEGUESSR_PUBLIC_ORIGIN", "CODEGUESSR_STATE_DIR", "EXPERIMENT_EVENTS_DIR",
    "CODEGUESSR_CLIENT_IP_HEADER", "GENUI_ENABLED", "OPENROUTER_API_KEY", "OPENROUTER_BASE_URL", "EXPERIMENT_SOURCE", "EXPERIMENT_LAB", "EXPERIMENT_DISABLED"];
  const boot = async (env: Record<string, string | undefined>) => {
    for (const name of CHECKED) vi.stubEnv(name, undefined);
    for (const [name, value] of Object.entries({ NEXT_RUNTIME: "nodejs", ...env })) vi.stubEnv(name, value);
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    await register();
    return { lines: logged.mock.calls.map((call) => call.join(" ")), exits: exit.mock.calls.map(([code]) => code) };
  };

  it("starts a public server that passes the check, printing nothing", async () => {
    expect(await boot(PUBLIC)).toEqual({ lines: [], exits: [] });
  });

  it("prints one code per failure and exits 78, never printing a value", async () => {
    const { lines, exits } = await boot({ ...PUBLIC, CODEGUESSR_SESSION_SECRET: undefined, CODEGUESSR_PUBLIC_ORIGIN: `http://${SENTINEL}.example`,
      EXPERIMENT_LAB: "1", OPENROUTER_API_KEY: SENTINEL });
    expect(lines).toEqual(["GAME_ENVIRONMENT_REJECTED CODEGUESSR_SESSION_SECRET_MISSING", "GAME_ENVIRONMENT_REJECTED CODEGUESSR_PUBLIC_ORIGIN_INVALID",
      "GAME_ENVIRONMENT_REJECTED EXPERIMENT_LAB_REJECTED"]);
    expect(exits).toEqual([78]);
  });

  it("checks nothing in the edge runtime", async () => {
    expect(await boot({ CODEGUESSR_PUBLIC: "1", NEXT_RUNTIME: "edge" })).toEqual({ lines: [], exits: [] });
  });

  it("only ever prints the code line", () => {
    const source = readFileSync(new URL("../src/instrumentation.ts", import.meta.url), "utf8");
    expect([...source.matchAll(/console\.\w+\((.*)\);/gu)].map(([, argument]) => argument)).toEqual(["`GAME_ENVIRONMENT_REJECTED ${code}`"]);
  });
});

describe("the session secret in public mode (#97)", () => {
  it("is never made up: a public server without one refuses to sign or open a game", () => {
    vi.stubEnv("CODEGUESSR_PUBLIC", "1");
    vi.stubEnv("CODEGUESSR_SESSION_SECRET", undefined);
    forgetSessionGlobals();
    expect(() => openGame("payload.signature", "0".repeat(64), 0)).toThrow("CODEGUESSR_SESSION_SECRET_MISSING");
  });

  it("is made up for a local server without one, as before", () => {
    vi.stubEnv("CODEGUESSR_PUBLIC", undefined);
    vi.stubEnv("CODEGUESSR_SESSION_SECRET", undefined);
    forgetSessionGlobals();
    expect(() => openGame("payload.signature", "0".repeat(64), 0)).toThrow("GAME_SESSION_REFUSED");
  });
});
