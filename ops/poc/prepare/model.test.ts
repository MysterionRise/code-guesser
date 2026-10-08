import { composeExperimentArtifact } from "./compose";
import {
  ExperimentRecordError,
  artifactFixtures,
  parseExperimentArtifact,
  parsePrivateReveal,
  parsePublicRound,
  parseRoundRecordSet,
} from "./model";
import { composeInput, sha1, sha256 } from "./testdata/v2-builders";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const composed = () => composeExperimentArtifact(composeInput());
const artifact = (): any => structuredClone(composed().artifact);
const rejects = (value: unknown): void => {
  expect(() => parseExperimentArtifact(value)).toThrow(ExperimentRecordError);
};
const fixtureOf = (value: any, deck: number, round = 0): any => value.decks[deck].fixtures[round];

describe("local experiment artifact v2", () => {
  it("parses three decks of five with the exact kinds and fifteen unique rounds", () => {
    const parsed = parseExperimentArtifact(artifact());
    expect(parsed.decks.map(({ id, fixtures }) => `${id}:${fixtures.map(({ kind }) => kind).join(",")}`)).toEqual([
      "project:PROJECT,PROJECT,PROJECT,PROJECT,PROJECT",
      "language:LANGUAGE,LANGUAGE,LANGUAGE,LANGUAGE,LANGUAGE",
      "ai:AI_CREDIT,AI_CREDIT,AI_CREDIT,AI_CREDIT,AI_CREDIT",
    ]);
    expect(new Set(artifactFixtures(parsed).map(({ roundId }) => roundId)).size).toBe(15);
    expect(Object.isFrozen(parsed.decks[0]!.fixtures[0]!.source)).toBe(true);
  });

  it("rejects the revision 11 schema, wrong deck order, missing notice, and unknown fields", () => {
    for (const mutate of [
      (value: any) => { value.schemaVersion = "local-experiment-artifact.v1"; },
      (value: any) => { value.decks.reverse(); },
      (value: any) => { value.decks[2].notice = null; },
      (value: any) => { value.decks[0].notice = "extra"; },
      (value: any) => { value.decks[1].extra = true; },
      (value: any) => { fixtureOf(value, 0).source.approvalStatus = "APPROVED"; },
      (value: any) => { fixtureOf(value, 1).reviewDecision = "ACCEPTED"; },
      (value: any) => { value.decks[0].fixtures.pop(); },
    ]) {
      const changed = artifact();
      mutate(changed);
      rejects(changed);
    }
  });

  it("requires four candidates for project and language rounds and the two v2 AI candidates", () => {
    for (const mutate of [
      (value: any) => { fixtureOf(value, 0).candidates.pop(); },
      (value: any) => { fixtureOf(value, 1).candidates.push({ id: "x", label: "Cobol" }); },
      (value: any) => { fixtureOf(value, 2).candidates.reverse(); },
      (value: any) => { fixtureOf(value, 2).candidates[1].id = "local-experiment.marker-not-recorded.v1"; },
      (value: any) => { fixtureOf(value, 0).correctCandidateId = "not-a-candidate"; },
      (value: any) => { fixtureOf(value, 1).clues.pop(); },
    ]) {
      const changed = artifact();
      mutate(changed);
      rejects(changed);
    }
  });

  it("binds AI outcomes to query roles and keeps at least two of each outcome", () => {
    for (const mutate of [
      (value: any) => {
        const credited = value.decks[2].fixtures.find((fixture: any) => fixture.source.aiCreditRecorded);
        credited.source.queryId = "ordinary-github";
      },
      (value: any) => {
        const absent = value.decks[2].fixtures.find((fixture: any) => !fixture.source.aiCreditRecorded);
        absent.source.aiAssistant = "Claude";
      },
      (value: any) => {
        for (const fixture of value.decks[2].fixtures) { fixture.source.aiCreditRecorded = true; fixture.source.aiAssistant = "Claude"; fixture.source.queryId = "ai-claude-github"; }
      },
      (value: any) => { fixtureOf(value, 0).source.queryId = "ai-copilot-github"; },
      (value: any) => { fixtureOf(value, 0).source.queryId = "unknown-query"; },
      (value: any) => { fixtureOf(value, 2).source.changedFileCount = 0; },
    ]) {
      const changed = artifact();
      mutate(changed);
      rejects(changed);
    }
  });

  it("deduplicates within each deck and across decks by commit, blob, raw content, and excerpt", () => {
    const sameRepository = artifact();
    fixtureOf(sameRepository, 0, 1).source.repository = fixtureOf(sameRepository, 0, 0).source.repository;
    rejects(sameRepository);
    const crossCommit = artifact();
    fixtureOf(crossCommit, 2, 0).source.excerptHash = fixtureOf(crossCommit, 0, 0).source.excerptHash;
    rejects(crossCommit);
    const duplicateLanguage = artifact();
    fixtureOf(duplicateLanguage, 1, 1).source.configuration = fixtureOf(duplicateLanguage, 1, 0).source.configuration;
    fixtureOf(duplicateLanguage, 1, 1).source.detectedLanguage = fixtureOf(duplicateLanguage, 1, 0).source.configuration;
    rejects(duplicateLanguage);
  });

  it("rejects source URLs that do not bind the exact repository, commit, and path", () => {
    for (const key of ["repositoryUrl", "commitUrl", "blobUrl", "licenseFileUrl", "authorSourceUrl"]) {
      const changed = artifact();
      fixtureOf(changed, 0).source[key] = "https://github.com/other/repo";
      rejects(changed);
    }
  });

  it("requires the exact crawl snapshot shape with query roles and the five Stack languages", () => {
    for (const mutate of [
      (value: any) => { delete value.crawlSnapshot.github.queries[0].role; },
      (value: any) => { value.crawlSnapshot.github.queries[0].role = "other"; },
      (value: any) => { value.crawlSnapshot.stack.configurations = ["Python", "TypeScript"]; },
      (value: any) => { fixtureOf(value, 1).source.crawlSnapshotId = sha256("other-snapshot"); },
      (value: any) => { value.crawlSnapshot.acceptedResponseHashes = []; },
    ]) {
      const changed = artifact();
      mutate(changed);
      rejects(changed);
    }
  });

  it("rejects malformed Stack identities, dates, encoding, and paths", () => {
    for (const mutate of [
      (value: any) => { fixtureOf(value, 1).source.swhBlobId = "short"; },
      (value: any) => { fixtureOf(value, 1).source.visitDate = "2026-01-03"; },
      (value: any) => { fixtureOf(value, 1).source.sourceEncoding = "latin-1"; },
      (value: any) => { fixtureOf(value, 1).source.stackPath = "/abs/path.py"; },
      (value: any) => { fixtureOf(value, 1).source.configuration = "Java"; },
      (value: any) => { fixtureOf(value, 1).source.blob = sha1("other"); },
    ]) {
      const changed = artifact();
      mutate(changed);
      rejects(changed);
    }
  });
});

