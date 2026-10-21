import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** What the loader reports; each test sets it. */
let loaded: { ok: true } | { ok: false; reason: string } = { ok: true };
vi.mock("../src/demo/local-real-experiment-loader.server", () => ({ activeLocalRealExperiment: () => loaded }));

const { GET } = await import("../src/app/api/health/route");

const STORE = Symbol.for("codeguessr.state-store");
const forgetStore = (): void => {
  const holder = globalThis as Record<symbol, any>;
  holder[STORE]?.store?.close();
  delete holder[STORE];
};
const check = async () => {
  const response = GET();
  return { status: response.status, body: await response.text(), cache: response.headers.get("cache-control") };
};

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "codeguessr-health-"));
  loaded = { ok: true };
  forgetStore();
  vi.stubEnv("CODEGUESSR_STATE_DIR", "");
  vi.stubEnv("EXPERIMENT_EVENTS_DIR", "");
});
afterEach(() => {
  forgetStore();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("the health route (#164)", () => {
  it("answers ok when the artifact loaded and nothing else is configured", async () => {
    expect(await check()).toEqual({ status: 200, body: "ok", cache: "no-store" });
  });

  it("answers ok with writable state and event directories, and records nothing in them", async () => {
    vi.stubEnv("CODEGUESSR_STATE_DIR", join(directory, "state"));
    vi.stubEnv("EXPERIMENT_EVENTS_DIR", join(directory, "events"));
    expect(await check()).toEqual({ status: 200, body: "ok", cache: "no-store" });
    expect(readdirSync(join(directory, "events"))).toEqual([]);
  });

  it.each([["MISSING"], ["HASH_MISMATCH"], ["SCHEMA"]])("answers 503 ARTIFACT_%s when the artifact did not load", async (reason) => {
    loaded = { ok: false, reason };
    expect(await check()).toEqual({ status: 503, body: `ARTIFACT_${reason}`, cache: "no-store" });
  });

  it("answers 503 with a bare code when a configured directory can't be written", async () => {
    const file = join(directory, "file");
    writeFileSync(file, "");
    vi.stubEnv("CODEGUESSR_STATE_DIR", join(file, "state"));
    expect(await check()).toEqual({ status: 503, body: "STATE_DIR_UNWRITABLE", cache: "no-store" });
    vi.stubEnv("CODEGUESSR_STATE_DIR", "");
    vi.stubEnv("EXPERIMENT_EVENTS_DIR", join(file, "events"));
    expect(await check()).toEqual({ status: 503, body: "EVENTS_DIR_UNWRITABLE", cache: "no-store" });
  });

  it("answers 503 when the state store can't open", async () => {
    vi.stubEnv("CODEGUESSR_STATE_DIR", directory);
    writeFileSync(join(directory, "state.sqlite"), "not a database, just enough bytes to fail the header check........");
    expect(await check()).toEqual({ status: 503, body: "STATE_STORE_UNAVAILABLE", cache: "no-store" });
  });
});
