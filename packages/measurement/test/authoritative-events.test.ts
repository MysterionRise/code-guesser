import { describe, expect, it } from "vitest";
import {
  AUTHORITATIVE_EVENT_FAMILIES,
  AUTHORITATIVE_EVENT_SCHEMA_VERSION,
  assertNoForbiddenTelemetry,
  parseAuthoritativeEvent,
  parseAuthoritativeEventBatch,
  type AuthoritativeEvent,
} from "../src/events/index.js";

const FAMILIES = Object.freeze([
  "SESSION_ISSUED",
  "SESSION_STARTED",
  "ROUND_DISPLAYED",
  "CLUE_REVEALED",
  "ANSWER_ACCEPTED",
  "REVEAL_AUTHORIZED",
  "REVEAL_DENIED",
  "ROUND_CORRECTED",
  "CORRECTION_NOTICE_ACKNOWLEDGED",
  "SESSION_COMPLETED",
  "SESSION_EXPIRED",
  "CONSENT_OR_WITHDRAWAL_CHANGED",
  "CREDENTIAL_CHANGED",
  "SURVEY_OFFERED",
  "SURVEY_SUBMITTED",
  "CRITICAL_DEFECT_CHANGED",
  "OPERATIONAL_INCIDENT_OR_OUTAGE",
] as const);

type Family = (typeof FAMILIES)[number];
type EventRecord = Readonly<Record<string, unknown>>;
type MutableRecord = Record<string, unknown>;
type ParsedEvent<F extends Family> = Extract<AuthoritativeEvent, { readonly eventFamilyId: F }>;

const deepFreeze = <T>(value: T): T => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
};

const recursivelyFrozen = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) return true;
  return Object.isFrozen(value) && Object.values(value).every(recursivelyFrozen);
};

const base = (eventFamilyId: Family, ordinal: number) => ({
  eventId: `event-${ordinal}`,
  eventFamilyId,
  schemaVersionId: "authoritative-events-v1",
  acceptedAt: "2026-08-03T10:00:00.000Z",
});

const participantDayManifest = {
  participantLineageId: "participant-lineage-17",
  betaDay: "2026-08-03",
  manifestLineageId: "manifest-lineage-4",
  manifestVersionId: "manifest-v7",
};

const participantSession = {
  ...participantDayManifest,
  sessionId: "session-23",
};

const EVENTS: Readonly<Record<Family, EventRecord>> = deepFreeze({
  SESSION_ISSUED: {
    ...base("SESSION_ISSUED", 1),
    ...participantDayManifest,
    issuedAt: "2026-08-03T00:00:01.000Z",
    credentialClass: "DAILY_SESSION",
    sessionStatus: "NOT_STARTED",
  },
  SESSION_STARTED: {
    ...base("SESSION_STARTED", 2),
    ...participantSession,
    startedAt: "2026-08-03T08:01:00.000Z",
    eligibilityVersionId: "eligibility-v4",
    consentVersionId: "consent-v3",
  },
  ROUND_DISPLAYED: {
    ...base("ROUND_DISPLAYED", 3),
    ...participantSession,
    roundId: "round-2",
    contentId: "content-11",
    mode: "language",
    ordinalPosition: 2,
    displayedAt: "2026-08-03T08:02:00.000Z",
    correctionStatus: "ACTIVE",
  },
  CLUE_REVEALED: {
    ...base("CLUE_REVEALED", 4),
    ...participantSession,
    roundId: "round-2",
    clueNumber: 1,
    scoringVersionId: "scoring-v3",
    interactionStatus: "OPEN",
    correctionStatus: "ACTIVE",
  },
  ANSWER_ACCEPTED: {
    ...base("ANSWER_ACCEPTED", 5),
    ...participantSession,
    roundId: "round-2",
    candidateSetVersionId: "candidate-set-v5",
    candidateId: "lang-ts-01",
    candidateCount: 3,
    clueCount: 1,
    mode: "language",
    scoringVersionId: "scoring-v3",
  },
  REVEAL_AUTHORIZED: {
    ...base("REVEAL_AUTHORIZED", 6),
    acceptedAnswerId: "answer-transition-31",
    revealedAt: "2026-08-03T08:02:21.000Z",
    correctness: true,
    evidenceVersionId: "evidence-v8",
    revealVersionId: "reveal-v4",
    authorizationOutcome: "AUTHORIZED",
  },
  REVEAL_DENIED: {
    ...base("REVEAL_DENIED", 7),
    ...participantDayManifest,
    roundId: "round-2",
    deniedAt: "2026-08-03T08:02:21.000Z",
    denialReasonClass: "SCOPE_MISMATCH",
  },
  ROUND_CORRECTED: {
    ...base("ROUND_CORRECTED", 8),
    roundId: "round-2",
    priorCorrectionStatus: "ACTIVE",
    newCorrectionStatus: "VOID",
    correctionVersionId: "correction-v3",
    effectiveAt: "2026-08-03T09:00:00.000Z",
    noticeClass: "SCORE_NEUTRAL_VOID",
    analyticalTreatment: "EXCLUDE_ROUND_ONLY",
  },
  CORRECTION_NOTICE_ACKNOWLEDGED: {
    ...base("CORRECTION_NOTICE_ACKNOWLEDGED", 9),
    participantLineageId: "participant-lineage-17",
    sessionId: "session-23",
    roundId: "round-2",
    correctionVersionId: "correction-v3",
    noticeVersionId: "notice-v2",
    acknowledgedAt: "2026-08-03T09:05:00.000Z",
  },
  SESSION_COMPLETED: {
    ...base("SESSION_COMPLETED", 10),
    ...participantSession,
    completedAt: "2026-08-03T09:30:00.000Z",
    roundCounts: { ACTIVE: 4, VOID: 1, CONTENT_WITHDRAWN: 0 },
    acknowledgementCompleteness: true,
    entertainmentScoreVersionId: "entertainment-score-v2",
  },
  SESSION_EXPIRED: {
    ...base("SESSION_EXPIRED", 11),
    ...participantSession,
    expiredAt: "2026-08-04T01:00:00.000Z",
    lastInteractionStatus: "ANSWERED",
    completedRoundCount: 3,
    denominatorTreatment: "STARTED_INCOMPLETE_INCLUDED",
  },
  CONSENT_OR_WITHDRAWAL_CHANGED: {
    ...base("CONSENT_OR_WITHDRAWAL_CHANGED", 12),
    participantLineageId: "participant-lineage-17",
    priorConsentState: "CONSENTED",
    newConsentState: "WITHDRAWN",
    effectiveAt: "2026-08-03T11:00:00.000Z",
    policyVersionId: "consent-policy-v3",
    analyticalInclusionTransition: { from: "INCLUDED", to: "EXCLUDED" },
    deletionCaseReference: "deletion-case-9",
  },
  CREDENTIAL_CHANGED: {
    ...base("CREDENTIAL_CHANGED", 13),
    participantLineageId: "participant-lineage-17",
    credentialClass: "DAILY_SESSION",
    credentialAction: "ISSUANCE",
    effectiveAt: "2026-08-03T11:10:00.000Z",
    reasonClass: "INITIAL_DAILY_ISSUANCE",
  },
  SURVEY_OFFERED: {
    ...base("SURVEY_OFFERED", 14),
    participantLineageId: "participant-lineage-17",
    instrumentVersionId: "survey-v5",
    offeredAt: "2026-08-03T09:31:00.000Z",
    signedTriggerClass: "SESSION_COMPLETED",
    responseWindowEndsAt: "2026-08-04T09:31:00.000Z",
  },
  SURVEY_SUBMITTED: {
    ...base("SURVEY_SUBMITTED", 15),
    participantLineageId: "participant-lineage-17",
    instrumentVersionId: "survey-v5",
    submittedAt: "2026-08-03T09:35:00.000Z",
    closedResponseIds: ["shared-promise-understood", "return-likely"],
    analyticalInclusionState: "INCLUDED",
  },
  CRITICAL_DEFECT_CHANGED: {
    ...base("CRITICAL_DEFECT_CHANGED", 16),
    defectId: "defect-4",
    defectStatus: "OPENED",
    severity: "CRITICAL",
    affectedScopeId: "language-reveal",
    affectedRequirementId: "AC-006",
    effectiveAt: "2026-08-03T12:00:00.000Z",
    releaseBlockingDecision: "BLOCK",
    ownerId: "operator-data-steward",
  },
  OPERATIONAL_INCIDENT_OR_OUTAGE: {
    ...base("OPERATIONAL_INCIDENT_OR_OUTAGE", 17),
    incidentId: "incident-8",
    incidentVersionId: "incident-v3",
    startedAt: "2026-08-03T13:00:00.000Z",
    severity: "MAJOR",
    affectedScopeId: "manifest-service",
    exclusionTreatment: "PLATFORM_INVALID_PERIOD",
    streakTreatment: "PRESERVE",
    decisionOwnerId: "operator-release",
  },
});

