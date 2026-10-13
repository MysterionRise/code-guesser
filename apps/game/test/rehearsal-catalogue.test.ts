import { readFileSync } from "node:fs";

import { DEMO_MODE } from "../src/demo/demo-game.js";
import {
  ACTIVE_REHEARSAL_CATALOGUE,
  createRehearsalReveal,
  issueRehearsalRevealCapability,
  selectRehearsalCatalogue,
} from "../src/demo/rehearsal-catalogue.js";
import type {
  LanguageCatalogueEntry,
} from "../src/server/content/catalogue/language-entry.js";
import type {
  ProvenanceCatalogueEntry,
} from "../src/server/content/catalogue/provenance-entry.js";
import {
  hashRehearsalApprovalArtifact,
  hashRehearsalApprovalRegister,
} from "../src/demo/rehearsal-approval-register.js";

interface Expectation {
  readonly not: Expectation;
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toHaveLength(expected: number): void;
  toMatch(expected: RegExp): void;
  toThrow(expected?: unknown): void;
}
interface TestApi {
  describe(name: string, callback: () => unknown): void;
  expect(actual: unknown): Expectation;
  it(name: string, callback: () => unknown): void;
}
const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as TestApi;

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
};

function languageEntry(): LanguageCatalogueEntry {
  return deepFreeze({
    status: "APPROVED_LANGUAGE_CATALOGUE_ENTRY",
    publicRound: {
      roundId: "approved-language-round",
      roundVersionId: "approved-language-round-v1",
      excerpt: { versionId: "approved-language-content-v1", text: "const value: number = 1;" },
      mode: {
        kind: "language", contractVersionId: "language-contract-v1",
        calibrationVersionId: "language-calibration-v1",
        prompt: "Which language is this?",
        candidates: [
          { candidateId: "typescript", label: "TypeScript" },
          { candidateId: "javascript", label: "JavaScript" },
        ],
        clues: [
          { order: 1, label: "Look at the type annotation." },
          { order: 2, label: "The runtime syntax resembles JavaScript." },
        ],
      },
      versions: {
        candidateSet: "language-candidates-v1", clueSet: "language-clues-v1",
        scoring: "scoring-v1", rules: "rules-v1",
      },
    },
    serverReveal: {
      correctCandidateId: "typescript",
      evidence: "Two qualified technical reviewers approved TypeScript.",
      attribution: "owner/language, MIT", sourceIdentity: "owner/language",
      sourceUrl: `https://github.com/owner/language/blob/${"1".repeat(40)}/src/code.ts`,
      helpfulSignals: ["type annotation"], misleadingSignals: ["shared syntax"],
      versions: {
        content: "a".repeat(64), evidence: "language-evidence-v1",
        candidateSet: "language-candidates-v1", scoring: "scoring-v1",
        rules: "rules-v1", reveal: "language-reveal-v1",
      },
    },
    bindings: {
      promotionIdentifier: "language-promotion-1",
      contentStableId: "language-content-1",
      contentVersionId: "approved-language-content-v1",
      contentHash: "a".repeat(64), evidenceVersionId: "language-evidence-v1",
      rendererVersionId: "renderer-v1", revealVersionId: "language-reveal-v1",
      catalogueHash: "c".repeat(64),
    },
  });
}

