import { describe, expect, it } from "vitest";

import {
  CorrectionAwareSession,
  ResultsRuleError,
  promoteReserveBeforeIssue,
  quarantineAffectedRound,
  utcCompletionStreak,
  type PreIssueReserveInput,
  type ResultCorrectionStatus,
  type SessionResultsInput,
} from "../src/results/index.js";

const sessionInput = (): SessionResultsInput => ({
  sessionId: "session-1",
  betaDay: "2026-09-01",
  manifestLineageId: "lineage-1",
  issuedManifestVersionId: "manifest-v1",
  lineageVersionIds: ["manifest-v1", "manifest-v2"],
  lineageAnsweredRoundIds: [],
  utcDayEndsAt: "2026-09-02T00:00:00.000Z",
  started: true,
  status: "IN_PROGRESS",
  rounds: [
    { roundId: "round-1", displayed: false, answered: false, revealed: false, correction: "ACTIVE", noticeAcknowledged: false, maximumPoints: 1000, historicalScore: null, historicalAnswerId: null },
    { roundId: "round-2", displayed: true, answered: true, revealed: true, correction: "ACTIVE", noticeAcknowledged: false, maximumPoints: 1000, historicalScore: 800, historicalAnswerId: "answer-2" },
    { roundId: "round-3", displayed: true, answered: true, revealed: true, correction: "ACTIVE", noticeAcknowledged: false, maximumPoints: 1000, historicalScore: 1000, historicalAnswerId: "answer-3" },
  ],
});