const SPECIFIC_FIELDS: Readonly<Record<Family, readonly string[]>> = deepFreeze({
  SESSION_ISSUED: ["participantLineageId", "betaDay", "manifestLineageId", "manifestVersionId", "issuedAt", "credentialClass", "sessionStatus"],
  SESSION_STARTED: ["participantLineageId", "betaDay", "manifestLineageId", "manifestVersionId", "sessionId", "startedAt", "eligibilityVersionId", "consentVersionId"],
  ROUND_DISPLAYED: ["participantLineageId", "betaDay", "manifestLineageId", "manifestVersionId", "sessionId", "roundId", "contentId", "mode", "ordinalPosition", "displayedAt", "correctionStatus"],
  CLUE_REVEALED: ["participantLineageId", "betaDay", "manifestLineageId", "manifestVersionId", "sessionId", "roundId", "clueNumber", "scoringVersionId", "interactionStatus", "correctionStatus"],
  ANSWER_ACCEPTED: ["participantLineageId", "betaDay", "manifestLineageId", "manifestVersionId", "sessionId", "roundId", "candidateSetVersionId", "candidateId", "candidateCount", "clueCount", "mode", "scoringVersionId"],
  REVEAL_AUTHORIZED: ["acceptedAnswerId", "revealedAt", "correctness", "evidenceVersionId", "revealVersionId", "authorizationOutcome"],
  REVEAL_DENIED: ["participantLineageId", "betaDay", "manifestLineageId", "manifestVersionId", "roundId", "deniedAt", "denialReasonClass"],
  ROUND_CORRECTED: ["roundId", "priorCorrectionStatus", "newCorrectionStatus", "correctionVersionId", "effectiveAt", "noticeClass", "analyticalTreatment"],
  CORRECTION_NOTICE_ACKNOWLEDGED: ["participantLineageId", "sessionId", "roundId", "correctionVersionId", "noticeVersionId", "acknowledgedAt"],
  SESSION_COMPLETED: ["participantLineageId", "betaDay", "manifestLineageId", "manifestVersionId", "sessionId", "completedAt", "roundCounts", "acknowledgementCompleteness", "entertainmentScoreVersionId"],
  SESSION_EXPIRED: ["participantLineageId", "betaDay", "manifestLineageId", "manifestVersionId", "sessionId", "expiredAt", "lastInteractionStatus", "completedRoundCount", "denominatorTreatment"],
  CONSENT_OR_WITHDRAWAL_CHANGED: ["participantLineageId", "priorConsentState", "newConsentState", "effectiveAt", "policyVersionId", "analyticalInclusionTransition", "deletionCaseReference"],
  CREDENTIAL_CHANGED: ["participantLineageId", "credentialClass", "credentialAction", "effectiveAt", "reasonClass"],
  SURVEY_OFFERED: ["participantLineageId", "instrumentVersionId", "offeredAt", "signedTriggerClass", "responseWindowEndsAt"],
  SURVEY_SUBMITTED: ["participantLineageId", "instrumentVersionId", "submittedAt", "closedResponseIds", "analyticalInclusionState"],
  CRITICAL_DEFECT_CHANGED: ["defectId", "defectStatus", "severity", "affectedScopeId", "affectedRequirementId", "effectiveAt", "releaseBlockingDecision", "ownerId"],
  OPERATIONAL_INCIDENT_OR_OUTAGE: ["incidentId", "incidentVersionId", "startedAt", "severity", "affectedScopeId", "exclusionTreatment", "streakTreatment", "decisionOwnerId"],
});