function provenanceEntry(): ProvenanceCatalogueEntry {
  return deepFreeze({
    status: "APPROVED_PROVENANCE_CATALOGUE_ENTRY",
    publicRound: {
      roundId: "approved-provenance-round",
      roundVersionId: "approved-provenance-round-v1",
      excerpt: { versionId: "approved-provenance-content-v1", text: "const result = assisted(input);" },
      mode: {
        kind: "provenance", contractVersionId: "provenance-contract-v1",
        calibrationVersionId: "provenance-calibration-v1",
        prompt: "Is an AI coding agent durably recorded as participating in this code change?",
        candidates: [
          { candidateId: "RECORDED_AGENT_PARTICIPATION", label: "RECORDED_AGENT_PARTICIPATION" },
          { candidateId: "PROJECT_CONTROLLED_HUMAN_ONLY", label: "PROJECT_CONTROLLED_HUMAN_ONLY" },
        ],
        clues: [
          { order: 1, label: "Look for the kind of record being tested." },
          { order: 2, label: "Style alone is not evidence." },
        ],
      },
      versions: {
        candidateSet: "provenance-candidates-v1", clueSet: "provenance-clues-v1",
        scoring: "scoring-v1", rules: "rules-v1",
      },
    },
    serverReveal: {
      correctCandidateId: "RECORDED_AGENT_PARTICIPATION",
      classification: "AGENT_RECORDED", recordedModelName: null,
      publicClaim: "AI coding agent",
      evidence: "The accepted durable record names an AI coding agent.",
      attribution: "Vendor Agent Bot; owner/provenance, MIT",
      sourceIdentity: "owner/provenance",
      sourceUrl: `https://github.com/owner/provenance/blob/${"2".repeat(40)}/src/code.ts`,
      helpfulSignals: ["accepted repository evidence"],
      misleadingSignals: ["style-only inference"],
      versions: {
        content: "b".repeat(64), evidence: "provenance-evidence-v1",
        candidateSet: "provenance-candidates-v1", scoring: "scoring-v1",
        rules: "rules-v1", reveal: "provenance-reveal-v1",
      },
    },
    bindings: {
      promotionIdentifier: "provenance-promotion-1",
      contentStableId: "provenance-content-1",
      contentVersionId: "approved-provenance-content-v1",
      contentHash: "b".repeat(64), evidenceVersionId: "provenance-evidence-v1",
      rendererVersionId: "renderer-v1", revealVersionId: "provenance-reveal-v1",
      sourceRegimeVersionId: "licensed-github-vs-project-controlled-v1",
      catalogueHash: "d".repeat(64),
    },
  });
}

const approvalArtifact = {
  artifactId: "fixture-rehearsal-approval-artifact-1",
  approvalId: "fixture-rehearsal-approval-1",
  decision: "APPROVED_NON_PUBLIC_REHEARSAL" as const,
  approvedBy: "Fixture Release Operator",
  approvedAt: "2026-07-29T10:00:00Z",
  languagePromotionIdentifier: "language-promotion-1",
  provenancePromotionIdentifier: "provenance-promotion-1",
  languageCatalogueHash: "c".repeat(64),
  provenanceCatalogueHash: "d".repeat(64),
};
const artifactHash = hashRehearsalApprovalArtifact(approvalArtifact);
const registerVersion = "fixture-rehearsal-register-v1";
const registerEntries = deepFreeze([{
  approvalId: approvalArtifact.approvalId,
  artifactId: approvalArtifact.artifactId,
  artifactHash,
  decision: approvalArtifact.decision,
  languagePromotionIdentifier: approvalArtifact.languagePromotionIdentifier,
  provenancePromotionIdentifier: approvalArtifact.provenancePromotionIdentifier,
  languageCatalogueHash: approvalArtifact.languageCatalogueHash,
  provenanceCatalogueHash: approvalArtifact.provenanceCatalogueHash,
}]);
const fixtureRegister = deepFreeze({
  versionId: registerVersion,
  entries: registerEntries,
  registerHash: hashRehearsalApprovalRegister(registerVersion, registerEntries),
});
const approval = deepFreeze({
  ...approvalArtifact,
  artifactHash,
  registerVersion,
  registerHash: fixtureRegister.registerHash,
});
const guards = Object.freeze({
  inputValid: true, authenticated: true, authorized: true,
  credentialValid: true, antiForgeryValid: true, rateLimitAllowed: true,
});
const entitlement = (
  roundId: string,
  overrides: Record<string, unknown> = {},
) => ({
  participantLineageId: "rehearsal-participant-1",
  betaDay: "2026-07-29",
  manifestLineageId: "rehearsal-manifest-lineage-1",
  manifestVersionId: "rehearsal-manifest-v1",
  sessionId: "rehearsal-session-1",
  roundId,
  acceptedAnswerId: `accepted-${roundId}`,
  acceptedAt: "2026-07-29T10:00:00Z",
  expiresAt: "2026-07-29T11:00:00Z",
  correctionStatus: "ACTIVE" as const,
  revealBlocked: false,
  ...overrides,
});
const acceptedTransitionId = (roundId: string): string => `accepted-${roundId}`;
const h2Request = (
  roundId: string,
  overrides: Record<string, unknown> = {},
) => ({
  participantLineageId: "rehearsal-participant-1",
  betaDay: "2026-07-29",
  manifestLineageId: "rehearsal-manifest-lineage-1",
  manifestVersionId: "rehearsal-manifest-v1",
  sessionId: "rehearsal-session-1",
  roundId,
  acceptedAnswerId: `accepted-${roundId}`,
  requestedAt: "2026-07-29T10:01:00Z",
  ...overrides,
});

