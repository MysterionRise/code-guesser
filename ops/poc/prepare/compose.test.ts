import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { canonicalBytes, canonicalHash } from "./canonical";
import { parseExperimentArtifact, parseRoundRecordSet } from "./model";
import { parseCrawlProfile } from "./profile";

const testModuleName: string = "vitest";
const { expect, it } = await import(testModuleName) as any;
const modulePath: string = "./compose";
const composeModule = await import(modulePath).catch(() => ({})) as Record<string, any>;
const composeExperimentArtifact = typeof composeModule.composeExperimentArtifact === "function"
  ? composeModule.composeExperimentArtifact
  : (): never => { throw new Error("COMPOSE_NOT_IMPLEMENTED"); };

const digest = (digit: string, length = 64): string => digit.repeat(length);
const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const excerpt = (index: number): string => `const value${index} = ${index};`;
const profile = async () => parseCrawlProfile(JSON.parse(
  await readFile(new URL("../profiles/local-real-rounds.v1.json", import.meta.url), "utf8"),
));
const responseHashes = Object.freeze([digest("a"), digest("b"), digest("c")]);

const commonSource = (index: number, snapshotId: string) => {
  const digit = (index + 1).toString(16);
  const repository = `example/project-${index}`;
  const commit = digest(digit, 40);
  const path = `src/example-${index}.${index < 4 ? "ts" : "py"}`;
  const root = `https://github.com/${repository}`;
  return {
    repository, repositoryUrl: root, authorName: `Developer ${index}`, authorLogin: `dev-${index}`,
    authorBasis: "SELECTED_COMMIT", authorSourceUrl: `${root}/commit/${commit}`, path,
    blob: commit, rawContentHash: sha256(`raw-${index}`), excerptHash: sha256(excerpt(index)),
    licenseName: "MIT License", licenseSpdx: "MIT", licenseFileUrl: `${root}/blob/${commit}/LICENSE`,
    commit, commitUrl: `${root}/commit/${commit}`, blobUrl: `${root}/blob/${commit}/${path}`,
    profileVersion: "local-real-rounds.v1", crawlSnapshotId: snapshotId,
  };
};

const source = (index: number, snapshotId: string) => {
  const base = commonSource(index, snapshotId);
  if (index < 3) return {
    discoverySource: "GITHUB_COMMIT_SEARCH", ...base, queryId: "copilot-trailer",
    childCommit: base.commit, childTree: digest("d", 40), parentCommit: digest("e", 40),
    parentTree: digest("f", 40), parentPath: base.path, childPath: base.path,
    parentMode: "100644", childMode: "100644", parentBlob: digest("a", 40),
    childBlob: base.blob, parentRawContentHash: digest("a"), childRawContentHash: base.rawContentHash,
    changedLineHash: sha256(`changed-${index}`), markerMatched: index === 0,
  };
  const language = index === 3 ? "Python" : "TypeScript";
  const path = `src/example-${index}.${language === "Python" ? "py" : "ts"}`;
  const root = base.repositoryUrl;
  return {
    discoverySource: "STACK_V2", ...base, path, blobUrl: `${root}/blob/${base.commit}/${path}`,
    stackRelease: "v2.2.0", stackRevision: "e565caa3a78c2423bd374333a472b049eb090e47",
    configuration: language, stableRowId: digest(index === 3 ? "3" : "4"),
    swhBlobId: digest("7", 40), swhContentId: base.blob, swhDirectoryId: digest("8", 40),
    swhSnapshotId: digest("9", 40), swhRevisionId: base.commit, stackRepository: base.repository,
    stackPath: path, detectedLicenses: ["MIT"], detectedLanguage: language,
    generated: false, vendor: false, sourceEncoding: "UTF-8", byteLength: 128,
    visitDate: "2026-01-03T00:00:00Z", revisionDate: "2026-01-02T00:00:00Z",
    committerDate: "2026-01-01T00:00:00Z",
  };
};

