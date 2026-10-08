/**
 * Builds one schema-valid in-memory local-experiment artifact for tests, together
 * with the canonical hash the server-only authority expects as its trusted input.
 */
import { createHash } from "node:crypto";

export const canonical = (value: unknown): string => {
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
};
export const hashValue = (value: unknown): string =>
  createHash("sha256").update(canonical(value)).digest("hex");
export const sha = (value: string): string => createHash("sha256").update(value).digest("hex");
export const git = (digit: string): string => digit.repeat(40);
export const hash = (digit: string): string => digit.repeat(64);

export const artifact = () => {
  const profileHash = hash("a");
  const acceptedResponseHashes = [hash("b"), hash("c"), hash("d")];
  const crawlSnapshotId = hashValue({ profileHash, acceptedResponseHashes });
  const fixtures = Array.from({ length: 5 }, (_, index) => {
    const kind = index < 3 ? "PROVENANCE" : "LANGUAGE";
    const repository = `example/project-${index}`;
    const repositoryUrl = `https://github.com/${repository}`;
    const commit = git(String(index + 1));
    const extension = index === 3 ? "py" : "ts";
    const path = `src/round-${index}.${extension}`;
    const excerpt = index === 3
      ? `def value_${index}():\n    return ${index}`
      : `const value${index}: number = ${index};`;
    const candidates = kind === "PROVENANCE"
      ? [
        { id: "local-experiment.marker-recorded.v1", label: "Configured marker recorded" },
        { id: "local-experiment.marker-not-recorded.v1", label: "Configured marker not recorded in this commit" },
      ]
      : [
        { id: "local-experiment.language.python.v1", label: "Python" },
        { id: "local-experiment.language.typescript.v1", label: "TypeScript" },
      ];
    const base = {
      repository,
      repositoryUrl,
      authorName: `Developer ${index}`,
      authorLogin: `developer-${index}`,
      authorBasis: "SELECTED_COMMIT",
      authorSourceUrl: `${repositoryUrl}/commit/${commit}`,
      path,
      blob: git((index + 6).toString(16)),
      rawContentHash: sha(`raw-${index}`),
      excerptHash: sha(excerpt),
      licenseName: "MIT License",
      licenseSpdx: "MIT",
      licenseFileUrl: `${repositoryUrl}/blob/${commit}/LICENSE`,
      commit,
      commitUrl: `${repositoryUrl}/commit/${commit}`,
      blobUrl: `${repositoryUrl}/blob/${commit}/${path}`,
      profileVersion: "local-real-rounds.v1",
      crawlSnapshotId,
    };
    const source = kind === "PROVENANCE"
      ? {
        discoverySource: "GITHUB_COMMIT_SEARCH",
        ...base,
        queryId: "configured-marker-query",
        childCommit: commit,
        childTree: git("a"),
        parentCommit: git("b"),
        parentTree: git("c"),
        parentPath: path,
        childPath: path,
        parentMode: "100644",
        childMode: "100644",
        parentBlob: git("d"),
        childBlob: base.blob,
        parentRawContentHash: sha(`parent-${index}`),
        childRawContentHash: base.rawContentHash,
        changedLineHash: sha(`changed-${index}`),
        markerMatched: index !== 1,
      }
      : {
        discoverySource: "STACK_V2",
        ...base,
        stackRelease: "v2.2.0",
        stackRevision: "e565caa3a78c2423bd374333a472b049eb090e47",
        configuration: index === 3 ? "Python" : "TypeScript",
        stableRowId: sha(`row-${index}`),
        swhBlobId: git("e"),
        swhContentId: base.blob,
        swhDirectoryId: git("f"),
        swhSnapshotId: git("0"),
        swhRevisionId: commit,
        stackRepository: repository,
        stackPath: path,
        detectedLicenses: ["MIT"],
        detectedLanguage: index === 3 ? "Python" : "TypeScript",
        generated: false,
        vendor: false,
        sourceEncoding: "UTF-8",
        byteLength: 128,
        visitDate: "2026-01-03T00:00:00Z",
        revisionDate: "2026-01-02T00:00:00Z",
        committerDate: "2026-01-01T00:00:00Z",
      };
    const correctCandidateId = kind === "PROVENANCE"
      ? candidates[index === 1 ? 1 : 0]!.id
      : candidates[index === 3 ? 0 : 1]!.id;
    return {
      kind,
      roundId: `local-round-${index}`,
      roundVersion: sha(`round-version-${index}`),
      excerpt,
      prompt: kind === "PROVENANCE"
        ? "Does this commit record contain a configured marker?"
        : "Which language is this?",
      candidates,
      clues: kind === "PROVENANCE"
        ? [
          "Inspect the pinned commit record for exact configured marker text.",
          "Treat code style as unrelated to this record-only question.",
        ]
        : [`Clue ${index}.1`, `Clue ${index}.2`],
      correctCandidateId,
      evidence: `Recorded evidence ${index}`,
      explanation: `Recorded explanation ${index}`,
      attribution: `Developer ${index} · ${repository} · MIT License (MIT) · ${repositoryUrl}/blob/${commit}/${path}`,
      helpfulSignals: [`Helpful ${index}`],
      misleadingSignals: [`Misleading ${index}`],
      source,
    };
  });
  return {
    schemaVersion: "local-experiment-artifact.v1",
    contentClass: "LOCAL_UNREVIEWED_EXPERIMENT",
    profileHash,
    crawlSnapshot: {
      id: crawlSnapshotId,
      profileVersion: "local-real-rounds.v1",
      profileHash,
      github: {
        apiVersion: "2022-11-28",
        queries: [{
          id: "configured-marker-query",
          query: "configured marker query",
          sort: "committer-date",
          order: "desc",
          pages: 2,
          resultCeiling: 50,
        }],
      },
      stack: {
        release: "v2.2.0",
        revision: "e565caa3a78c2423bd374333a472b049eb090e47",
        configurations: ["Python", "TypeScript"],
      },
      acceptedResponseHashes,
    },
    fixtures,
  };
};