const UNIVERSAL_FIELDS = Object.freeze(["eventId", "eventFamilyId", "schemaVersionId", "acceptedAt"] as const);

const POSSIBLE_SPECIFIC_FIELDS: Readonly<Record<Family, readonly string[]>> = deepFreeze({
  ...SPECIFIC_FIELDS,
  CREDENTIAL_CHANGED: [...SPECIFIC_FIELDS.CREDENTIAL_CHANGED, "predecessorCredentialId", "descendantCredentialIds"],
  OPERATIONAL_INCIDENT_OR_OUTAGE: [...SPECIFIC_FIELDS.OPERATIONAL_INCIDENT_OR_OUTAGE, "endedAt"],
});

const KNOWN_SPECIFIC_FIELD_VALUES: Readonly<Record<string, unknown>> = deepFreeze({
  ...Object.fromEntries(
    Object.values(EVENTS)
      .flatMap((event) => Object.entries(event))
      .filter(([field]) => !UNIVERSAL_FIELDS.includes(field as (typeof UNIVERSAL_FIELDS)[number])),
  ),
  predecessorCredentialId: "credential-prior",
  descendantCredentialIds: ["credential-child-1"],
  endedAt: "2026-08-03T13:15:00.000Z",
});

const clone = (event: EventRecord, changes: Record<string, unknown> = {}): MutableRecord => ({ ...event, ...changes });
const without = (event: EventRecord, field: string): EventRecord => {
  const copy = { ...event };
  delete copy[field];
  return deepFreeze(copy);
};

const FORBIDDEN_KEYS = Object.freeze([
  "code", "raw_code", "source-code", "code snippet", "excerpt",
  "prompt", "system_prompt", "question-prompt",
  "free_text", "free-form-text", "comment_text", "message-text", "feedback text", "open_response",
  "ip_derived_fingerprint", "ip-fingerprint", "network fingerprint",
  "full_user_agent", "user-agent", "user agent string",
  "secret", "raw_token", "access-token", "refresh token", "credential_token", "anti-forgery-token", "cookie", "authorization_header", "password",
  "recruitment_identity", "recruitment-identity-id", "recruitment email", "invitee_email", "recruitment-name", "invitation recipient", "recruitment_bridge_id",
] as const);