const fixture = (index: number, snapshotId: string) => {
  const kind = index < 3 ? "PROVENANCE" : "LANGUAGE";
  const roundId = `local-round-${index}`;
  const candidates = kind === "PROVENANCE"
    ? [{ id: "marker-recorded", label: "Marker recorded" }, { id: "marker-missing", label: "Marker not recorded" }]
    : [{ id: "python", label: "Python" }, { id: "typescript", label: "TypeScript" }];
  return {
    kind, roundId, roundVersion: sha256(`version-${index}`),
    excerpt: excerpt(index), prompt: `Question ${index}?`, candidates,
    clues: [`Clue ${index}.1`, `Clue ${index}.2`], correctCandidateId: candidates[index === 4 ? 1 : 0]!.id,
    evidence: `Evidence ${index}`, explanation: `Explanation ${index}`,
    attribution: `Attribution ${index}`, helpfulSignals: [`Helpful ${index}`],
    misleadingSignals: [`Misleading ${index}`], source: source(index, snapshotId),
  };
};

const projections = (item: ReturnType<typeof fixture>) => {
  const candidates = item.candidates.map(({ id, label }) => ({ candidateId: id, label }));
  const clues = item.clues.map((label, index) => ({ order: index + 1, label }));
  const versions = { candidateSet: `candidates-${item.roundId}`, clueSet: `clues-${item.roundId}`,
    scoring: "scoring-v1", rules: `rules-${item.roundId}` };
  const publicRound = {
    roundId: item.roundId, roundVersionId: item.roundVersion,
    excerpt: { versionId: item.source.excerptHash, text: item.excerpt },
    mode: { kind: item.kind === "PROVENANCE" ? "provenance" : "language",
      contractVersionId: `contract-${item.roundId}`, calibrationVersionId: "calibration-v1",
      prompt: item.prompt, candidates, clues }, versions,
  };
  const privateReveal = {
    roundId: item.roundId, roundVersionId: item.roundVersion,
    correctCandidateId: item.correctCandidateId, evidence: item.evidence,
    explanation: item.explanation, attribution: item.attribution,
    helpfulSignals: item.helpfulSignals, misleadingSignals: item.misleadingSignals,
    versions: { content: item.source.excerptHash, candidateSet: versions.candidateSet,
      scoring: versions.scoring, rules: versions.rules, evidence: `evidence-${item.roundId}`,
      reveal: `reveal-${item.roundId}` },
  };
  return { publicRound, privateReveal };
};

const input = async () => {
  const parsedProfile = await profile();
  const profileBytes = canonicalBytes(parsedProfile);
  const profileHash = canonicalHash(parsedProfile);
  const crawlSnapshotId = canonicalHash({ profileHash, acceptedResponseHashes: responseHashes });
  const fixtures = Array.from({ length: 5 }, (_, index) => fixture(index, crawlSnapshotId));
  const generated = fixtures.map(projections);
  const group = (start: number, end: number) => ({
    fixtures: fixtures.slice(start, end),
    publicRounds: generated.slice(start, end).map(({ publicRound }) => publicRound),
    privateReveals: Object.fromEntries(generated.slice(start, end)
      .map(({ privateReveal }) => [privateReveal.roundId, privateReveal])),
  });
  return { profile: parsedProfile, canonicalProfileBytes: profileBytes, acceptedResponseHashes: responseHashes,
    provenance: group(0, 3), language: group(3, 5) };
};

