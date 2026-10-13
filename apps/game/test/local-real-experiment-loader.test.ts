import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

import { artifact, hashValue } from "./support/local-real-artifact";

vi.mock("server-only", () => ({}));

const loaderModule = await import("../src/demo/local-real-experiment-loader.server");
const {
  ARTIFACT_RELATIVE_PATH, LOCAL_REAL_EXPERIMENT_NOTICE, LOCAL_REAL_EXPERIMENT_NOTICE_BODY, LOCAL_REAL_EXPERIMENT_NOTICE_LEAD,
  activeLocalRealExperiment, loadLocalRealExperiment,
} = loaderModule;

const written = (value: unknown, name = "local-real-rounds.json"): string => {
  const directory = mkdtempSync(join(tmpdir(), "codeguessr-loader-"));
  const path = join(directory, name);
  writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
  return path;
};

describe("server-only local real experiment loader", () => {
  it("binds a generated artifact to the trusted hash and derives the three decks", () => {
    const value = artifact();
    const loaded = loadLocalRealExperiment({ artifactPath: written(value), trustedArtifactHash: hashValue(value) });

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.experiment.kind).toBe("LOCAL_UNREVIEWED_EXPERIMENT");
    expect(loaded.experiment.artifactHash).toBe(hashValue(value));
    expect(loaded.experiment.decks.map((deck: any) => deck.id)).toEqual(["project", "language", "before-after"]);
    expect(loaded.experiment.decks.every((deck: any) => loaded.experiment.dealSession(deck.id).rounds.length === 5)).toBe(true);
    expect(Object.isFrozen(loaded)).toBe(true);
  });

  it("reports a missing artifact without any synthetic fallback", () => {
    const loaded = loadLocalRealExperiment({ artifactPath: join(tmpdir(), "codeguessr-absent", "none.json"), trustedArtifactHash: hashValue(artifact()) });

    expect(loaded).toEqual({ ok: false, reason: "ARTIFACT_MISSING" });
  });

  it("rejects malformed, hash-mismatched, edited, and placeholder-pinned artifacts", () => {
    const value = artifact();
    const edited = artifact();
    edited.decks[0].fixtures[0].panes[0].text = "edited";
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

  it("binds the committed artifact to the preparer-written pin and deals five-round sessions", async () => {
    const { TRUSTED_ARTIFACT_HASH } = await import("../src/demo/local-real-experiment.pin.server");
    const loaded = loadLocalRealExperiment({ artifactPath: fileURLToPath(new URL("../src/demo/generated/local-real-rounds.json", import.meta.url)) });

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.experiment.artifactHash).toBe(TRUSTED_ARTIFACT_HASH);
    expect(loaded.experiment.decks.length).toBeGreaterThan(0);
    for (const deck of loaded.experiment.decks) {
      expect(deck.poolSize).toBeGreaterThanOrEqual(5);
      expect(loaded.experiment.dealSession(deck.id).rounds).toHaveLength(5);
    }
  });

  it("resolves the default artifact beside the game sources and memoizes the active authority", () => {
    expect(ARTIFACT_RELATIVE_PATH).toBe("src/demo/generated/local-real-rounds.json");
    const first = activeLocalRealExperiment();
    expect(activeLocalRealExperiment()).toBe(first);
    expect(typeof first.ok).toBe("boolean");
  });

  it("names every round source and the unreviewed localhost status in a short permanent notice", () => {
    for (const source of ["The Stack v2", "GitHub", "TheAlgorithms", "Defects4J", "BugsInPy"]) {
      expect(LOCAL_REAL_EXPERIMENT_NOTICE).toContain(source);
    }
    expect(LOCAL_REAL_EXPERIMENT_NOTICE).toMatch(/^Local unreviewed experiment\./u);
    expect(LOCAL_REAL_EXPERIMENT_NOTICE).toMatch(/localhost/u);
    expect(LOCAL_REAL_EXPERIMENT_NOTICE).toMatch(/Not approved beta content/u);
    expect(LOCAL_REAL_EXPERIMENT_NOTICE).toBe(`${LOCAL_REAL_EXPERIMENT_NOTICE_LEAD} ${LOCAL_REAL_EXPERIMENT_NOTICE_BODY}`);
    // The old notice ran to nine lines on a 320 px screen; the browser test holds this one to five.
    expect(LOCAL_REAL_EXPERIMENT_NOTICE.length).toBeLessThanOrEqual(150);
  });

  it("binds the root route and its reveal action to the local experiment loader", () => {
    const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
    const actions = readFileSync(new URL("../src/app/actions.ts", import.meta.url), "utf8");
    expect(page).toContain("local-real-experiment-loader.server");
    expect(page).toContain("authorizeLocalExperimentReveal");
    expect(actions).toContain("local-real-experiment-loader.server");
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
