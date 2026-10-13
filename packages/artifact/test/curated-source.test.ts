import { describe, expect, it } from "vitest";

import { composeExperimentArtifact } from "../../../ops/poc/prepare/compose";
import { composeInput } from "../../../ops/poc/prepare/testdata/deck-builders";
import {
  CURATED_SOURCE_KEYS, ExperimentRecordError, PROFILE_VERSION, parseArtifactDecks, pinKey, validateCuratedSource,
} from "../src/index";

const repository = "TheAlgorithms/Python";
const commit = "a".repeat(40);
const authorCommit = "b".repeat(40);
const path = "sorts/quick_sort.py";
const root = `https://github.com/${repository}`;
const snapshotId = "f".repeat(64);
const pins = new Set([pinKey(repository, commit)]);

/** A file from a curated repository, credited to the last human who changed it before the pin. */
const curatedSource = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  discoverySource: "CURATED_GITHUB", repository, repositoryUrl: root, authorName: "Ada Lovelace", authorLogin: "ada",
  authorBasis: "PATH_HISTORY", authorSourceUrl: `${root}/commit/${authorCommit}`, path, blob: "c".repeat(40),
  rawContentHash: "d".repeat(64), excerptHash: "e".repeat(64), licenseName: "MIT License", licenseSpdx: "MIT",
  licenseFileUrl: `${root}/blob/${commit}/LICENSE.md`, commit, commitUrl: `${root}/commit/${commit}`,
  blobUrl: `${root}/blob/${commit}/${path}`, profileVersion: PROFILE_VERSION, crawlSnapshotId: snapshotId, authorCommit,
  ...overrides,
});

describe("curated GitHub sources", () => {
  it("binds a file to a pinned commit and credits the author's own commit", () => {
    expect(validateCuratedSource(curatedSource(), CURATED_SOURCE_KEYS, snapshotId, pins).repository).toBe(repository);
    for (const overrides of [
      { discoverySource: "STACK_V2" },
      { authorBasis: "SELECTED_COMMIT" },
      // The pin's own commit is not the author's commit.
      { authorSourceUrl: `${root}/commit/${commit}` },
      { authorCommit: "not-a-commit" },
      { commit: "9".repeat(40), commitUrl: `${root}/commit/${"9".repeat(40)}`, blobUrl: `${root}/blob/${"9".repeat(40)}/${path}` },
      { blobUrl: `${root}/blob/${commit}/other.py` },
      { crawlSnapshotId: "0".repeat(64) },
      { extra: true },
    ]) {
      expect(() => validateCuratedSource(curatedSource(overrides), CURATED_SOURCE_KEYS, snapshotId, pins)).toThrow(ExperimentRecordError);
    }
  });

  it("reads the snapshot's pins when the run read curated repositories, and nothing when it read none", () => {
    const withPins = (value: unknown) => {
      const artifact: any = structuredClone(composeExperimentArtifact(composeInput()).artifact);
      artifact.crawlSnapshot.curated = value;
      return artifact;
    };
    const pin = (name: string, digit: string) => ({ repository: `TheAlgorithms/${name}`, commit: digit.repeat(40) });
    expect(parseArtifactDecks(withPins({ pins: [pin("Go", "1"), pin("Python", "2")] }))).toHaveLength(3);
    for (const curated of [
      { pins: [] },
      { pins: [pin("Python", "2"), pin("Go", "1")] },
      { pins: [pin("Go", "1"), pin("Go", "1")] },
      { pins: [{ ...pin("Go", "1"), branch: "main" }] },
      { pins: [pin("Go", "1")], extra: [] },
      { pins: [{ repository: "not a repository", commit: "1".repeat(40) }] },
    ]) {
      expect(() => parseArtifactDecks(withPins(curated))).toThrow(ExperimentRecordError);
    }
  });
});