const duplicateAcrossSources = (options: any, key: string): void => {
  const from = options.provenance.fixtures[0].source;
  const fixtureValue = options.language.fixtures[0];
  const target = fixtureValue.source;
  target[key] = from[key];
  if (key === "repository") {
    target.stackRepository = from.repository;
    target.repositoryUrl = `https://github.com/${from.repository}`;
    target.authorSourceUrl = `${target.repositoryUrl}/commit/${target.commit}`;
    target.commitUrl = target.authorSourceUrl;
  }
  if (key === "commit") {
    target.swhRevisionId = from.commit;
    target.authorSourceUrl = `${target.repositoryUrl}/commit/${from.commit}`;
    target.commitUrl = target.authorSourceUrl;
  }
  if (key === "path") target.stackPath = from.path;
  if (key === "blob") target.swhContentId = from.blob;
  target.licenseFileUrl = `${target.repositoryUrl}/blob/${target.commit}/LICENSE`;
  target.blobUrl = `${target.repositoryUrl}/blob/${target.commit}/${target.path}`;
  if (key === "excerptHash") {
    fixtureValue.excerpt = options.provenance.fixtures[0].excerpt;
    options.language.publicRounds[0].excerpt.text = fixtureValue.excerpt;
    options.language.publicRounds[0].excerpt.versionId = from.excerptHash;
    options.language.privateReveals[fixtureValue.roundId].versions.content = from.excerptHash;
  }
};

  it("composes one validated three/two artifact and spoiler-free record set", async () => {
    const options = await input();
    const output = composeExperimentArtifact(options);
    const artifact = parseExperimentArtifact(output.artifact);
    const rounds = parseRoundRecordSet(output.roundRecordSet);

    expect(artifact.fixtures.map(({ kind }) => kind)).toEqual([
      "PROVENANCE", "PROVENANCE", "PROVENANCE", "LANGUAGE", "LANGUAGE",
    ]);
    expect(artifact.fixtures.map(({ roundId }) => roundId)).toEqual([
      ...options.provenance.fixtures, ...options.language.fixtures,
    ].map(({ roundId }) => roundId));
    expect(artifact.fixtures.every(({ source }) =>
      source.crawlSnapshotId === artifact.crawlSnapshot.id
      && source.profileVersion === artifact.crawlSnapshot.profileVersion)).toBe(true);
    expect(rounds.publicRounds.map(({ roundId }) => roundId).sort()).toEqual(
      Object.keys(rounds.privateReveals).sort(),
    );
    const publicText = JSON.stringify(rounds.publicRounds);
    expect(publicText).not.toContain('"correctCandidateId"');
    expect(publicText).not.toContain('"source"');
    expect(publicText).not.toContain('"explanation"');
    for (const item of artifact.fixtures) {
      for (const protectedValue of [
        item.evidence, item.explanation, item.attribution, item.source.repository,
        item.source.repositoryUrl, item.source.authorName, item.source.authorLogin,
        item.source.licenseName, item.source.licenseSpdx, item.source.commit, item.source.blob,
        item.source.authorSourceUrl, item.source.licenseFileUrl, item.source.commitUrl,
        item.source.blobUrl, item.source.path,
      ]) {
        if (protectedValue !== null) expect(publicText).not.toContain(protectedValue);
      }
      expect(publicText).toContain(item.correctCandidateId);
    }
  });

  it("replays byte-identically and binds bytes, responses, snapshot, and hash", async () => {
    const options = await input();
    const first = composeExperimentArtifact(options);
    const second = composeExperimentArtifact(structuredClone(options));

    expect(first.artifactBytes).toEqual(second.artifactBytes);
    expect(first.artifactHash).toBe(canonicalHash(first.artifact));
    expect(first.artifact.crawlSnapshot.id).toBe(options.provenance.fixtures[0]!.source.crawlSnapshotId);
    const changed = {
      ...structuredClone(options),
      acceptedResponseHashes: [...options.acceptedResponseHashes],
    };
    changed.acceptedResponseHashes[0] = digest("d");
    expect(() => composeExperimentArtifact(changed)).toThrow(composeModule.ComposeError);
    const nonCanonical = structuredClone(options);
    nonCanonical.canonicalProfileBytes = new TextEncoder().encode("{\"not\":\"the profile\"}");
    expect(() => composeExperimentArtifact(nonCanonical)).toThrow(composeModule.ComposeError);
  });

  it("rejects every independent cross-source duplicate and mixed bindings", async () => {
    const options = await input();
    const short = structuredClone(options);
    const removed = short.language.fixtures.pop()!;
    short.language.publicRounds.pop();
    delete short.language.privateReveals[removed.roundId];
    expect(() => composeExperimentArtifact(short)).toThrow(composeModule.ComposeError);
    const duplicateResponse = {
      ...structuredClone(options),
      acceptedResponseHashes: [responseHashes[0], responseHashes[0]],
    };
    expect(() => composeExperimentArtifact(duplicateResponse)).toThrow(composeModule.ComposeError);
    for (const key of options.profile.deduplication) {
      const duplicate = structuredClone(options);
      duplicateAcrossSources(duplicate, key);
      expect(() => composeExperimentArtifact(duplicate)).toThrow(composeModule.ComposeError);
    }
    const mixedSnapshot = structuredClone(options);
    mixedSnapshot.language.fixtures[1]!.source.crawlSnapshotId = digest("e");
    expect(() => composeExperimentArtifact(mixedSnapshot)).toThrow(composeModule.ComposeError);
    const mixedProfile = structuredClone(options);
    mixedProfile.provenance.fixtures[1]!.source.profileVersion = "other-profile";
    expect(() => composeExperimentArtifact(mixedProfile)).toThrow(composeModule.ComposeError);
  });

  it("rejects projection drift and keeps all accepted output recursively immutable", async () => {
    const options = await input();
    const drifted = structuredClone(options);
    drifted.language.publicRounds[0]!.excerpt.text = "different public source";
    expect(() => composeExperimentArtifact(drifted)).toThrow(composeModule.ComposeError);
    const hashDrifted = structuredClone(options);
    hashDrifted.language.fixtures[0]!.excerpt = "const replacement = 99;";
    hashDrifted.language.publicRounds[0]!.excerpt.text = "const replacement = 99;";
    expect(() => composeExperimentArtifact(hashDrifted)).toThrow(composeModule.ComposeError);
    const leaked = structuredClone(options);
    leaked.provenance.publicRounds[0]!.mode.prompt = leaked.provenance.fixtures[0]!.source.repository;
    leaked.provenance.fixtures[0]!.prompt = leaked.provenance.fixtures[0]!.source.repository;
    expect(() => composeExperimentArtifact(leaked)).toThrow(composeModule.ComposeError);
    let caught: any;
    try { composeExperimentArtifact(leaked); } catch (error) { caught = error; }
    expect(caught.code).toBe("PUBLIC_CONTAINMENT_REPOSITORY_IN_MODE");
    expect(JSON.stringify(caught)).not.toContain(leaked.provenance.fixtures[0]!.source.repository);
    const licenceInExcerpt = structuredClone(options);
    const target = licenceInExcerpt.language.fixtures[0]!;
    target.excerpt = `# ${target.source.licenseSpdx as string}\n${target.excerpt}`;
    target.source.excerptHash = sha256(target.excerpt);
    licenceInExcerpt.language.publicRounds[0]!.excerpt = { versionId: target.source.excerptHash, text: target.excerpt };
    caught = undefined;
    try { composeExperimentArtifact(licenceInExcerpt); } catch (error) { caught = error; }
    expect(caught?.code).toBe("PUBLIC_CONTAINMENT_LICENSESPDX_IN_EXCERPT");

    // A file short enough to be excerpted whole has excerptHash === rawContentHash; the public
    // excerpt version id then equals a hash of public text, which exposes nothing further.
    const wholeFile = structuredClone(options);
    const whole = wholeFile.language.fixtures[1]!;
    whole.source.rawContentHash = whole.source.excerptHash;
    expect(() => composeExperimentArtifact(wholeFile)).not.toThrow();

    const output = composeExperimentArtifact(options);
    expect(Object.isFrozen(output)).toBe(true);
    expect(Object.isFrozen(output.artifact.fixtures[0]!.source)).toBe(true);
    expect(Object.isFrozen(output.roundRecordSet.privateReveals)).toBe(true);
  });