describe("correction-aware results and re-entry", () => {
  it("promotes a compatible reserve before issuance without rebinding existing sessions", () => {
    const result = promoteReserveBeforeIssue({
      currentManifestVersionId: "manifest-v1",
      successorManifestVersionId: "manifest-v2",
      affectedRoundId: "round-1",
      reserveRoundId: "reserve-7",
      affectedMode: "language",
      reserveMode: "language",
      affectedDifficulty: "medium",
      reserveDifficulty: "medium",
      currentManifestIssuanceCount: 0,
      existingBindings: [{ sessionId: "existing", manifestVersionId: "manifest-v1" }],
    });

    expect(result.futureIssuanceManifestVersionId).toBe("manifest-v2");
    expect(result.existingBindings).toEqual([
      { sessionId: "existing", manifestVersionId: "manifest-v1" },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects a pre-issue reserve with a different mode or difficulty", () => {
    const base: PreIssueReserveInput = {
      currentManifestVersionId: "manifest-v1", successorManifestVersionId: "manifest-v2",
      affectedRoundId: "round-1", reserveRoundId: "reserve-7", affectedMode: "language",
      reserveMode: "provenance", affectedDifficulty: "medium", reserveDifficulty: "hard",
      currentManifestIssuanceCount: 0,
      existingBindings: [],
    };
    expect(() => promoteReserveBeforeIssue(base)).toThrowError(
      new ResultsRuleError("reserve must match mode and approved difficulty"),
    );
  });

  it("rejects reserve promotion after the current version was issued", () => {
    expect(() => promoteReserveBeforeIssue({
      currentManifestVersionId: "manifest-v1", successorManifestVersionId: "manifest-v2",
      affectedRoundId: "round-1", reserveRoundId: "reserve-7", affectedMode: "language",
      reserveMode: "language", affectedDifficulty: "medium", reserveDifficulty: "medium",
      currentManifestIssuanceCount: 1, existingBindings: [],
    })).toThrow("current manifest version must have zero issuances");
  });

  it("rejects successor and reserve identity reuse", () => {
    const base = {
      currentManifestVersionId: "manifest-v1", successorManifestVersionId: "manifest-v1",
      affectedRoundId: "round-1", reserveRoundId: "round-1", affectedMode: "language",
      reserveMode: "language", affectedDifficulty: "medium", reserveDifficulty: "medium",
      currentManifestIssuanceCount: 0, existingBindings: [],
    };
    expect(() => promoteReserveBeforeIssue(base)).toThrow(
      "successor manifest and reserve round identities must be new",
    );
  });

  it.each([false, true])("uses the issued-unanswered branch regardless of DISPLAYED=%s", (displayed) => {
    const input = sessionInput();
    input.rounds[0] = { ...input.rounds[0]!, displayed };
    const corrected = CorrectionAwareSession.create(input).correctRound("round-1", "VOID");

    expect(corrected.lastCorrection).toMatchObject({
      branch: "ISSUED_UNANSWERED",
      silentReplacement: false,
      affectedManifestVersionIds: ["manifest-v1"],
    });
    expect(corrected.projection()).toMatchObject({
      attainableMaximum: 2000,
      currentScore: 1800,
      streakProtected: true,
      analyticallyExcludedRoundIds: ["round-1"],
    });
  });

  it.each([false, true])("uses the post-answer branch regardless of DISPLAYED=%s", (displayed) => {
    const input = sessionInput();
    input.rounds[1] = { ...input.rounds[1]!, displayed };
    const corrected = CorrectionAwareSession.create(input).correctRound(
      "round-2",
      "VOID",
    );

    expect(corrected.lastCorrection).toMatchObject({
      branch: "POST_ANSWER",
      silentReplacement: false,
      affectedManifestVersionIds: ["manifest-v1", "manifest-v2"],
    });
    expect(corrected.round("round-2")).toMatchObject({
      historicalAnswerId: "answer-2",
      historicalScore: 800,
      correction: "VOID",
    });
    expect(corrected.projection().currentScore).toBe(1000);
  });

  it("uses the post-answer branch when another lineage participant answered", () => {
    const input = sessionInput();
    input.lineageAnsweredRoundIds = ["round-1"];
    const corrected = CorrectionAwareSession.create(input).correctRound("round-1", "VOID");

    expect(corrected.lastCorrection).toMatchObject({
      branch: "POST_ANSWER",
      affectedManifestVersionIds: ["manifest-v1", "manifest-v2"],
    });
  });

  it("produces deterministic quarantine effects at the exact five-minute boundary", () => {
    const action = quarantineAffectedRound({
      affectedRoundId: "round-1",
      affectedManifestVersionId: "manifest-v1",
      replacementManifestVersionId: "manifest-v2",
      quarantinedAt: "2026-09-01T12:00:00.000Z",
      contentCachePurgedAt: "2026-09-01T12:05:00.000Z",
      displayed: true,
      correction: "VOID",
    });

    expect(action).toEqual({
      affectedRoundId: "round-1",
      affectedManifestVersionId: "manifest-v1",
      contentBlocked: true,
      revealBlocked: true,
      affectedManifestEligibleForNewIssuance: false,
      currentManifestForUnissuedParticipants: "manifest-v2",
      existingCredential: {
        revoked: false,
        allowedTransitions: [
          "CORRECTION_NOTICE",
          "UNAFFECTED_ROUND",
          "UNAFFECTED_REVEAL",
        ],
      },
      cachePurgeDeadline: "2026-09-01T12:05:00.000Z",
      cachePurgedWithinDeadline: true,
      displayedContentTreatment: "ALREADY_DISPLAYED_NOT_RECALLABLE",
      publishedNotice: { kind: "VOID", text: "Round voided" },
    });
    const afterBoundary = quarantineAffectedRound({
      affectedRoundId: "round-1", affectedManifestVersionId: "manifest-v1",
      replacementManifestVersionId: "manifest-v2", quarantinedAt: "2026-09-01T12:00:00.000Z",
      contentCachePurgedAt: "2026-09-01T12:05:00.001Z", displayed: false,
      correction: "CONTENT_WITHDRAWN",
    });
    expect(afterBoundary.cachePurgedWithinDeadline).toBe(false);
    expect(afterBoundary.displayedContentTreatment).toBe("NOT_PREVIOUSLY_DISPLAYED");
    expect(afterBoundary.publishedNotice).toEqual({
      kind: "CONTENT_WITHDRAWN",
      text: "Content unavailable",
    });
    expect(JSON.stringify([action, afterBoundary])).not.toMatch(/\bRECALLED\b/u);
  });

  it("rejects a quarantine replacement that reuses the affected version", () => {
    expect(() => quarantineAffectedRound({
      affectedRoundId: "round-1", affectedManifestVersionId: " manifest-v1 ",
      replacementManifestVersionId: "manifest-v1", quarantinedAt: "2026-09-01T12:00:00Z",
      contentCachePurgedAt: "2026-09-01T12:01:00Z", displayed: false, correction: "VOID",
    })).toThrow("replacement manifest version must differ from affected version");
  });

  it("rejects an unsupported quarantine correction kind", () => {
    expect(() => quarantineAffectedRound({
      affectedRoundId: "round-1", affectedManifestVersionId: "manifest-v1",
      replacementManifestVersionId: "manifest-v2", quarantinedAt: "2026-09-01T12:00:00Z",
      contentCachePurgedAt: "2026-09-01T12:01:00Z", displayed: false,
      correction: "PENDING" as "VOID",
    })).toThrow("quarantine correction is not supported");
  });

  it("rejects unsupported correction kinds in session input and transitions", () => {
    const input = sessionInput();
    input.rounds[0] = { ...input.rounds[0]!, correction: "PENDING" as "ACTIVE" };
    expect(() => CorrectionAwareSession.create(input)).toThrow(
      "round correction is not supported",
    );
    expect(() => CorrectionAwareSession.create(sessionInput()).correctRound(
      "round-1",
      "PENDING" as "VOID",
    )).toThrow("round correction is not supported");
  });

  it.each(["VOID", "CONTENT_WITHDRAWN"] as readonly ResultCorrectionStatus[])(
    "requires acknowledgement and preserves completion after %s",
    (correction) => {
      const base = CorrectionAwareSession.create(sessionInput()).correctRound("round-1", correction);
      expect(base.completion().canComplete).toBe(false);
      const acknowledged = base.acknowledgeNotice("round-1");
      expect(acknowledged.completion()).toMatchObject({
        canComplete: true,
        streakEligible: true,
        unaffectedCompletionIncluded: true,
      });
      expect(acknowledged.projection().correctnessAnalysisIncluded).toBe(false);
    },
  );

  it("uses a void symbol and only a generic withdrawal notice", () => {
    const voided = CorrectionAwareSession.create(sessionInput()).correctRound("round-1", "VOID");
    const withdrawn = CorrectionAwareSession.create(sessionInput()).correctRound(
      "round-1",
      "CONTENT_WITHDRAWN",
    );
    expect(voided.round("round-1").notice).toEqual({ kind: "VOID", text: "Round voided" });
    expect(voided.share().symbols).toContain("⊘");
    expect(withdrawn.round("round-1").notice).toEqual({
      kind: "CONTENT_WITHDRAWN",
      text: "Content unavailable",
    });
    expect(withdrawn.share().symbols).toContain("⊘");
  });

  it("resumes the same issued state before grace and attributes facts to the prior day", () => {
    const session = CorrectionAwareSession.create(sessionInput());
    const reentry = session.reenter("2026-09-02T00:59:59.999Z");
    expect(reentry).toMatchObject({
      access: "RESUME",
      manifestVersionId: "manifest-v1",
      attributeAcceptedFactsToBetaDay: "2026-09-01",
    });
  });

  it("expires at the exact grace boundary and remains started in the denominator", () => {
    const reentry = CorrectionAwareSession.create(sessionInput()).reenter(
      "2026-09-02T01:00:00.000Z",
    );
    expect(reentry).toMatchObject({
      access: "READ_ONLY",
      status: "EXPIRED",
      denominatorStarted: true,
      mayCreateAnswerFact: false,
      mayCreateScoreFact: false,
      mayCreateCompletionFact: false,
      mayCreateGateFact: false,
    });
  });

  it("keeps completed re-entry read-only with no new facts", () => {
    const input = sessionInput();
    input.status = "COMPLETED";
    const reentry = CorrectionAwareSession.create(input).reenter("2026-09-01T12:00:00.000Z");
    expect(reentry).toMatchObject({
      access: "READ_ONLY", status: "COMPLETED", mayCreateAnswerFact: false,
      mayCreateScoreFact: false, mayCreateCompletionFact: false, mayCreateGateFact: false,
    });
  });

  it("keeps EXPIRED input read-only even before the grace boundary", () => {
    const input = sessionInput();
    input.status = "EXPIRED";
    expect(CorrectionAwareSession.create(input).reenter("2026-09-01T12:00:00.000Z"))
      .toMatchObject({ access: "READ_ONLY", status: "EXPIRED", mayCreateAnswerFact: false });
  });

  it("rejects an impossible unstarted EXPIRED state", () => {
    const input = sessionInput();
    input.status = "EXPIRED";
    input.started = false;
    expect(() => CorrectionAwareSession.create(input)).toThrow(
      "expired session must be started",
    );
  });

  it("rejects lineage versions that omit the issued version or contain duplicates", () => {
    const omitted = sessionInput();
    omitted.lineageVersionIds = ["manifest-v2"];
    expect(() => CorrectionAwareSession.create(omitted)).toThrow(
      "lineage versions must contain the issued manifest version exactly once",
    );
    const duplicated = sessionInput();
    duplicated.lineageVersionIds = ["manifest-v1", "manifest-v1"];
    expect(() => CorrectionAwareSession.create(duplicated)).toThrow(
      "lineage versions must be distinct",
    );
  });

  it("canonicalizes promotion identities before reuse checks", () => {
    expect(() => promoteReserveBeforeIssue({
      currentManifestVersionId: "manifest-v1", successorManifestVersionId: " manifest-v1 ",
      affectedRoundId: "round-1", reserveRoundId: " round-1 ", affectedMode: "language",
      reserveMode: "language", affectedDifficulty: "medium", reserveDifficulty: "medium",
      currentManifestIssuanceCount: 0, existingBindings: [],
    })).toThrow("successor manifest and reserve round identities must be new");
  });

  it("calculates streak only from UTC completion days and ignores localized display", () => {
    expect(utcCompletionStreak(
      ["2026-09-01", "2026-09-02", "2026-09-03"],
      ["31/08/2026", "01/09/2026", "02/09/2026"],
    )).toBe(3);
  });

  it("produces a recursively spoiler-free session share", () => {
    const share = CorrectionAwareSession.create(sessionInput())
      .correctRound("round-1", "VOID")
      .share();
    const serialized = JSON.stringify(share).toLowerCase();
    for (const forbidden of ["answer", "code", "clue", "source", "language", "content", "attribution", "reveal", "url"]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
  });
});
