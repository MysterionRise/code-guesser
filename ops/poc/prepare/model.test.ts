import { composeExperimentArtifact } from "./compose";
import { BEFORE_AFTER_CANDIDATE_IDS, ExperimentRecordError, artifactFixtures, parseExperimentArtifact } from "./model";
import { composeInput, sha1, sha256 } from "./testdata/v3-builders";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const artifact = (): any => structuredClone(composeExperimentArtifact(composeInput()).artifact);
const rejects = (value: unknown): void => {
  expect(() => parseExperimentArtifact(value)).toThrow(ExperimentRecordError);
};
const fixtureOf = (value: any, deck: number, round = 0): any => value.decks[deck].fixtures[round];
const mutations = (cases: readonly ((value: any) => void)[]): void => {
  for (const mutate of cases) {
    const changed = artifact();
    mutate(changed);
    rejects(changed);
  }
};

describe("local experiment artifact v3", () => {
  it("parses three pools of ten with the exact kinds and thirty unique rounds", () => {
    const parsed = parseExperimentArtifact(artifact());
    expect(parsed.decks.map(({ id, fixtures }) => `${id}:${new Set(fixtures.map(({ kind }) => kind)).size}:${fixtures.length}`))
      .toEqual(["project:1:10", "language:1:10", "before-after:1:10"]);
    expect(new Set(artifactFixtures(parsed).map(({ roundId }) => roundId)).size).toBe(30);
    expect(Object.isFrozen(parsed.decks[0]!.fixtures[0]!.source)).toBe(true);
  });

  it("rejects an older schema, wrong deck order, a short or oversized pool, and unknown fields", () => {
    mutations([
      (value) => { value.schemaVersion = "local-experiment-artifact.v2"; },
      (value) => { value.decks.reverse(); },
      (value) => { value.decks[0].fixtures = value.decks[0].fixtures.slice(0, 4); },
      (value) => { value.decks[0].roundsPerSession = 4; },
      (value) => { value.decks[1].notice = null; },
      (value) => { fixtureOf(value, 0).source.approvalStatus = "APPROVED"; },
      (value) => { fixtureOf(value, 1).excerpt = "print(1)"; },
    ]);
  });

  it("requires one pane for project and language rounds and two labelled panes for before-or-after rounds", () => {
    mutations([
      (value) => { fixtureOf(value, 0).panes.push({ label: "B", text: "x" }); },
      (value) => { fixtureOf(value, 1).panes[0].label = "A"; },
      (value) => { fixtureOf(value, 2).panes.reverse(); },
      (value) => { fixtureOf(value, 2).panes.pop(); },
      (value) => { fixtureOf(value, 1).panes[0].text = `${fixtureOf(value, 1).panes[0].text}\n// changed`; },
    ]);
  });

  it("binds each kind's options and answer to its source", () => {
    mutations([
      (value) => { fixtureOf(value, 0).candidates.pop(); },
      (value) => { fixtureOf(value, 0).correctCandidateId = fixtureOf(value, 0).candidates.find(({ id }: any) => id !== fixtureOf(value, 0).correctCandidateId).id; },
      (value) => { fixtureOf(value, 1).candidates[0] = { id: "local-experiment.language.java.v3", label: "Java", detail: null }; },
      (value) => { fixtureOf(value, 1).candidates[0].detail = "A note"; },
      (value) => { fixtureOf(value, 2).candidates.reverse(); },
      (value) => {
        const fixture = fixtureOf(value, 2);
        fixture.correctCandidateId = fixture.correctCandidateId === BEFORE_AFTER_CANDIDATE_IDS[0] ? BEFORE_AFTER_CANDIDATE_IDS[1] : BEFORE_AFTER_CANDIDATE_IDS[0];
      },
      (value) => { fixtureOf(value, 2).source.queryId = "unknown-query"; },
      (value) => { fixtureOf(value, 2).source.linesRemoved = 0; fixtureOf(value, 2).source.linesAdded = 0; },
    ]);
  });

  it("keeps the later before-or-after pane split evenly across the pool", () => {
    const lopsided = artifact();
    for (const fixture of lopsided.decks[2].fixtures) {
      if (fixture.correctCandidateId === BEFORE_AFTER_CANDIDATE_IDS[1]) {
        fixture.panes = [{ label: "A", text: fixture.panes[1].text }, { label: "B", text: fixture.panes[0].text }];
        fixture.correctCandidateId = BEFORE_AFTER_CANDIDATE_IDS[0];
      }
    }
    rejects(lopsided);
  });

  it("deduplicates within each deck and across decks by commit, blob, raw content, and excerpt", () => {
    mutations([
      (value) => { fixtureOf(value, 0, 1).source.repository = fixtureOf(value, 0, 0).source.repository; },
      (value) => { fixtureOf(value, 2, 0).source.excerptHash = fixtureOf(value, 1, 0).source.excerptHash; },
    ]);
  });

  it("rejects source URLs that do not bind the exact repository, commit, and path", () => {
    for (const key of ["repositoryUrl", "commitUrl", "blobUrl", "licenseFileUrl", "authorSourceUrl"]) {
      const changed = artifact();
      fixtureOf(changed, 0).source[key] = "https://github.com/other/repo";
      rejects(changed);
    }
  });

  it("requires the crawl snapshot's shape and binds Stack sources to its revision", () => {
    mutations([
      (value) => { value.crawlSnapshot.github.queries[0].role = "ordinary"; },
      (value) => { value.crawlSnapshot.stack.configurations = ["Python", "TypeScript"]; },
      (value) => { value.crawlSnapshot.stack.revision = sha1("other-revision"); },
      (value) => { fixtureOf(value, 1).source.crawlSnapshotId = sha256("other-snapshot"); },
      (value) => { value.crawlSnapshot.acceptedResponseHashes = []; },
    ]);
  });

  it("rejects malformed Stack identities, dates, counts, and paths", () => {
    mutations([
      (value) => { fixtureOf(value, 1).source.swhBlobId = "short"; },
      (value) => { fixtureOf(value, 1).source.visitDate = "2026-01-03"; },
      (value) => { fixtureOf(value, 1).source.starEventsCount = -1; },
      (value) => { fixtureOf(value, 1).source.stackPath = "/abs/path.py"; },
      (value) => { fixtureOf(value, 1).source.configuration = "Java"; },
      (value) => { fixtureOf(value, 0).source.blob = sha1("other"); },
    ]);
  });

  it("rejects an authorship claim anywhere a player reads", () => {
    mutations([
      (value) => { fixtureOf(value, 2).explanation = "The later version is AI-generated."; },
      (value) => { fixtureOf(value, 0).candidates[0].detail = "A human-written toolkit."; },
    ]);
  });
});