describe("authoritative event schema", () => {
  it("registers exactly the seventeen frozen event families and schema version", () => {
    expect(AUTHORITATIVE_EVENT_SCHEMA_VERSION).toBe("authoritative-events-v1");
    expect(AUTHORITATIVE_EVENT_FAMILIES).toEqual(FAMILIES);
    expect(new Set(AUTHORITATIVE_EVENT_FAMILIES)).toHaveProperty("size", 17);
    expect(Object.isFrozen(AUTHORITATIVE_EVENT_FAMILIES)).toBe(true);
  });

  it.each(FAMILIES)("parses and detaches a recursively frozen %s event", (family) => {
    const input = EVENTS[family];
    const parsed = parseAuthoritativeEvent(input);
    expect(parsed).toEqual(input);
    expect(parsed).not.toBe(input);
    expect(recursivelyFrozen(parsed)).toBe(true);
    for (const field of Object.keys(parsed)) {
      expect(["eventId", "eventFamilyId", "schemaVersionId", "acceptedAt", ...SPECIFIC_FIELDS[family]]).toContain(field);
    }
  });

  it.each(FAMILIES)("rejects missing and placeholder values for every required %s field", (family) => {
    for (const field of [...UNIVERSAL_FIELDS, ...SPECIFIC_FIELDS[family]]) {
      expect(() => parseAuthoritativeEvent(without(EVENTS[family], field))).toThrow();
      expect(() => parseAuthoritativeEvent(deepFreeze({ ...EVENTS[family], [field]: null }))).toThrow();
      expect(() => parseAuthoritativeEvent(deepFreeze({ ...EVENTS[family], [field]: undefined }))).toThrow();
    }
  });

  it.each(FAMILIES)("rejects unknown fields on %s", (family) => {
    expect(() => parseAuthoritativeEvent(deepFreeze({ ...EVENTS[family], guessedScopeId: "guessed" }))).toThrow(/field|shape|unknown|inapplicable/i);
  });

  it.each(FAMILIES)("rejects every known field outside the exact %s whitelist", (family) => {
    for (const [field, value] of Object.entries(KNOWN_SPECIFIC_FIELD_VALUES)) {
      if (POSSIBLE_SPECIFIC_FIELDS[family].includes(field)) continue;
      for (const inapplicableValue of [value, null, undefined]) {
        expect(() => parseAuthoritativeEvent(deepFreeze({ ...EVENTS[family], [field]: inapplicableValue }))).toThrow(/field|shape|unknown|inapplicable|protected|denial/i);
      }
    }
  });

  it.each(FAMILIES)("rejects mutable %s event roots", (family) => {
    expect(() => parseAuthoritativeEvent({ ...EVENTS[family] })).toThrow(/frozen|immutable|boundary/i);
  });

  it.each(FAMILIES)("rejects substituting the %s discriminator onto another family shape", (family) => {
    const next = FAMILIES[(FAMILIES.indexOf(family) + 1) % FAMILIES.length]!;
    expect(() => parseAuthoritativeEvent(deepFreeze({ ...EVENTS[family], eventFamilyId: next }))).toThrow(/family|field|shape/i);
  });

  it("rejects an unknown event family discriminator", () => {
    expect(() => parseAuthoritativeEvent(deepFreeze({ ...EVENTS.SESSION_ISSUED, eventFamilyId: "UNKNOWN_FAMILY" }))).toThrow(/family|discriminator|event/i);
  });

  it.each(["", " ", "other-schema", "authoritative-events-v2"])("rejects unregistered schema version %j", (schemaVersionId) => {
    expect(() => parseAuthoritativeEvent(deepFreeze(clone(EVENTS.SESSION_ISSUED, { schemaVersionId })))).toThrow(/schema|version/i);
  });

  it.each([
    "2026-08-03T10:00:00Z",
    "2026-08-03T11:00:00.000+01:00",
    "2026-08-03 10:00:00.000Z",
    "invalid",
  ])("rejects noncanonical UTC acceptance time %j", (acceptedAt) => {
    expect(() => parseAuthoritativeEvent(deepFreeze(clone(EVENTS.SESSION_ISSUED, { acceptedAt })))).toThrow(/time|utc|instant/i);
  });

  it.each([
    "2026-02-30",
    "2026-8-03",
    "2026-08-03T00:00:00Z",
    "invalid",
  ])("rejects invalid beta day %j", (betaDay) => {
    expect(() => parseAuthoritativeEvent(deepFreeze(clone(EVENTS.SESSION_ISSUED, { betaDay })))).toThrow(/beta|day|date/i);
  });

  it("requires every family-specific time to be canonical UTC", () => {
    for (const family of FAMILIES) {
      for (const field of Object.keys(EVENTS[family]).filter((key) => key.endsWith("At"))) {
        expect(() => parseAuthoritativeEvent(deepFreeze(clone(EVENTS[family], { [field]: "2026-08-03T11:00:00+01:00" })))).toThrow(/time|utc|instant/i);
      }
    }
  });

  it.each([
    ["ROUND_DISPLAYED", "mode", "country"],
    ["ROUND_DISPLAYED", "ordinalPosition", 0],
    ["ROUND_DISPLAYED", "ordinalPosition", 6],
    ["ROUND_DISPLAYED", "ordinalPosition", 1.5],
    ["ROUND_DISPLAYED", "correctionStatus", "CORRECTED"],
    ["CLUE_REVEALED", "clueNumber", 0],
    ["CLUE_REVEALED", "clueNumber", 3],
    ["CLUE_REVEALED", "clueNumber", 1.5],
    ["CLUE_REVEALED", "interactionStatus", "CLOSED"],
    ["ANSWER_ACCEPTED", "candidateCount", 0],
    ["ANSWER_ACCEPTED", "candidateCount", 1.5],
    ["ANSWER_ACCEPTED", "clueCount", -1],
    ["ANSWER_ACCEPTED", "clueCount", 3],
    ["ANSWER_ACCEPTED", "clueCount", 1.5],
    ["REVEAL_AUTHORIZED", "authorizationOutcome", "DENIED"],
    ["REVEAL_AUTHORIZED", "correctness", "true"],
    ["REVEAL_DENIED", "denialReasonClass", "UNKNOWN"],
    ["ROUND_CORRECTED", "priorCorrectionStatus", "VOID"],
    ["ROUND_CORRECTED", "newCorrectionStatus", "ACTIVE"],
    ["SESSION_EXPIRED", "completedRoundCount", -1],
    ["SESSION_EXPIRED", "completedRoundCount", 6],
    ["SESSION_EXPIRED", "completedRoundCount", 1.5],
    ["CREDENTIAL_CHANGED", "credentialClass", "COOKIE"],
    ["CREDENTIAL_CHANGED", "credentialAction", "ROTATION"],
    ["SURVEY_SUBMITTED", "analyticalInclusionState", "REMOVED"],
    ["CRITICAL_DEFECT_CHANGED", "defectStatus", "CLOSED"],
  ] as const)("rejects invalid %s.%s value", (family, field, value) => {
    expect(() => parseAuthoritativeEvent(deepFreeze(clone(EVENTS[family], { [field]: value })))).toThrow(/value|enum|count|position|status|mode|outcome|reason|boolean/i);
  });

  it.each(["sessionStatus", "lastInteractionStatus"] as const)("rejects invalid session/interaction %s", (field) => {
    const family = field === "sessionStatus" ? "SESSION_ISSUED" : "SESSION_EXPIRED";
    expect(() => parseAuthoritativeEvent(deepFreeze(clone(EVENTS[family], { [field]: "UNKNOWN" })))).toThrow(/status|value|enum/i);
  });

  it.each([
    ["SESSION_ISSUED", "sessionStatus"],
    ["SESSION_ISSUED", "credentialClass"],
    ["ROUND_DISPLAYED", "mode"],
    ["ROUND_DISPLAYED", "correctionStatus"],
    ["CLUE_REVEALED", "interactionStatus"],
    ["CLUE_REVEALED", "correctionStatus"],
    ["ANSWER_ACCEPTED", "mode"],
    ["REVEAL_AUTHORIZED", "authorizationOutcome"],
    ["REVEAL_DENIED", "denialReasonClass"],
    ["ROUND_CORRECTED", "priorCorrectionStatus"],
    ["ROUND_CORRECTED", "newCorrectionStatus"],
    ["SESSION_EXPIRED", "lastInteractionStatus"],
    ["CREDENTIAL_CHANGED", "credentialClass"],
    ["CREDENTIAL_CHANGED", "credentialAction"],
    ["SURVEY_SUBMITTED", "analyticalInclusionState"],
    ["CRITICAL_DEFECT_CHANGED", "defectStatus"],
  ] as const)("rejects an unknown value on every enum field %s.%s", (family, field) => {
    expect(() => parseAuthoritativeEvent(deepFreeze(clone(EVENTS[family], { [field]: "UNKNOWN" })))).toThrow(/value|enum|status|mode|outcome|reason|class|action/i);
  });

  it("accepts every registered denial reason", () => {
    for (const denialReasonClass of ["NOT_READY", "EXPIRED", "REPLAYED", "SCOPE_MISMATCH", "GUARD_REJECTED", "ROUND_BLOCKED", "PAYLOAD_REJECTED"]) {
      expect(parseAuthoritativeEvent(deepFreeze(clone(EVENTS.REVEAL_DENIED, { denialReasonClass })))).toMatchObject({ denialReasonClass });
    }
  });

  it("accepts both modes on every mode-bearing family", () => {
    for (const family of ["ROUND_DISPLAYED", "ANSWER_ACCEPTED"] as const) {
      for (const mode of ["provenance", "language"]) {
        expect(parseAuthoritativeEvent(deepFreeze(clone(EVENTS[family], { mode })))).toMatchObject({ mode });
      }
    }
  });

  it("accepts every session, interaction and correction status where allowed", () => {
    for (const sessionStatus of ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "EXPIRED", "WITHDRAWN"]) {
      expect(parseAuthoritativeEvent(deepFreeze(clone(EVENTS.SESSION_ISSUED, { sessionStatus })))).toMatchObject({ sessionStatus });
    }
    for (const interactionStatus of ["UNSEEN", "OPEN", "ANSWERED", "REVEALED"]) {
      expect(parseAuthoritativeEvent(deepFreeze(clone(EVENTS.CLUE_REVEALED, { interactionStatus })))).toMatchObject({ interactionStatus });
      expect(parseAuthoritativeEvent(deepFreeze(clone(EVENTS.SESSION_EXPIRED, { lastInteractionStatus: interactionStatus })))).toMatchObject({ lastInteractionStatus: interactionStatus });
    }
    for (const correctionStatus of ["ACTIVE", "VOID", "CONTENT_WITHDRAWN"]) {
      expect(parseAuthoritativeEvent(deepFreeze(clone(EVENTS.ROUND_DISPLAYED, { correctionStatus })))).toMatchObject({ correctionStatus });
      expect(parseAuthoritativeEvent(deepFreeze(clone(EVENTS.CLUE_REVEALED, { correctionStatus })))).toMatchObject({ correctionStatus });
    }
    for (const newCorrectionStatus of ["VOID", "CONTENT_WITHDRAWN"]) {
      expect(parseAuthoritativeEvent(deepFreeze(clone(EVENTS.ROUND_CORRECTED, { newCorrectionStatus })))).toMatchObject({ newCorrectionStatus });
    }
  });

  it("accepts both correctness booleans, every analysis state and both defect states", () => {
    for (const correctness of [true, false]) {
      expect(parseAuthoritativeEvent(deepFreeze(clone(EVENTS.REVEAL_AUTHORIZED, { correctness })))).toMatchObject({ correctness });
    }
    for (const analyticalInclusionState of ["PENDING", "INCLUDED", "EXCLUDED"]) {
      expect(parseAuthoritativeEvent(deepFreeze(clone(EVENTS.SURVEY_SUBMITTED, { analyticalInclusionState })))).toMatchObject({ analyticalInclusionState });
      const from = deepFreeze(clone(EVENTS.CONSENT_OR_WITHDRAWAL_CHANGED, {
        analyticalInclusionTransition: { from: analyticalInclusionState, to: "EXCLUDED" },
      }));
      const to = deepFreeze(clone(EVENTS.CONSENT_OR_WITHDRAWAL_CHANGED, {
        analyticalInclusionTransition: { from: "INCLUDED", to: analyticalInclusionState },
      }));
      expect(parseAuthoritativeEvent(from)).toMatchObject({ analyticalInclusionTransition: { from: analyticalInclusionState } });
      expect(parseAuthoritativeEvent(to)).toMatchObject({ analyticalInclusionTransition: { to: analyticalInclusionState } });
    }
    for (const defectStatus of ["OPENED", "RESOLVED"]) {
      expect(parseAuthoritativeEvent(deepFreeze(clone(EVENTS.CRITICAL_DEFECT_CHANGED, { defectStatus })))).toMatchObject({ defectStatus });
    }
  });

  it("rejects blank identifiers, versions, classes, treatments and owners", () => {
    for (const family of FAMILIES) {
      for (const [field, value] of Object.entries(EVENTS[family])) {
        if (typeof value === "string" && !field.endsWith("At") && field !== "betaDay") {
          expect(() => parseAuthoritativeEvent(deepFreeze(clone(EVENTS[family], { [field]: " " })))).toThrow();
        }
      }
    }
  });

  it("requires correctness and acknowledgement completeness to be boolean", () => {
    expect(() => parseAuthoritativeEvent(deepFreeze(clone(EVENTS.REVEAL_AUTHORIZED, { correctness: 1 })))).toThrow(/boolean|correctness/i);
    expect(() => parseAuthoritativeEvent(deepFreeze(clone(EVENTS.SESSION_COMPLETED, { acknowledgementCompleteness: "true" })))).toThrow(/boolean|acknowledgement/i);
  });

  it("enforces exact round-count shape, nonnegative integers and five-round total", () => {
    for (const roundCounts of [
      { ACTIVE: 4, VOID: 1 },
      { ACTIVE: 4, VOID: 1, CONTENT_WITHDRAWN: 0, extra: 0 },
      { ACTIVE: 4, VOID: -1, CONTENT_WITHDRAWN: 2 },
      { ACTIVE: 4.5, VOID: 0.5, CONTENT_WITHDRAWN: 0 },
      { ACTIVE: 3, VOID: 1, CONTENT_WITHDRAWN: 0 },
    ]) {
      expect(() => parseAuthoritativeEvent(deepFreeze(clone(EVENTS.SESSION_COMPLETED, { roundCounts })))).toThrow(/round|count|field|integer|five/i);
    }
  });

  it("rejects mutable nested transition, count and response boundaries", () => {
    const transition = { from: "INCLUDED", to: "EXCLUDED" };
    expect(() => parseAuthoritativeEvent(Object.freeze(clone(EVENTS.CONSENT_OR_WITHDRAWAL_CHANGED, { analyticalInclusionTransition: transition })))).toThrow(/frozen|boundary/i);
    const roundCounts = { ACTIVE: 4, VOID: 1, CONTENT_WITHDRAWN: 0 };
    expect(() => parseAuthoritativeEvent(Object.freeze(clone(EVENTS.SESSION_COMPLETED, { roundCounts })))).toThrow(/frozen|boundary/i);
    const closedResponseIds = ["response-one"];
    expect(() => parseAuthoritativeEvent(Object.freeze(clone(EVENTS.SURVEY_SUBMITTED, { closedResponseIds })))).toThrow(/frozen|boundary/i);
  });

  it("enforces withdrawal deletion-reference presence and non-withdrawal absence", () => {
    expect(() => parseAuthoritativeEvent(without(EVENTS.CONSENT_OR_WITHDRAWAL_CHANGED, "deletionCaseReference"))).toThrow(/deletion|withdraw/i);
    const continued = deepFreeze({
      ...EVENTS.CONSENT_OR_WITHDRAWAL_CHANGED,
      eventId: "event-consent-continued",
      newConsentState: "CONSENTED",
      analyticalInclusionTransition: { from: "PENDING", to: "INCLUDED" },
    });
    expect(() => parseAuthoritativeEvent(continued)).toThrow(/deletion|field|inapplicable/i);
    expect(parseAuthoritativeEvent(without(continued, "deletionCaseReference"))).not.toHaveProperty("deletionCaseReference");
  });

  it("enforces exact analytical-transition states and shape", () => {
    for (const transition of [
      { from: "REMOVED", to: "EXCLUDED" },
      { from: "INCLUDED", to: "REMOVED" },
      { from: "INCLUDED" },
      { from: "INCLUDED", to: "EXCLUDED", reason: "withdrawal" },
    ]) {
      expect(() => parseAuthoritativeEvent(deepFreeze(clone(EVENTS.CONSENT_OR_WITHDRAWAL_CHANGED, { analyticalInclusionTransition: transition })))).toThrow(/analysis|transition|state|field/i);
    }
  });

  it("enforces exact conditional credential relationships", () => {
    expect(parseAuthoritativeEvent(EVENTS.CREDENTIAL_CHANGED)).not.toHaveProperty("predecessorCredentialId");
    expect(parseAuthoritativeEvent(EVENTS.CREDENTIAL_CHANGED)).not.toHaveProperty("descendantCredentialIds");
    const reissue = deepFreeze({
      ...EVENTS.CREDENTIAL_CHANGED,
      eventId: "event-reissue",
      credentialAction: "REISSUE",
      predecessorCredentialId: "credential-prior",
    });
    expect(parseAuthoritativeEvent(reissue)).toMatchObject({ credentialAction: "REISSUE", predecessorCredentialId: "credential-prior" });
    expect(() => parseAuthoritativeEvent(without(reissue, "predecessorCredentialId"))).toThrow(/predecessor|reissue/i);
    expect(() => parseAuthoritativeEvent(deepFreeze({ ...reissue, predecessorCredentialId: null }))).toThrow();
    expect(() => parseAuthoritativeEvent(deepFreeze({ ...reissue, predecessorCredentialId: undefined }))).toThrow();
    const revocation = deepFreeze({
      ...EVENTS.CREDENTIAL_CHANGED,
      eventId: "event-revocation",
      credentialAction: "REVOCATION",
      descendantCredentialIds: ["credential-child-1", "credential-child-2"],
    });
    expect(parseAuthoritativeEvent(revocation)).toMatchObject({ credentialAction: "REVOCATION" });
    expect(() => parseAuthoritativeEvent(without(revocation, "descendantCredentialIds"))).toThrow(/descendant|revocation/i);
    expect(() => parseAuthoritativeEvent(deepFreeze({ ...revocation, descendantCredentialIds: null }))).toThrow();
    expect(() => parseAuthoritativeEvent(deepFreeze({ ...revocation, descendantCredentialIds: undefined }))).toThrow();
    expect(() => parseAuthoritativeEvent(deepFreeze({ ...revocation, descendantCredentialIds: "credential-child-1" }))).toThrow(/descendant|array/i);
    expect(() => parseAuthoritativeEvent(deepFreeze({ ...revocation, descendantCredentialIds: [""] }))).toThrow(/descendant|blank|nonblank/i);
    expect(() => parseAuthoritativeEvent(deepFreeze({ ...revocation, descendantCredentialIds: ["duplicate", "duplicate"] }))).toThrow(/descendant|distinct/i);
    expect(() => parseAuthoritativeEvent(deepFreeze({ ...EVENTS.CREDENTIAL_CHANGED, predecessorCredentialId: "unexpected" }))).toThrow(/field|relationship|inapplicable/i);
    expect(() => parseAuthoritativeEvent(deepFreeze({ ...EVENTS.CREDENTIAL_CHANGED, descendantCredentialIds: ["unexpected"] }))).toThrow(/field|relationship|inapplicable/i);
    expect(() => parseAuthoritativeEvent(deepFreeze({ ...reissue, descendantCredentialIds: ["unexpected"] }))).toThrow(/field|relationship|inapplicable/i);
    expect(() => parseAuthoritativeEvent(deepFreeze({ ...revocation, predecessorCredentialId: "unexpected" }))).toThrow(/field|relationship|inapplicable/i);
    const mutableDescendants = ["credential-child-1"];
    expect(() => parseAuthoritativeEvent(Object.freeze({ ...revocation, descendantCredentialIds: mutableDescendants }))).toThrow(/frozen|boundary/i);
  });

  it("accepts every credential class and action with its exact conditional shape", () => {
    for (const credentialClass of ["ENROLLMENT", "DAILY_SESSION", "REVEAL"]) {
      expect(parseAuthoritativeEvent(deepFreeze(clone(EVENTS.SESSION_ISSUED, { credentialClass })))).toMatchObject({ credentialClass });
      expect(parseAuthoritativeEvent(deepFreeze(clone(EVENTS.CREDENTIAL_CHANGED, { credentialClass })))).toMatchObject({ credentialClass });
    }
    expect(parseAuthoritativeEvent(EVENTS.CREDENTIAL_CHANGED)).toMatchObject({ credentialAction: "ISSUANCE" });
    const reissue = deepFreeze({
      ...EVENTS.CREDENTIAL_CHANGED,
      eventId: "event-valid-reissue",
      credentialAction: "REISSUE",
      predecessorCredentialId: "credential-prior",
    });
    const revocation = deepFreeze({
      ...EVENTS.CREDENTIAL_CHANGED,
      eventId: "event-valid-revocation",
      credentialAction: "REVOCATION",
      descendantCredentialIds: ["credential-child-1"],
    });
    expect(parseAuthoritativeEvent(reissue)).toMatchObject({ credentialAction: "REISSUE" });
    expect(parseAuthoritativeEvent(revocation)).toMatchObject({ credentialAction: "REVOCATION" });
  });

  it("keeps incident end time absent while open and permits it only on an ended version", () => {
    expect(parseAuthoritativeEvent(EVENTS.OPERATIONAL_INCIDENT_OR_OUTAGE)).not.toHaveProperty("endedAt");
    const ended = deepFreeze({
      ...EVENTS.OPERATIONAL_INCIDENT_OR_OUTAGE,
      eventId: "event-incident-ended",
      incidentVersionId: "incident-v4",
      endedAt: "2026-08-03T13:15:00.000Z",
    });
    expect(parseAuthoritativeEvent(ended)).toMatchObject({ endedAt: "2026-08-03T13:15:00.000Z" });
    expect(() => parseAuthoritativeEvent(deepFreeze({ ...ended, endedAt: null }))).toThrow();
    expect(() => parseAuthoritativeEvent(deepFreeze({ ...ended, endedAt: undefined }))).toThrow();
    expect(() => parseAuthoritativeEvent(deepFreeze({ ...ended, endedAt: "2026-08-03T14:00:00+01:00" }))).toThrow(/time|utc|instant/i);
    expect(() => parseAuthoritativeEvent(deepFreeze({ ...ended, endedAt: "2026-08-03T12:59:59.999Z" }))).toThrow(/end|start|time|order/i);
  });

  it("requires closed response IDs to be frozen, nonblank and distinct", () => {
    for (const closedResponseIds of [[], [""], ["same", "same"], ["this is an open response sentence"]]) {
      expect(() => parseAuthoritativeEvent(deepFreeze(clone(EVENTS.SURVEY_SUBMITTED, { closedResponseIds })))).toThrow(/response|distinct|nonblank/i);
    }
  });

  it.each([
    ["ROUND_CORRECTED", "noticeClass"],
    ["ROUND_CORRECTED", "analyticalTreatment"],
    ["SESSION_EXPIRED", "denominatorTreatment"],
    ["CREDENTIAL_CHANGED", "reasonClass"],
    ["SURVEY_OFFERED", "signedTriggerClass"],
    ["CRITICAL_DEFECT_CHANGED", "severity"],
    ["CRITICAL_DEFECT_CHANGED", "releaseBlockingDecision"],
    ["CRITICAL_DEFECT_CHANGED", "ownerId"],
    ["OPERATIONAL_INCIDENT_OR_OUTAGE", "exclusionTreatment"],
    ["OPERATIONAL_INCIDENT_OR_OUTAGE", "streakTreatment"],
    ["OPERATIONAL_INCIDENT_OR_OUTAGE", "decisionOwnerId"],
  ] as const)("rejects prose where %s.%s requires a stable identifier", (family, field) => {
    expect(() => parseAuthoritativeEvent(deepFreeze(clone(EVENTS[family], { [field]: "this is an unregistered prose sentence" })))).toThrow(/identifier|class|treatment|owner|value|format/i);
  });

  it.each(Object.entries({
    acceptedAnswerId: "answer-transition-31",
    candidateId: "lang-ts-01",
    candidateCount: 3,
    clueCount: 1,
    correctness: true,
    evidenceVersionId: "evidence-v8",
    revealVersionId: "reveal-v4",
    authorizationOutcome: "AUTHORIZED",
    answer: "language",
    answerData: { candidateId: "lang-ts-01" },
    evidence: { evidenceVersionId: "evidence-v8" },
    reveal: { revealVersionId: "reveal-v4" },
    payload: { roundId: "round-2" },
    signals: ["signal-1"],
    sessionId: "session-23",
    contentId: "content-11",
    candidateSetVersionId: "candidate-set-v5",
    scoringVersionId: "scoring-v3",
    correctionVersionId: "correction-v3",
    rulesVersionId: "rules-v2",
  }))("rejects protected reveal-denial field %s", (field, value) => {
    expect(() => parseAuthoritativeEvent(deepFreeze({ ...EVENTS.REVEAL_DENIED, [field]: value }))).toThrow(/denial|protected|field|shape/i);
  });

  it.each(FORBIDDEN_KEYS)("rejects recursively normalized forbidden telemetry key %j", (field) => {
    expect(() => assertNoForbiddenTelemetry(deepFreeze({ safe: [{ nested: { [field]: "value" } }] }))).toThrow(/forbidden|telemetry|field/i);
  });

  it.each(["RAW_CODE", "Full_User_Agent", "Recruitment-Email", "ＲＡＷ＿ＣＯＤＥ"])("normalizes case, separators and NFKC before rejecting telemetry key %j", (field) => {
    expect(() => assertNoForbiddenTelemetry(deepFreeze({ safe: { [field]: "value" } }))).toThrow(/forbidden|telemetry|field/i);
  });

  it.each(["raw.code", "raw/code", "system:prompt", "raw\u2060code"])("rejects punctuation- and format-obfuscated telemetry key %j", (field) => {
    expect(() => assertNoForbiddenTelemetry(deepFreeze({ safe: { [field]: "value" } }))).toThrow(/forbidden|telemetry|field/i);
  });

  it("applies forbidden telemetry scanning while parsing event roots and allowed nested objects", () => {
    expect(() => parseAuthoritativeEvent(deepFreeze({ ...EVENTS.SESSION_ISSUED, RAW_CODE: "value" }))).toThrow(/forbidden|telemetry/i);
    expect(() => parseAuthoritativeEvent(deepFreeze({
      ...EVENTS.SESSION_COMPLETED,
      roundCounts: { ...EVENTS.SESSION_COMPLETED.roundCounts as Record<string, unknown>, "System-PROMPT": "value" },
    }))).toThrow(/forbidden|telemetry/i);
  });

  it.each(["text", "message", "name", "credential", "token", "authorization", "ip", "fingerprint", "ua"])("does not overblock generic metadata key %j", (field) => {
    expect(() => assertNoForbiddenTelemetry(deepFreeze({ [field]: "raw code may appear in a value" }))).not.toThrow();
  });

  it("accepts distinct IDs of the same family and rejects duplicate event IDs globally", () => {
    const second = deepFreeze({ ...EVENTS.SESSION_ISSUED, eventId: "event-second-issuance" });
    const batch = Object.freeze([EVENTS.SESSION_ISSUED, second]);
    const accepted = parseAuthoritativeEventBatch(batch);
    expect(accepted).toHaveLength(2);
    expect(recursivelyFrozen(accepted)).toBe(true);
    expect(accepted).not.toBe(batch);
    expect(accepted[0]).not.toBe(EVENTS.SESSION_ISSUED);
    expect(accepted[1]).not.toBe(second);
    expect(() => parseAuthoritativeEventBatch(Object.freeze([EVENTS.SESSION_ISSUED, EVENTS.SESSION_STARTED, deepFreeze({ ...second, eventId: EVENTS.SESSION_ISSUED.eventId })]))).toThrow(/duplicate|eventId/i);
  });

  it("rejects mutable event batches and mutable entries", () => {
    expect(() => parseAuthoritativeEventBatch([EVENTS.SESSION_ISSUED])).toThrow(/batch|frozen|boundary/i);
    expect(() => parseAuthoritativeEventBatch(Object.freeze([{ ...EVENTS.SESSION_ISSUED }]))).toThrow(/event|frozen|boundary/i);
  });

  it("detaches nested accepted objects and arrays", () => {
    const completed = parseAuthoritativeEvent(EVENTS.SESSION_COMPLETED) as ParsedEvent<"SESSION_COMPLETED">;
    const consent = parseAuthoritativeEvent(EVENTS.CONSENT_OR_WITHDRAWAL_CHANGED) as ParsedEvent<"CONSENT_OR_WITHDRAWAL_CHANGED">;
    const submitted = parseAuthoritativeEvent(EVENTS.SURVEY_SUBMITTED) as ParsedEvent<"SURVEY_SUBMITTED">;
    const revocation = deepFreeze({
      ...EVENTS.CREDENTIAL_CHANGED,
      eventId: "event-detached-revocation",
      credentialAction: "REVOCATION",
      descendantCredentialIds: ["credential-child-1"],
    });
    const parsedRevocation = parseAuthoritativeEvent(revocation) as ParsedEvent<"CREDENTIAL_CHANGED">;
    expect(completed.roundCounts).not.toBe(EVENTS.SESSION_COMPLETED.roundCounts);
    expect(consent.analyticalInclusionTransition).not.toBe(EVENTS.CONSENT_OR_WITHDRAWAL_CHANGED.analyticalInclusionTransition);
    expect(submitted.closedResponseIds).not.toBe(EVENTS.SURVEY_SUBMITTED.closedResponseIds);
    expect(parsedRevocation.descendantCredentialIds).not.toBe(revocation.descendantCredentialIds);
    expect(recursivelyFrozen(parsedRevocation.descendantCredentialIds)).toBe(true);
  });
});
