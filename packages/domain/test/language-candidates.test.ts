import { describe, expect, it } from "vitest";

import {
  LanguageCandidateSetRuleError,
  createLanguageCandidatePresentation,
  createLanguageCandidateSet,
  normalizeLanguageAlias,
  resolveLanguageCandidateId,
} from "../src/language/index.js";

const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
};

const expectDeepFrozen = (value: unknown): void => {
  if (!value || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value)) expectDeepFrozen(nested);
};

const candidateInput = (orderingKind: "deterministic" | "randomized" = "deterministic") =>
  deepFreeze({
    versionId: "language-set-v1",
    presentedCandidateCount: 4,
    correctCandidateId: "typescript",
    candidates: [
      {
        id: "typescript",
        canonicalLabel: "TypeScript",
        aliases: [" TS ", "Type\u00a0Script"],
        distractorRationale: null,
      },
      {
        id: "javascript",
        canonicalLabel: "JavaScript",
        aliases: ["JS", "ECMAScript"],
        distractorRationale: "Its syntax is similar, but the excerpt uses a type-only construct.",
      },
      {
        id: "kotlin",
        canonicalLabel: "Kotlin",
        aliases: ["KT"],
        distractorRationale: "The declaration style is plausible, but the type syntax differs.",
      },
      {
        id: "swift",
        canonicalLabel: "Swift",
        aliases: ["SwiftLang"],
        distractorRationale: "The annotations look similar, but the generic syntax differs.",
      },
    ],
    orderingPolicy: {
      versionId: "language-order-policy-v1",
      kind: orderingKind,
    },
    clueSetVersionId: "language-clues-v1",
    cluePolicyVersionId: "two-progressive-clues-v1",
    scoringVersionId: "beta-scoring-v1",
    clues: [
      { clueId: "clue-1", clueVersionId: "language-clue-1-v1", order: 1 },
      { clueId: "clue-2", clueVersionId: "language-clue-2-v1", order: 2 },
    ],
    calibration: {
      versionId: "language-calibration-v1",
      candidateSetVersionId: "language-set-v1",
      presentedCandidateCount: 4,
      chanceBaseline: 0.25,
      cluePolicyVersionId: "two-progressive-clues-v1",
      configuredClueCount: 2,
      scoringVersionId: "beta-scoring-v1",
    },
  });

const changed = (field: string, value: unknown) => {
  const input = candidateInput();
  return deepFreeze({ ...input, [field]: value });
};

const changedCalibration = (field: string, value: unknown) => {
  const input = candidateInput();
  return deepFreeze({
    ...input,
    calibration: { ...input.calibration, [field]: value },
  });
};

const withClueCount = (count: 0 | 1 | 2) => {
  const input = candidateInput();
  return deepFreeze({
    ...input,
    clues: input.clues.slice(0, count),
    calibration: { ...input.calibration, configuredClueCount: count },
  });
};

const threeCandidateInput = () => {
  const input = candidateInput();
  return deepFreeze({
    ...input,
    presentedCandidateCount: 3,
    candidates: input.candidates.slice(0, 3),
    calibration: {
      ...input.calibration,
      presentedCandidateCount: 3,
      chanceBaseline: 1 / 3,
    },
  });
};

const deterministicRecord = () => deepFreeze({
  recordId: "order-record-1",
  sessionId: "session-1",
  candidateSetVersionId: "language-set-v1",
  policyVersionId: "language-order-policy-v1",
  kind: "deterministic",
  presentedCandidateIds: ["typescript", "javascript", "kotlin", "swift"],
});

const randomizedRecord = () => deepFreeze({
  recordId: "order-record-2",
  sessionId: "session-2",
  candidateSetVersionId: "language-set-v1",
  policyVersionId: "language-order-policy-v1",
  kind: "randomized",
  presentedCandidateIds: ["swift", "typescript", "kotlin", "javascript"],
  randomizationRecordId: "randomization-2",
  recordedAt: "2026-09-01T12:00:00.000Z",
});

const frozenCandidateSetLookalike = () => {
  const candidateSet = createLanguageCandidateSet(candidateInput());
  return deepFreeze({
    ...candidateSet,
    candidates: candidateSet.candidates.map((candidate) => ({
      ...candidate,
      aliases: [...candidate.aliases],
    })),
    orderingPolicy: { ...candidateSet.orderingPolicy },
    clues: candidateSet.clues.map((clue) => ({ ...clue })),
    calibration: { ...candidateSet.calibration },
  });
};

