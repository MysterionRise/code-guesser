import { describe, expect, it } from "vitest";

import {
  ProvenanceRegimeRuleError,
  createProvenanceRegime,
  type ProvenanceCandidateInput,
  type SourceRegimeSnapshotInput,
} from "../src/index.js";
import {
  SourceRegimeControl,
  type RightsDeterminationInput,
} from "../../content/src/rights/source-regime.js";

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
};

const determination = () => ({
  determinationId: "determination-1",
  writtenText: "Reveal attribution satisfies the covered license for this design.",
  reviewerId: "reviewer-1",
  reviewerName: "Alex Reviewer",
  scope: "Delayed-attribution code guessing interaction",
  contributionRevisionDateTreatment: "Use the covered revision and contribution date.",
  consideredLicenseVersions: ["CC BY-SA 4.0"],
  attributionFormat: "Author, post, revision, and license at reveal.",
  shareAlikeTreatment: "Covered reveal material retains its notice.",
  effectiveDate: "2026-08-01",
  presentationDesignVersion: "presentation-2",
  interactionDesignVersion: "interaction-3",
  attributionAtRevealSatisfiesLicense: true,
  firstDisplayAttributionRequired: false,
  coveredItems: [{
    postId: "post-17",
    revisionId: "revision-4",
    licenseName: "CC BY-SA",
    licenseVersion: "4.0",
  }],
  approval: {
    role: "Don",
    signerId: "don-1",
    signedAt: "2026-08-01T12:00:00.000Z",
    signature: "signed-determination-1",
  },
});

const snapshot = (
  selection: "project-owned-fallback" | "stack-overflow-enabled",
): SourceRegimeSnapshotInput => deepFreeze({
  versionId: `regime-${selection}`,
  selectedAt: "2026-08-02T00:00:00.000Z",
  selection,
  allowedSourceClasses: selection === "project-owned-fallback"
    ? ["project-owned-human", "model-output"]
    : ["model-output", "stack-overflow"],
  determination: selection === "project-owned-fallback" ? null : determination(),
} as SourceRegimeSnapshotInput);

const candidates = (
  selection: SourceRegimeSnapshotInput["selection"],
): ProvenanceCandidateInput[] => selection === "project-owned-fallback"
  ? [
      { id: "human", sourceClass: "project-owned-human", label: "Project-owned human sample" },
      { id: "model", sourceClass: "model-output", label: "Recorded model output" },
    ]
  : [
      { id: "model", sourceClass: "model-output", label: "Recorded model output" },
      { id: "publication", sourceClass: "stack-overflow", label: "Recorded Stack Overflow publication" },
    ];

const create = (sourceRegime: SourceRegimeSnapshotInput) =>
  createProvenanceRegime({ sourceRegime, candidates: candidates(sourceRegime.selection) });