describe("round records v2", () => {
  it("binds fifteen public rounds in deck order to the same keyed private reveals", () => {
    const { roundRecordSet } = composed();
    const reparsed = parseRoundRecordSet(structuredClone(roundRecordSet));
    expect(reparsed.publicRounds).toHaveLength(15);
    expect(Object.keys(reparsed.privateReveals).sort()).toEqual(reparsed.publicRounds.map(({ roundId }) => roundId).sort());
  });

  it("rejects missing, extra, reordered, or inconsistently bound round records", () => {
    const { roundRecordSet } = composed();
    for (const mutate of [
      (value: any) => { value.publicRounds.pop(); },
      (value: any) => { value.publicRounds.reverse(); },
      (value: any) => { const first = Object.keys(value.privateReveals)[0]!; delete value.privateReveals[first]; },
      (value: any) => { value.publicRounds[0].roundVersionId = "drifted"; },
      (value: any) => { value.publicRounds[10].mode.candidates.push({ candidateId: "x", label: "Maybe" }); },
    ]) {
      const changed = structuredClone(roundRecordSet) as any;
      mutate(changed);
      expect(() => parseRoundRecordSet(changed)).toThrow(ExperimentRecordError);
    }
  });

  it("parses exact public rounds and private reveals and rejects protected fields in public rounds", () => {
    const { roundRecordSet } = composed();
    const publicRound = structuredClone(roundRecordSet.publicRounds[0]) as any;
    expect(parsePublicRound(publicRound).mode.kind).toBe("project");
    expect(() => parsePublicRound({ ...publicRound, correctCandidateId: "x" })).toThrow(ExperimentRecordError);
    expect(() => parsePublicRound({ ...publicRound, mode: { ...publicRound.mode, kind: "provenance" } })).toThrow(ExperimentRecordError);
    const reveal = structuredClone(Object.values(roundRecordSet.privateReveals)[0]) as any;
    expect(parsePrivateReveal(reveal).roundId).toBe(reveal.roundId);
    expect(() => parsePrivateReveal({ ...reveal, evidence: "" })).toThrow(ExperimentRecordError);
  });
});