describe("language candidate sets", () => {
  it("copies a complete version into a recursively immutable value", () => {
    const input = candidateInput();
    const candidateSet = createLanguageCandidateSet(input);

    expect(candidateSet).not.toBe(input);
    expect(candidateSet).toMatchObject({
      versionId: "language-set-v1",
      presentedCandidateCount: 4,
      correctCandidateId: "typescript",
    });
    expect(candidateSet.candidates).toHaveLength(4);
    expect(candidateSet.candidates.filter(({ id }) => id === candidateSet.correctCandidateId)).toHaveLength(1);
    expect(candidateSet.candidates.filter(({ id }) => id !== candidateSet.correctCandidateId)
      .every(({ distractorRationale }) => (distractorRationale ?? "").trim().length > 0)).toBe(true);
    expect(candidateSet.candidates).not.toBe(input.candidates);
    expect(candidateSet.candidates[0]).not.toBe(input.candidates[0]);
    expect(candidateSet.candidates[0]?.aliases).not.toBe(input.candidates[0]?.aliases);
    expect(candidateSet.orderingPolicy).not.toBe(input.orderingPolicy);
    expect(candidateSet.clues).not.toBe(input.clues);
    expect(candidateSet.clues[0]).not.toBe(input.clues[0]);
    expect(candidateSet.calibration).not.toBe(input.calibration);
    expectDeepFrozen(candidateSet);
  });

  it("normalizes aliases and resolves both aliases and canonical labels", () => {
    const candidateSet = createLanguageCandidateSet(candidateInput());

    expect(normalizeLanguageAlias("  \uff34\uff33  ")).toBe("ts");
    expect(candidateSet.candidates[0]?.aliases).toEqual(["ts", "type script"]);
    expect(resolveLanguageCandidateId(candidateSet, " ECMAScript ")).toBe("javascript");
    expect(resolveLanguageCandidateId(candidateSet, "TypeScript")).toBe("typescript");
    expect(() => resolveLanguageCandidateId(candidateSet, "Ruby")).toThrow(LanguageCandidateSetRuleError);
  });

  it("accepts factory-certified candidate sets across downstream operations", () => {
    const candidateSet = createLanguageCandidateSet(candidateInput());

    expect(resolveLanguageCandidateId(candidateSet, "TypeScript")).toBe("typescript");
    expect(createLanguageCandidatePresentation(candidateSet, deterministicRecord()).candidateIds)
      .toEqual(["typescript", "javascript", "kotlin", "swift"]);
  });

  it.each([
    ["mutable structural clone", () => ({ ...createLanguageCandidateSet(candidateInput()) })],
    ["recursively frozen structural lookalike", frozenCandidateSetLookalike],
  ])("rejects an uncertified %s during alias resolution", (_name, makeCandidateSet) => {
    expect(() => resolveLanguageCandidateId(makeCandidateSet(), "TypeScript"))
      .toThrow(LanguageCandidateSetRuleError);
  });

  it.each([
    ["mutable structural clone", () => ({ ...createLanguageCandidateSet(candidateInput()) })],
    ["recursively frozen structural lookalike", frozenCandidateSetLookalike],
  ])("rejects an uncertified %s during presentation", (_name, makeCandidateSet) => {
    expect(() => createLanguageCandidatePresentation(makeCandidateSet(), deterministicRecord()))
      .toThrow(LanguageCandidateSetRuleError);
  });

  it.each([
    ["duplicate IDs", (input: ReturnType<typeof candidateInput>) => ({
      ...input,
      candidates: input.candidates.map((candidate, index) =>
        index === 1 ? { ...candidate, id: "typescript" } : candidate),
    })],
    ["canonical-label collisions", (input: ReturnType<typeof candidateInput>) => ({
      ...input,
      candidates: input.candidates.map((candidate, index) =>
        index === 1 ? { ...candidate, canonicalLabel: "  TYPESCRIPT " } : candidate),
    })],
    ["alias-to-label collisions", (input: ReturnType<typeof candidateInput>) => ({
      ...input,
      candidates: input.candidates.map((candidate, index) =>
        index === 1 ? { ...candidate, aliases: [" \uff34\uff33 "] } : candidate),
    })],
    ["alias-to-alias collisions", (input: ReturnType<typeof candidateInput>) => ({
      ...input,
      candidates: input.candidates.map((candidate, index) =>
        index === 1 ? { ...candidate, aliases: ["TYPE\u00a0SCRIPT"] } : candidate),
    })],
    ["duplicate aliases on one candidate", (input: ReturnType<typeof candidateInput>) => ({
      ...input,
      candidates: input.candidates.map((candidate, index) =>
        index === 0 ? { ...candidate, aliases: ["TS", " \uff54\uff53 "] } : candidate),
    })],
  ])("rejects %s after canonical normalization", (_name, alter) => {
    expect(() => createLanguageCandidateSet(deepFreeze(alter(candidateInput()))))
      .toThrow(LanguageCandidateSetRuleError);
  });

  it.each([
    ["missing answer", "missing"],
    ["blank answer", " "],
  ])("rejects a %s so exactly one candidate is correct", (_name, correctCandidateId) => {
    expect(() => createLanguageCandidateSet(changed("correctCandidateId", correctCandidateId)))
      .toThrow(LanguageCandidateSetRuleError);
  });

  it("requires a non-empty rationale for every distractor", () => {
    const input = candidateInput();
    const candidates = input.candidates.map((candidate, index) =>
      index === 2 ? { ...candidate, distractorRationale: " " } : candidate);
    expect(() => createLanguageCandidateSet(deepFreeze({ ...input, candidates })))
      .toThrow(LanguageCandidateSetRuleError);
  });

  it("forbids a distractor rationale on the correct candidate", () => {
    const input = candidateInput();
    const candidates = input.candidates.map((candidate, index) =>
      index === 0 ? { ...candidate, distractorRationale: "It is correct." } : candidate);
    expect(() => createLanguageCandidateSet(deepFreeze({ ...input, candidates })))
      .toThrow(LanguageCandidateSetRuleError);
  });

  it.each([
    ["set version", (input: ReturnType<typeof candidateInput>) => ({ ...input, versionId: " " })],
    ["candidate id", (input: ReturnType<typeof candidateInput>) => ({
      ...input, candidates: [{ ...input.candidates[0], id: " " }, ...input.candidates.slice(1)],
    })],
    ["canonical label", (input: ReturnType<typeof candidateInput>) => ({
      ...input, candidates: [{ ...input.candidates[0], canonicalLabel: " " }, ...input.candidates.slice(1)],
    })],
    ["alias", (input: ReturnType<typeof candidateInput>) => ({
      ...input, candidates: [{ ...input.candidates[0], aliases: [" "] }, ...input.candidates.slice(1)],
    })],
    ["ordering policy version", (input: ReturnType<typeof candidateInput>) => ({
      ...input, orderingPolicy: { ...input.orderingPolicy, versionId: " " },
    })],
    ["clue-set version", (input: ReturnType<typeof candidateInput>) => ({ ...input, clueSetVersionId: " " })],
    ["clue-policy version", (input: ReturnType<typeof candidateInput>) => ({ ...input, cluePolicyVersionId: " " })],
    ["scoring version", (input: ReturnType<typeof candidateInput>) => ({ ...input, scoringVersionId: " " })],
    ["clue id", (input: ReturnType<typeof candidateInput>) => ({
      ...input, clues: [{ ...input.clues[0], clueId: " " }, input.clues[1]],
    })],
    ["clue version", (input: ReturnType<typeof candidateInput>) => ({
      ...input, clues: [{ ...input.clues[0], clueVersionId: " " }, input.clues[1]],
    })],
  ])("rejects blank nested identity: %s", (_name, alter) => {
    expect(() => createLanguageCandidateSet(deepFreeze(alter(candidateInput()))))
      .toThrow(LanguageCandidateSetRuleError);
  });

  it("rejects an unknown candidate-set ordering policy kind", () => {
    const input = candidateInput();
    expect(() => createLanguageCandidateSet(deepFreeze({
      ...input,
      orderingPolicy: { ...input.orderingPolicy, kind: "manual" },
    }))).toThrow(LanguageCandidateSetRuleError);
  });

  it.each([0, 3, 4.5, 5])("rejects presented count %s when it is not the exact closed-set size", (count) => {
    expect(() => createLanguageCandidateSet(changed("presentedCandidateCount", count)))
      .toThrow(LanguageCandidateSetRuleError);
  });

  it("retains an exact chance-aware calibration binding", () => {
    const { calibration } = createLanguageCandidateSet(candidateInput());
    expect(calibration).toEqual({
      versionId: "language-calibration-v1",
      candidateSetVersionId: "language-set-v1",
      presentedCandidateCount: 4,
      chanceBaseline: 0.25,
      cluePolicyVersionId: "two-progressive-clues-v1",
      configuredClueCount: 2,
      scoringVersionId: "beta-scoring-v1",
    });
    expect(Object.isFrozen(calibration)).toBe(true);
  });

  it("accepts an exact non-terminating chance baseline", () => {
    const candidateSet = createLanguageCandidateSet(threeCandidateInput());
    expect(candidateSet.presentedCandidateCount).toBe(3);
    expect(candidateSet.calibration.chanceBaseline).toBe(1 / 3);
  });

  it.each([0, 1, 2] as const)("accepts %s configured clues with an exact calibration binding", (count) => {
    const candidateSet = createLanguageCandidateSet(withClueCount(count));
    expect(candidateSet.clues).toHaveLength(count);
    expect(candidateSet.calibration.configuredClueCount).toBe(count);
  });

  it.each([
    ["third clue", () => {
      const input = candidateInput();
      return {
        ...input,
        clues: [...input.clues, { clueId: "clue-3", clueVersionId: "language-clue-3-v1", order: 3 }],
        calibration: { ...input.calibration, configuredClueCount: 3 },
      };
    }],
    ["first clue starting at two", () => {
      const input = withClueCount(1);
      return { ...input, clues: [{ ...input.clues[0], order: 2 }] };
    }],
    ["nonconsecutive order", () => {
      const input = candidateInput();
      return { ...input, clues: [input.clues[0], { ...input.clues[1], order: 1 }] };
    }],
    ["duplicate clue id", () => {
      const input = candidateInput();
      return { ...input, clues: [input.clues[0], { ...input.clues[1], clueId: "clue-1" }] };
    }],
    ["duplicate clue version", () => {
      const input = candidateInput();
      return { ...input, clues: [input.clues[0], { ...input.clues[1], clueVersionId: "language-clue-1-v1" }] };
    }],
  ])("rejects invalid clue configuration: %s", (_name, makeInput) => {
    expect(() => createLanguageCandidateSet(deepFreeze(makeInput())))
      .toThrow(LanguageCandidateSetRuleError);
  });

  it.each([
    ["versionId", " "],
    ["candidateSetVersionId", "another-set"],
    ["presentedCandidateCount", 3],
    ["chanceBaseline", 0.2],
    ["cluePolicyVersionId", "another-policy"],
    ["configuredClueCount", 1],
    ["scoringVersionId", "another-scoring-version"],
  ])("rejects inconsistent calibration field %s", (field, value) => {
    expect(() => createLanguageCandidateSet(changedCalibration(field, value)))
      .toThrow(LanguageCandidateSetRuleError);
  });

  it("rejects missing calibration", () => {
    expect(() => createLanguageCandidateSet(changed("calibration", undefined)))
      .toThrow(LanguageCandidateSetRuleError);
  });

  it.each([
    () => ({ ...candidateInput() }),
    () => Object.freeze({ ...candidateInput(), candidates: [...candidateInput().candidates] }),
    () => {
      const input = candidateInput();
      return Object.freeze({ ...input, candidates: Object.freeze([{ ...input.candidates[0] }, ...input.candidates.slice(1)]) });
    },
    () => {
      const input = candidateInput();
      return Object.freeze({ ...input, candidates: Object.freeze([{ ...input.candidates[0], aliases: [...input.candidates[0]!.aliases] }, ...input.candidates.slice(1)]) });
    },
    () => Object.freeze({ ...candidateInput(), orderingPolicy: { ...candidateInput().orderingPolicy } }),
    () => Object.freeze({ ...candidateInput(), clues: [...candidateInput().clues] }),
    () => {
      const input = candidateInput();
      return Object.freeze({ ...input, clues: Object.freeze([{ ...input.clues[0] }, input.clues[1]]) });
    },
    () => Object.freeze({ ...candidateInput(), calibration: { ...candidateInput().calibration } }),
  ])("rejects mutable candidate-set structures", (makeInput) => {
    expect(() => createLanguageCandidateSet(makeInput())).toThrow(LanguageCandidateSetRuleError);
  });

  it.each([
    () => deepFreeze({ ...candidateInput(), extra: true }),
    () => {
      const input = candidateInput();
      return deepFreeze({ ...input, candidates: [{ ...input.candidates[0], extra: true }, ...input.candidates.slice(1)] });
    },
    () => {
      const input = candidateInput();
      return deepFreeze({ ...input, calibration: { ...input.calibration, extra: true } });
    },
    () => {
      const input = candidateInput();
      return deepFreeze({ ...input, orderingPolicy: { ...input.orderingPolicy, extra: true } });
    },
    () => {
      const input = candidateInput();
      return deepFreeze({ ...input, clues: [{ ...input.clues[0], extra: true }, input.clues[1]] });
    },
  ])("rejects extra candidate-set fields", (makeInput) => {
    expect(() => createLanguageCandidateSet(makeInput())).toThrow(LanguageCandidateSetRuleError);
  });

  it("records deterministic order for the bound session", () => {
    const record = deterministicRecord();
    const presentation = createLanguageCandidatePresentation(
      createLanguageCandidateSet(candidateInput()),
      record,
    );
    expect(presentation.candidateIds).toEqual(["typescript", "javascript", "kotlin", "swift"]);
    expect(presentation.presentedCandidateCount).toBe(4);
    expect(presentation.orderingRecord).toEqual(deterministicRecord());
    expect(presentation.orderingRecord).not.toBe(record);
    expect(presentation.candidateIds).not.toBe(record.presentedCandidateIds);
    expectDeepFrozen(presentation);
  });

  it("records an explicit randomized order for the bound session", () => {
    const presentation = createLanguageCandidatePresentation(
      createLanguageCandidateSet(candidateInput("randomized")),
      randomizedRecord(),
    );
    expect(presentation.candidateIds).toEqual(["swift", "typescript", "kotlin", "javascript"]);
    expect(presentation.orderingRecord).toMatchObject({ randomizationRecordId: "randomization-2" });
    expectDeepFrozen(presentation);
  });

  it.each([
    ["blank record id", deepFreeze({ ...deterministicRecord(), recordId: " " })],
    ["blank session id", deepFreeze({ ...deterministicRecord(), sessionId: " " })],
    ["unknown kind", deepFreeze({ ...deterministicRecord(), kind: "manual" })],
    ["wrong set", deepFreeze({ ...deterministicRecord(), candidateSetVersionId: "another-set" })],
    ["wrong policy", deepFreeze({ ...deterministicRecord(), policyVersionId: "another-policy" })],
    ["unknown candidate", deepFreeze({ ...deterministicRecord(), presentedCandidateIds: ["typescript", "javascript", "kotlin", "ruby"] })],
    ["duplicate candidate", deepFreeze({ ...deterministicRecord(), presentedCandidateIds: ["typescript", "javascript", "kotlin", "kotlin"] })],
    ["reordered deterministic candidates", deepFreeze({ ...deterministicRecord(), presentedCandidateIds: ["swift", "typescript", "kotlin", "javascript"] })],
    ["extra field", deepFreeze({ ...deterministicRecord(), extra: true })],
    ["mutable record", { ...deterministicRecord() }],
    ["mutable order", Object.freeze({ ...deterministicRecord(), presentedCandidateIds: [...deterministicRecord().presentedCandidateIds] })],
  ])("rejects an invalid ordering record: %s", (_name, record) => {
    expect(() => createLanguageCandidatePresentation(
      createLanguageCandidateSet(candidateInput()),
      record,
    )).toThrow(LanguageCandidateSetRuleError);
  });

  it("rejects an explicit randomized record for a deterministic policy", () => {
    expect(() => createLanguageCandidatePresentation(
      createLanguageCandidateSet(candidateInput("deterministic")),
      randomizedRecord(),
    )).toThrow(LanguageCandidateSetRuleError);
  });

  it("rejects a deterministic record for a randomized policy", () => {
    expect(() => createLanguageCandidatePresentation(
      createLanguageCandidateSet(candidateInput("randomized")),
      deterministicRecord(),
    )).toThrow(LanguageCandidateSetRuleError);
  });

  it("rejects randomized-only fields on a deterministic record", () => {
    const record = deepFreeze({
      ...deterministicRecord(),
      randomizationRecordId: "unexpected-randomization",
      recordedAt: "2026-09-01T12:00:00.000Z",
    });
    expect(() => createLanguageCandidatePresentation(
      createLanguageCandidateSet(candidateInput()),
      record,
    )).toThrow(LanguageCandidateSetRuleError);
  });

  it.each([
    ["missing randomization record", deepFreeze({ ...randomizedRecord(), randomizationRecordId: undefined })],
    ["missing randomization record", deepFreeze({ ...randomizedRecord(), randomizationRecordId: " " })],
    ["missing recorded time", deepFreeze({ ...randomizedRecord(), recordedAt: undefined })],
    ["invalid recorded time", deepFreeze({ ...randomizedRecord(), recordedAt: "not-an-instant" })],
  ])("rejects randomized order with %s", (_name, record) => {
    expect(() => createLanguageCandidatePresentation(
      createLanguageCandidateSet(candidateInput("randomized")),
      record,
    )).toThrow(LanguageCandidateSetRuleError);
  });
});