describe("provenance source regime binding", () => {
  it("binds the fixed recorded-agent question and answer pair", () => {
    const sourceRegime = deepFreeze({
      versionId: "provenance-source-regime-v7",
      selectedAt: "2026-08-02T00:00:00.000Z",
      selection: "licensed-github-vs-project-controlled",
      prompt: "Is an AI coding agent durably recorded as participating in this code change?",
      candidateCount: 2,
      allowedSourceClasses: ["licensed-github", "project-owned-human"],
      inactiveSourceClasses: [
        "stack-overflow", "model-output", "synthetic", "missing-marker-github",
      ],
      determination: null,
    });
    const fixedCandidates = [
      {
        id: "RECORDED_AGENT_PARTICIPATION",
        sourceClass: "licensed-github",
        label: "RECORDED_AGENT_PARTICIPATION",
      },
      {
        id: "PROJECT_CONTROLLED_HUMAN_ONLY",
        sourceClass: "project-owned-human",
        label: "PROJECT_CONTROLLED_HUMAN_ONLY",
      },
    ];
    const regime = createProvenanceRegime({
      sourceRegime,
      candidates: fixedCandidates,
    });

    expect(regime.sourceRegime).toEqual(sourceRegime);
    expect(regime.candidates).toEqual(fixedCandidates);
  });

  it("rejects the former custom rights-gate shape", () => {
    expect(() => createProvenanceRegime({
      versionId: "weak-regime",
      kind: "stack-overflow-publication",
      candidates: [
        { id: "model", sourceClass: "model-output", label: "Recorded model output" },
        { id: "publication", sourceClass: "stack-overflow", label: "Recorded Stack Overflow publication" },
      ],
      rightsGate: deepFreeze({
        determinationId: "weak",
        writtenDetermination: "insufficient",
        affirmative: true,
        approval: { approvalId: "approval", signerId: "signer" },
      }),
    } as never)).toThrow(ProvenanceRegimeRuleError);
  });

  it.each(["project-owned-fallback", "stack-overflow-enabled"] as const)(
    "binds a complete accepted %s snapshot and exact honest labels",
    (selection) => {
      const regime = create(snapshot(selection));
      expect(regime.versionId).toBe(`regime-${selection}`);
      expect(regime.selection).toBe(selection);
      expect(regime.candidates.map(({ label }) => label)).toEqual(
        candidates(selection).map(({ label }) => label),
      );
      expect(regime.sourceRegime).toEqual(snapshot(selection));
    },
  );

  it.each(["project-owned-fallback", "stack-overflow-enabled"] as const)(
    "accepts the real upstream %s active snapshot",
    (selection) => {
      const active = SourceRegimeControl.select({
        versionId: `real-${selection}`,
        selectedAt: "2026-08-02T00:00:00.000Z",
        selection,
        ...(selection === "stack-overflow-enabled"
          ? { determination: determination() as RightsDeterminationInput }
          : {}),
      }).active;
      const regime = createProvenanceRegime({
        sourceRegime: active as SourceRegimeSnapshotInput,
        candidates: candidates(selection),
      });
      expect(regime.sourceRegime).toEqual(active);
    },
  );

  it("copies and deeply freezes the complete snapshot and candidates", () => {
    const sourceRegime = snapshot("stack-overflow-enabled");
    const candidateInput = candidates("stack-overflow-enabled");
    const regime = createProvenanceRegime({ sourceRegime, candidates: candidateInput });
    candidateInput[0]!.label = "changed";

    expect(regime.candidates[0]!.label).toBe("Recorded model output");
    expect(regime.sourceRegime).not.toBe(sourceRegime);
    for (const value of [
      regime,
      regime.candidates,
      regime.candidates[0],
      regime.sourceRegime,
      regime.sourceRegime.allowedSourceClasses,
      regime.sourceRegime.determination,
      regime.sourceRegime.determination?.consideredLicenseVersions,
      regime.sourceRegime.determination?.coveredItems,
      regime.sourceRegime.determination?.coveredItems[0],
      regime.sourceRegime.determination?.approval,
    ]) expect(value == null || Object.isFrozen(value)).toBe(true);
  });

  it.each([
    undefined,
    deepFreeze({ selection: "project-owned-fallback" }),
    deepFreeze({ ...snapshot("project-owned-fallback"), versionId: " " }),
    deepFreeze({ ...snapshot("project-owned-fallback"), selectedAt: "invalid" }),
  ])("rejects missing, partial, or invalid snapshots", (sourceRegime) => {
    expect(() => createProvenanceRegime({
      sourceRegime,
      candidates: candidates("project-owned-fallback"),
    } as never)).toThrow(ProvenanceRegimeRuleError);
  });

  it.each([
    { ...snapshot("stack-overflow-enabled") },
    Object.freeze({ ...snapshot("stack-overflow-enabled"), determination: { ...determination() } }),
    Object.freeze({
      ...snapshot("stack-overflow-enabled"),
      determination: Object.freeze({
        ...deepFreeze(determination()), approval: { ...determination().approval },
      }),
    }),
    Object.freeze({
      ...snapshot("stack-overflow-enabled"),
      determination: Object.freeze({
        ...deepFreeze(determination()),
        coveredItems: Object.freeze([{ ...determination().coveredItems[0] }]),
      }),
    }),
  ])("rejects mutable or shallow-frozen snapshot structures", (sourceRegime) => {
    expect(() => createProvenanceRegime({
      sourceRegime: sourceRegime as SourceRegimeSnapshotInput,
      candidates: candidates("stack-overflow-enabled"),
    })).toThrow(ProvenanceRegimeRuleError);
  });

  it.each([
    { field: "writtenText", value: " " },
    { field: "reviewerId", value: undefined },
    { field: "attributionAtRevealSatisfiesLicense", value: false },
    { field: "firstDisplayAttributionRequired", value: true },
  ])("rejects incomplete or nonaffirmative determination $field", ({ field, value }) => {
    const changed = deepFreeze({ ...determination(), [field]: value });
    const sourceRegime = deepFreeze({
      ...snapshot("stack-overflow-enabled"), determination: changed,
    }) as SourceRegimeSnapshotInput;
    expect(() => create(sourceRegime)).toThrow(ProvenanceRegimeRuleError);
  });

  it.each([
    { role: "Rights Reviewer" },
    { signature: " " },
    { signedAt: "2026-08-03T00:00:00.000Z" },
  ])("rejects invalid approval or chronology", (change) => {
    const sourceRegime = deepFreeze({
      ...snapshot("stack-overflow-enabled"),
      determination: {
        ...determination(),
        approval: { ...determination().approval, ...change },
      },
    }) as SourceRegimeSnapshotInput;
    expect(() => create(sourceRegime)).toThrow(ProvenanceRegimeRuleError);
  });

  it.each([
    deepFreeze({ ...snapshot("project-owned-fallback"), determination: determination() }),
    deepFreeze({ ...snapshot("project-owned-fallback"), allowedSourceClasses: ["model-output", "stack-overflow"] }),
    deepFreeze({ ...snapshot("stack-overflow-enabled"), determination: null }),
  ])("rejects inconsistent selection, classes, or determination", (sourceRegime) => {
    expect(() => create(sourceRegime as SourceRegimeSnapshotInput)).toThrow(ProvenanceRegimeRuleError);
  });

  it.each([
    ["reordered", [...candidates("project-owned-fallback")].reverse()],
    ["missing", candidates("project-owned-fallback").slice(0, 1)],
    ["extra", [...candidates("project-owned-fallback"), candidates("stack-overflow-enabled")[1]!]],
    ["duplicate", [candidates("project-owned-fallback")[0]!, candidates("project-owned-fallback")[0]!]],
  ])("rejects %s candidate membership", (_name, candidateInput) => {
    expect(() => createProvenanceRegime({
      sourceRegime: snapshot("project-owned-fallback"),
      candidates: candidateInput as ProvenanceCandidateInput[],
    })).toThrow(ProvenanceRegimeRuleError);
  });

  it.each([
    { index: 0, field: "id", value: " " },
    { index: 1, field: "id", value: " HUMAN " },
    { index: 1, field: "label", value: "  Project-owned   human sample " },
    { index: 1, field: "label", value: "Human-written code" },
    { index: 1, field: "sourceClass", value: "project-owned-human-sample" },
  ])("rejects invalid or colliding candidate $field", ({ index, field, value }) => {
    const candidateInput = candidates("project-owned-fallback");
    candidateInput[index] = { ...candidateInput[index]!, [field]: value } as ProvenanceCandidateInput;
    expect(() => createProvenanceRegime({
      sourceRegime: snapshot("project-owned-fallback"), candidates: candidateInput,
    })).toThrow(ProvenanceRegimeRuleError);
  });
});
