import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { artifact, hashValue } from "./support/local-real-artifact";

vi.mock("server-only", () => ({}));

const loaderModule = await import("../src/demo/local-real-experiment-loader.server");
const { ARTIFACT_RELATIVE_PATH, LOCAL_REAL_EXPERIMENT_NOTICE, activeLocalRealExperiment, loadLocalRealExperiment } = loaderModule;

const written = (value: unknown, name = "local-real-rounds.json"): string => {
  const directory = mkdtempSync(join(tmpdir(), "codeguessr-loader-"));
  const path = join(directory, name);
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
  return path;
};

describe("server-only local real experiment loader", () => {
  it("binds a generated artifact to the trusted hash and derives the exact source split", () => {
    const value = artifact();
    const loaded = loadLocalRealExperiment({ artifactPath: written(value), trustedArtifactHash: hashValue(value) });

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.experiment.kind).toBe("LOCAL_UNREVIEWED_EXPERIMENT");
    expect(loaded.experiment.artifactHash).toBe(hashValue(value));
    expect(loaded.experiment.mode.rounds.map((round: any) => round.mode.kind)).toEqual([
      "provenance", "provenance", "provenance", "language", "language",
    ]);
    expect(Object.isFrozen(loaded)).toBe(true);
  });

  it("reports a missing artifact without any synthetic fallback", () => {
    const loaded = loadLocalRealExperiment({ artifactPath: join(tmpdir(), "codeguessr-absent", "none.json"), trustedArtifactHash: hashValue(artifact()) });

    expect(loaded).toEqual({ ok: false, reason: "ARTIFACT_MISSING" });
  });

  it("rejects malformed, hash-mismatched, edited, and placeholder-pinned artifacts", () => {
    const value = artifact();
    const edited = artifact();
    (edited.fixtures[0] as any).excerpt = "edited";
    const cases = [
      { artifactPath: written("{not json"), trustedArtifactHash: hashValue(value) },
      { artifactPath: written(value), trustedArtifactHash: "f".repeat(64) },
      { artifactPath: written(value), trustedArtifactHash: "not-a-hash" },
      { artifactPath: written(edited), trustedArtifactHash: hashValue(value) },
      { artifactPath: written(value) },
    ];
    for (const options of cases) {
      expect(loadLocalRealExperiment(options)).toEqual({ ok: false, reason: "ARTIFACT_REJECTED" });
    }
  });

  it("resolves the default artifact beside the game sources and memoizes the active authority", () => {
    expect(ARTIFACT_RELATIVE_PATH).toBe("src/demo/generated/local-real-rounds.json");
    const first = activeLocalRealExperiment();
    expect(activeLocalRealExperiment()).toBe(first);
    expect(typeof first.ok).toBe("boolean");
  });

  it("names both sources and the unreviewed localhost status in the permanent notice", () => {
    expect(LOCAL_REAL_EXPERIMENT_NOTICE).toMatch(/GitHub Search/u);
    expect(LOCAL_REAL_EXPERIMENT_NOTICE).toMatch(/Stack v2/u);
    expect(LOCAL_REAL_EXPERIMENT_NOTICE).toMatch(/automatically/u);
    expect(LOCAL_REAL_EXPERIMENT_NOTICE).toMatch(/unreviewed|without human review/u);
    expect(LOCAL_REAL_EXPERIMENT_NOTICE).toMatch(/localhost/u);
    expect(LOCAL_REAL_EXPERIMENT_NOTICE).toMatch(/Not approved beta content/u);
  });

  it("stays server-only, reads only the generated file, and never imports the synthetic catalogue", () => {
    const source = readFileSync(new URL("../src/demo/local-real-experiment-loader.server.ts", import.meta.url), "utf8");
    const pin = readFileSync(new URL("../src/demo/local-real-experiment.pin.server.ts", import.meta.url), "utf8");
    expect(source).toMatch(/^import "server-only";/u);
    expect(pin).toMatch(/^import "server-only";/u);
    expect(source).not.toMatch(/rehearsal|demo-game|DEMO_MODE|fetch\s*\(/u);
    expect(source).not.toMatch(/from ".*generated\/local-real-rounds\.json"/u);
    expect(pin).toMatch(/TRUSTED_ARTIFACT_HASH = "[0-9a-f]{64}"/u);
  });
});
