import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const modulePath: string = "../src/demo/local-real-experiment.server";
const authorityModule = await import(modulePath).catch(() => ({})) as Record<string, unknown>;
const createLocalRealExperiment = typeof authorityModule.createLocalRealExperiment === "function"
  ? authorityModule.createLocalRealExperiment as (input: unknown, expectedArtifactHash: string) => any
  : (): never => { throw new Error("LOCAL_REAL_EXPERIMENT_NOT_IMPLEMENTED"); };

import { artifact, hash, hashValue, sha } from "./support/local-real-artifact";

const create = (value = artifact(), expectedArtifactHash = hashValue(value)) =>
  createLocalRealExperiment(value, expectedArtifactHash);
const rehashed = (value: unknown) => create(value, hashValue(value));

describe("server-only local real experiment authority", () => {
  it("keeps every production source in the local-real authority set at 500 lines or fewer", () => {
    const sourceDirectory = new URL("../src/demo/", import.meta.url);
    const oversized = readdirSync(sourceDirectory)
      .filter((name) => /^local-real-experiment.*\.ts$/u.test(name))
      .map((name) => ({
        name,
        lines: readFileSync(new URL(name, sourceDirectory), "utf8").split("\n").length,
      }))
      .filter(({ lines }) => lines > 500);

    expect(oversized).toEqual([]);
  });

  it("exports the injected artifact factory", () => {
    expect(authorityModule.createLocalRealExperiment).toBeTypeOf("function");
  });

  it("requires the trusted artifact hash as a separate consumption input", () => {
    const factory = authorityModule.createLocalRealExperiment as
      ((value: unknown, expectedArtifactHash: string) => unknown);
    const value = artifact();

    expect(factory.length).toBe(2);
    expect(() => factory(value, hashValue(value))).not.toThrow();
  });

  it("accepts one hash-bound artifact and derives the exact source split", () => {
    const experiment = create();

    expect(experiment.kind).toBe("LOCAL_UNREVIEWED_EXPERIMENT");
    expect(experiment.mode.rounds.map((round: any) => round.mode.kind)).toEqual([
      "provenance", "provenance", "provenance", "language", "language",
    ]);
    expect(Object.isFrozen(experiment)).toBe(true);
    expect(Object.isFrozen(experiment.mode.rounds[0].mode.candidates)).toBe(true);
    expect(Object.isFrozen(experiment.privateReveals)).toBe(true);
  });

  it("keeps protected fixture fields out of the public projection", () => {
    const input = artifact();
    const experiment = create(input);
    const publicText = JSON.stringify(experiment.mode);

    expect(experiment.mode.rounds.map((round: any) => round.roundId).sort()).toEqual(
      Object.keys(experiment.privateReveals).sort(),
    );
    expect(publicText).not.toMatch(/correctCandidateId|privateReveals|evidence|explanation|attribution|source/iu);
    for (const fixture of input.fixtures) {
      expect(publicText).not.toContain(fixture.source.repository);
      expect(publicText).not.toContain(fixture.source.commit);
      expect(publicText).not.toContain(fixture.attribution);
    }
  });

  it("rejects stale or edited content even when the caller supplies an object", () => {
    const original = artifact();
    const expectedArtifactHash = hashValue(original);
    const stale = structuredClone(original);
    stale.fixtures[0]!.excerpt = "const edited = true;";

    expect(() => create(stale, expectedArtifactHash)).toThrow(/LOCAL_REAL_EXPERIMENT_REJECTED/u);
    expect(() => rehashed(stale)).toThrow(/LOCAL_REAL_EXPERIMENT_REJECTED/u);
  });

  it("accepts canonical microsecond timestamps and rejects impossible calendar dates", () => {
    const precise = artifact();
    for (const fixture of precise.fixtures.slice(3)) {
      fixture.source.visitDate = "2026-01-03T00:00:00.123456Z";
      fixture.source.revisionDate = "2026-01-02T00:00:00.123456Z";
      fixture.source.committerDate = "2026-01-01T00:00:00.123456Z";
    }
    expect(() => rehashed(precise)).not.toThrow();

    const impossible = artifact();
    impossible.fixtures[3]!.source.visitDate = "2026-02-31T00:00:00Z";
    expect(() => rehashed(impossible)).toThrow(/LOCAL_REAL_EXPERIMENT_REJECTED/u);
  });

  it("rejects protected source leakage and unsupported provenance claims in public fields", () => {
    const sourceLeak = artifact();
    sourceLeak.fixtures[0]!.clues[0] = sourceLeak.fixtures[1]!.source.repository;
    const claimDrift = artifact();
    claimDrift.fixtures[0]!.prompt = "Did a person create this?";

    expect(() => rehashed(sourceLeak)).toThrow(/LOCAL_REAL_EXPERIMENT_REJECTED/u);
    expect(() => rehashed(claimDrift)).toThrow(/LOCAL_REAL_EXPERIMENT_REJECTED/u);
  });

  it("rejects protected source leakage from an otherwise valid language clue", () => {
    const sourceLeak = artifact();
    sourceLeak.fixtures[3]!.clues[0] = sourceLeak.fixtures[4]!.source.repository;

    expect(() => rehashed(sourceLeak)).toThrow(/LOCAL_REAL_EXPERIMENT_REJECTED/u);
  });

  it("fails closed for mixed, wrong-source, controlled-status, missing, duplicate, and extra records", () => {
    const variants: unknown[] = [];
    const mixed = artifact();
    mixed.fixtures[4]!.source.crawlSnapshotId = hash("f");
    variants.push(mixed);
    const wrongSource = artifact();
    wrongSource.fixtures[0]!.source.discoverySource = "STACK_V2";
    variants.push(wrongSource);
    const controlled = artifact() as ReturnType<typeof artifact> & { approvalId?: string };
    controlled.approvalId = "controlled-approval";
    variants.push(controlled);
    const missing = artifact();
    delete (missing.fixtures[0]!.source as Partial<typeof missing.fixtures[0]["source"]>).licenseSpdx;
    variants.push(missing);
    const duplicate = artifact();
    duplicate.fixtures[1] = structuredClone(duplicate.fixtures[0]!);
    variants.push(duplicate);
    const short = artifact();
    short.fixtures.pop();
    variants.push(short);
    const extra = artifact();
    extra.fixtures.push(structuredClone(extra.fixtures[4]!));
    variants.push(extra);

    for (const variant of variants) {
      expect(() => rehashed(variant)).toThrow(/LOCAL_REAL_EXPERIMENT_REJECTED/u);
    }
  });

  it("rejects every malformed reveal request without returning protected data", () => {
    const experiment = create();
    const request = {
      roundId: "local-round-0",
      roundVersionId: sha("round-version-0"),
      candidateId: "local-experiment.marker-recorded.v1",
      completedRounds: 0,
      currentScore: 0,
      cluesUsed: 0,
    };
    const invalid = [
      { ...request, unexpected: true },
      { ...request, completedRounds: 1 },
      { ...request, roundId: "local-round-1" },
      { ...request, roundVersionId: "stale" },
      { ...request, candidateId: "unknown" },
      { ...request, cluesUsed: 3 },
      { ...request, currentScore: 1 },
    ];

    for (const value of invalid) {
      let serialized = "";
      try {
        experiment.createReveal(value);
      } catch (error) {
        serialized = JSON.stringify(error instanceof Error ? error.message : error);
      }
      expect(serialized).toMatch(/LOCAL_REAL_EXPERIMENT_REJECTED/u);
      expect(serialized).not.toMatch(/Recorded evidence|Developer 0|github\.com/iu);
    }
  });

  it("reveals attribution only after submission and preserves scoring and versions", () => {
    const experiment = create();
    expect(JSON.stringify(experiment.mode)).not.toContain("Developer 0");

    const reveal = experiment.createReveal({
      roundId: "local-round-0",
      roundVersionId: sha("round-version-0"),
      candidateId: "local-experiment.marker-recorded.v1",
      completedRounds: 0,
      currentScore: 0,
      cluesUsed: 1,
    });

    expect(reveal.correct).toBe(true);
    expect(reveal.score).toBe(800);
    expect(reveal.attribution).toContain("Developer 0");
    expect(reveal.attribution).toContain("https://github.com/example/project-0/blob/");
    expect(reveal.versions.content).toBe(artifact().fixtures[0]!.source.excerptHash);
    expect(reveal.result).toEqual({
      score: 800,
      attainableMaximum: 5000,
      completedRounds: 1,
      resultVersionId: expect.stringMatching(/^local-experiment:/u),
    });
    expect(Object.isFrozen(reveal)).toBe(true);
    expect(Object.isFrozen(reveal.result)).toBe(true);
  });
});