describe("safe local rehearsal catalogue", () => {
  it("keeps the explicit active default synthetic and non-beta", () => {
    expect(ACTIVE_REHEARSAL_CATALOGUE.kind).toBe("SYNTHETIC_DEFAULT");
    expect(ACTIVE_REHEARSAL_CATALOGUE.mode).toBe(DEMO_MODE);
    expect(ACTIVE_REHEARSAL_CATALOGUE.notice).toMatch(/synthetic/iu);
    expect(JSON.stringify(ACTIVE_REHEARSAL_CATALOGUE)).not.toMatch(
      /language-promotion|provenance-promotion|APPROVED_NON_PUBLIC/iu,
    );
  });

  it("loads exactly one approved real round per mode without public reveal data", () => {
    const selected = selectRehearsalCatalogue({
      language: languageEntry(), provenance: provenanceEntry(), approval,
    }, fixtureRegister);
    expect(selected.kind).toBe("APPROVED_NON_PUBLIC_REHEARSAL");
    expect(selected.mode.rounds).toHaveLength(5);
    expect(selected.mode.rounds.map(({ mode }) => mode.kind)).toEqual([
      "provenance", "provenance", "provenance", "language", "language",
    ]);
    expect(selected.mode.rounds[0]!.roundId).toBe("approved-provenance-round");
    expect(selected.mode.rounds[3]!.roundId).toBe("approved-language-round");
    expect(JSON.stringify(selected.mode)).not.toMatch(
      /correctCandidate|sourceIdentity|sourceUrl|approvedAttribution|serverReveal|owner\/language|owner\/provenance/iu,
    );
  });

  it("does not activate from caller-supplied approval fields alone", () => {
    const selected = selectRehearsalCatalogue({
      language: languageEntry(), provenance: provenanceEntry(), approval,
    });
    expect(selected.kind).toBe("SYNTHETIC_DEFAULT");
  });

  it("falls back without inventing approval when entries or bindings are missing", () => {
    for (const input of [
      null,
      { language: languageEntry(), provenance: null, approval },
      {
        language: languageEntry(), provenance: provenanceEntry(),
        approval: { ...approval, languagePromotionIdentifier: "other" },
      },
      {
        language: structuredClone(languageEntry()),
        provenance: provenanceEntry(), approval,
      },
    ]) {
      const selected = selectRehearsalCatalogue(input, fixtureRegister);
      expect(selected.kind).toBe("SYNTHETIC_DEFAULT");
      expect(selected.mode).toBe(DEMO_MODE);
    }
  });

  it("authorizes selected real provenance and language reveals against active lineage", () => {
    const selected = selectRehearsalCatalogue({
      language: languageEntry(), provenance: provenanceEntry(), approval,
    }, fixtureRegister);
    const provenanceRequest = {
      roundId: "approved-provenance-round",
      roundVersionId: "approved-provenance-round-v1",
      candidateId: "RECORDED_AGENT_PARTICIPATION",
      completedRounds: 0, currentScore: 0, cluesUsed: 0,
    };
    const provenance = createRehearsalReveal(selected, provenanceRequest, {
      capability: issueRehearsalRevealCapability(
        selected,
        provenanceRequest,
        entitlement(provenanceRequest.roundId),
        acceptedTransitionId(provenanceRequest.roundId),
      ),
      request: h2Request(provenanceRequest.roundId),
      guards,
    });
    expect(provenance.correct).toBe(true);
    expect(provenance.score).toBe(1000);
    expect(provenance.evidence).toMatch(/durable record/iu);
    expect(provenance.attribution).toBe("Vendor Agent Bot; owner/provenance, MIT");
    expect(provenance.versions.content).toBe("approved-provenance-content-v1");

    const languageRequest = {
      roundId: "approved-language-round",
      roundVersionId: "approved-language-round-v1",
      candidateId: "javascript",
      completedRounds: 3, currentScore: 1000, cluesUsed: 1,
    };
    const language = createRehearsalReveal(selected, languageRequest, {
      capability: issueRehearsalRevealCapability(
        selected,
        languageRequest,
        entitlement(languageRequest.roundId),
        acceptedTransitionId(languageRequest.roundId),
      ),
      request: h2Request(languageRequest.roundId),
      guards,
    });
    expect(language.correct).toBe(false);
    expect(language.score).toBe(0);
    expect(language.evidence).toMatch(/approved TypeScript/iu);
    expect(language.versions.content).toBe("approved-language-content-v1");
    expect(language.result.completedRounds).toBe(4);
  });

  it("retains the synthetic reveal path and rejects selected-catalogue drift", () => {
    const synthetic = createRehearsalReveal(ACTIVE_REHEARSAL_CATALOGUE, {
      roundId: "demo-round-1", roundVersionId: "demo-round-version-1",
      candidateId: "recorded-model-output",
      completedRounds: 0, currentScore: 0, cluesUsed: 0,
    });
    expect(synthetic.evidence).toMatch(/synthetic demo fixture/iu);

    const selected = selectRehearsalCatalogue({
      language: languageEntry(), provenance: provenanceEntry(), approval,
    }, fixtureRegister);
    expect(() => createRehearsalReveal(selected, {
      roundId: "demo-round-1", roundVersionId: "demo-round-version-1",
      candidateId: "RECORDED_AGENT_PARTICIPATION",
      completedRounds: 0, currentScore: 0, cluesUsed: 0,
    })).toThrow(/round/iu);
  });

  it("fails closed when approved content lacks an H-002 reveal capability", () => {
    const selected = selectRehearsalCatalogue({
      language: languageEntry(), provenance: provenanceEntry(), approval,
    }, fixtureRegister);
    expect(() => createRehearsalReveal(selected, {
      roundId: "approved-provenance-round",
      roundVersionId: "approved-provenance-round-v1",
      candidateId: "RECORDED_AGENT_PARTICIPATION",
      completedRounds: 0, currentScore: 0, cluesUsed: 0,
    })).toThrow(/authorization/iu);
  });

  it("uses H-002 to deny premature, cross-scope, expired, corrected and replayed reveals", () => {
    const selected = selectRehearsalCatalogue({
      language: languageEntry(), provenance: provenanceEntry(), approval,
    }, fixtureRegister);
    const accepted = {
      roundId: "approved-provenance-round",
      roundVersionId: "approved-provenance-round-v1",
      candidateId: "RECORDED_AGENT_PARTICIPATION",
      completedRounds: 0, currentScore: 0, cluesUsed: 0,
    };
    const denialCases = [
      {
        name: "premature",
        entitlement: entitlement(accepted.roundId),
        request: h2Request(accepted.roundId, {
          requestedAt: "2026-07-29T09:59:59Z",
        }),
      },
      {
        name: "cross-scope",
        entitlement: entitlement(accepted.roundId),
        request: h2Request(accepted.roundId, { sessionId: "other-session" }),
      },
      {
        name: "expired",
        entitlement: entitlement(accepted.roundId),
        request: h2Request(accepted.roundId, {
          requestedAt: "2026-07-29T11:00:00Z",
        }),
      },
      {
        name: "corrected",
        entitlement: entitlement(accepted.roundId, {
          correctionStatus: "CONTENT_WITHDRAWN",
        }),
        request: h2Request(accepted.roundId),
      },
    ];
    for (const denial of denialCases) {
      const capability = issueRehearsalRevealCapability(
        selected,
        accepted,
        denial.entitlement,
        acceptedTransitionId(accepted.roundId),
      );
      let serialized = "";
      try {
        createRehearsalReveal(selected, accepted, {
          capability, request: denial.request, guards,
        });
      } catch (error) {
        serialized = JSON.stringify(error instanceof Error ? error.message : error);
      }
      expect(serialized).toMatch(/authorization denied/iu);
      expect(serialized).not.toMatch(/durable record|owner\/provenance|attribution/iu);
    }
    const capability = issueRehearsalRevealCapability(
      selected,
      accepted,
      entitlement(accepted.roundId),
      acceptedTransitionId(accepted.roundId),
    );
    const authorization = {
      capability, request: h2Request(accepted.roundId), guards,
    };
    createRehearsalReveal(selected, accepted, authorization);
    expect(() => createRehearsalReveal(selected, accepted, authorization))
      .toThrow(/authorization denied/iu);
  });

  it("rejects an entitlement for an unrelated accepted transition", () => {
    const selected = selectRehearsalCatalogue({
      language: languageEntry(), provenance: provenanceEntry(), approval,
    }, fixtureRegister);
    const accepted = {
      roundId: "approved-provenance-round",
      roundVersionId: "approved-provenance-round-v1",
      candidateId: "RECORDED_AGENT_PARTICIPATION",
      completedRounds: 0, currentScore: 0, cluesUsed: 0,
    };
    expect(() => issueRehearsalRevealCapability(
      selected,
      accepted,
      entitlement(accepted.roundId),
      "unrelated-accepted-transition",
    )).toThrow(/accepted-answer entitlement/iu);
  });

  it("mounts the local experiment on the root route and retains synthetic source truth", () => {
    const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
    const actions = readFileSync(new URL("../src/app/actions.ts", import.meta.url), "utf8");
    const demo = readFileSync(new URL("../src/demo/demo-game.ts", import.meta.url), "utf8");
    const catalogue = readFileSync(
      new URL("../src/demo/rehearsal-catalogue.ts", import.meta.url),
      "utf8",
    );
    const serverEntry = readFileSync(
      new URL("../src/demo/rehearsal-server.ts", import.meta.url),
      "utf8",
    );
    // FR-015: the root route binds the local experiment directly; synthetic truth stays intact elsewhere.
    expect(page).toContain("local-real-experiment-loader.server");
    expect(page).toContain("authorizeLocalExperimentReveal");
    expect(actions).toContain("local-real-experiment-loader.server");
    expect(page).not.toContain("ACTIVE_REHEARSAL_CATALOGUE");
    expect(page).not.toContain("rehearsal-server");
    expect(page).not.toContain("authorizeDemoReveal");
    expect(page).not.toContain("DEMO_MODE");
    expect(demo).toContain("synthetic-demo-session-v1");
    expect(catalogue).not.toMatch(/language-promotion-1|provenance-promotion-1/gu);
    expect(serverEntry).toMatch(/^import "server-only";/u);
  });
});
