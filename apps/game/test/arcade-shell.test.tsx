import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ArcadeShell,
  ArcadeShellRuleError,
  createArcadeSession,
  createPublicModeContract,
  formatCompletionResult,
  projectDisplayReveal,
  projectSpoilerFreeShare,
  transitionArcadeSession,
  type PublicModeContractInput,
} from "../src/components/arcade/index.js";

const modeInput = (): PublicModeContractInput => ({
  sessionContractVersionId: "mixed-session-1",
  rounds: Array.from({ length: 5 }, (_, index) => ({
    roundId: `round-${index + 1}`,
    roundVersionId: `round-version-${index + 1}`,
    excerpt: {
      versionId: `excerpt-version-${index + 1}`,
      text: index === 0 ? "if (value < 3) return value; <script>alert(1)</script>" : `sample ${index + 1}`,
    },
    mode: {
      kind: index < 3 ? "provenance" as const : "language" as const,
      contractVersionId: `mode-contract-${index + 1}`,
      calibrationVersionId: `calibration-${index + 1}`,
      prompt: index < 3 ? "Which source best explains this code?" : "Which language is this?",
      candidates: [{ candidateId: "candidate-a", label: "Option A" }, { candidateId: "candidate-b", label: "Option B" }],
      clues: [{ order: 1 as const, label: "First public hint" }, { order: 2 as const, label: "Second public hint" }],
    },
    versions: {
      candidateSet: `candidate-set-${index + 1}`,
      clueSet: `clue-set-${index + 1}`,
      scoring: "scoring-1",
      rules: "rules-1",
    },
  })),
});

describe("static arcade shell", () => {
  it("renders a mode-neutral five-round accessible starting journey", () => {
    const mode = createPublicModeContract(modeInput());
    const html = renderToStaticMarkup(createElement(ArcadeShell, {
      mode,
      authorizeRevealAction: async () => { throw new Error("not called during render"); },
    }));

    expect((html.match(/data-round-nav=/gu) ?? []).length).toBe(5);
    expect(html).toContain('data-round-count="5"');
    expect(html).toContain("Round 1 of 5");
    expect(html).toContain("Which source best explains this code?");
    expect(html).not.toContain("Where did this code come from?");
    expect(html).toContain("Option A");
    expect(html).toContain("Reveal hint 1");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("This game needs JavaScript for answers and progressive evidence.");
    expect(html).toContain('aria-live="polite"');
  });

  it("freezes a safe public mode contract without protected answers", () => {
    const mode = createPublicModeContract(modeInput());
    const serialized = JSON.stringify(mode);

    expect(Object.isFrozen(mode)).toBe(true);
    expect(Object.isFrozen(mode.rounds)).toBe(true);
    for (const forbidden of ["correctAnswer", "futureAnswers", "restrictedEvidence"]) {
      expect(serialized.includes(forbidden)).toBe(false);
    }
  });

  it("rejects any round count other than five and more than two clues", () => {
    expect(() => createPublicModeContract({ ...modeInput(), rounds: modeInput().rounds.slice(0, 4) }))
      .toThrowError(new ArcadeShellRuleError("mode contract must define exactly five rounds"));
    const input = modeInput();
    input.rounds[0]!.mode.clues.push({ order: 3 as 2, label: "Third hint" });
    expect(() => createPublicModeContract(input)).toThrow("a round may expose at most two clues");
  });

  it("adapts exactly three provenance and two language rounds with mode-owned semantics", () => {
    const mode = createPublicModeContract(modeInput());
    expect(mode.rounds.map((round) => round.mode.kind)).toEqual(["provenance", "provenance", "provenance", "language", "language"]);
    expect(mode.rounds[3]!.mode.prompt).toBe("Which language is this?");
    expect(mode.rounds[3]!.mode.calibrationVersionId).toBe("calibration-4");
    const invalid = modeInput();
    invalid.rounds[2]!.mode.kind = "language";
    expect(() => createPublicModeContract(invalid)).toThrow("session must be one five-round deck or exactly three provenance and two language rounds");
    const mixedDeck = modeInput();
    mixedDeck.rounds.forEach((round, index) => { round.mode.kind = index === 0 ? "ai" : "project"; });
    expect(() => createPublicModeContract(mixedDeck)).toThrow("session must be one five-round deck");
    for (const kind of ["project", "language", "ai"] as const) {
      const deck = modeInput();
      deck.rounds.forEach((round) => { round.mode.kind = kind; });
      expect(createPublicModeContract(deck).rounds.every((round) => round.mode.kind === kind)).toBe(true);
    }
    const unknown = modeInput();
    unknown.rounds[4]!.mode.kind = "algorithm" as "language";
    expect(() => createPublicModeContract(unknown)).toThrow("unsupported round mode");
  });

  it("orders and caps progressive clues, then locks exactly one answer", () => {
    const mode = createPublicModeContract(modeInput());
    let session = createArcadeSession(mode);
    session = transitionArcadeSession(mode, session, { type: "reveal-hint" });
    expect(session.visibleHintCount).toBe(1);
    session = transitionArcadeSession(mode, session, { type: "reveal-hint" });
    session = transitionArcadeSession(mode, session, { type: "reveal-hint" });
    expect(session.visibleHintCount).toBe(2);
    session = transitionArcadeSession(mode, session, { type: "lock-answer", candidateId: "candidate-a" });
    expect(session.lockedCandidateId).toBe("candidate-a");
    expect(() => transitionArcadeSession(mode, session, { type: "lock-answer", candidateId: "candidate-b" }))
      .toThrow("an answer is already locked for this round");
    expect(() => transitionArcadeSession(mode, session, { type: "reveal-hint" })).toThrow("clues are unavailable after answer lock");
  });

  it("withholds reveal until an answer is accepted and projects display-safe evidence only", () => {
    const mode = createPublicModeContract(modeInput());
    let session = createArcadeSession(mode);
    expect(() => transitionArcadeSession(mode, session, {
      type: "accept-reveal",
      reveal: displayReveal(0, 1000, 5000, 1),
    })).toThrow("reveal requires a locked answer");
    session = transitionArcadeSession(mode, session, { type: "lock-answer", candidateId: "candidate-a" });
    expect(() => projectDisplayReveal({
      ...displayReveal(0, 1000, 5000, 1),
      restrictedEvidence: "must never cross the boundary",
    })).toThrow("reveal contains an unexpected field");
    const reveal = projectDisplayReveal(displayReveal(0, 1000, 5000, 1));
    expect(reveal.helpfulSignals).toEqual(["Helpful"]);
    expect(reveal.misleadingSignals).toEqual(["Misleading"]);
    expect(reveal.versions).toEqual({ content: "excerpt-version-1", candidateSet: "candidate-set-1", scoring: "scoring-1", rules: "rules-1", evidence: "evidence-1", reveal: "reveal-1" });
    session = transitionArcadeSession(mode, session, { type: "accept-reveal", reveal });
    expect(session.reveal?.evidence).toBe("Shown");
  });

  it("rejects a display-safe reveal bound to another round or mode lineage", () => {
    const mode = createPublicModeContract(modeInput());
    let session = transitionArcadeSession(mode, createArcadeSession(mode), { type: "lock-answer", candidateId: "candidate-a" });
    expect(() => transitionArcadeSession(mode, session, { type: "accept-reveal", reveal: projectDisplayReveal(displayReveal(1, 1000, 5000, 1)) }))
      .toThrow("reveal does not match the active round lineage");
  });

  it("binds round and cumulative score to the shell's accepted clue state", () => {
    const mode = createPublicModeContract(modeInput());
    let session = transitionArcadeSession(mode, createArcadeSession(mode), { type: "reveal-hint" });
    session = transitionArcadeSession(mode, session, { type: "lock-answer", candidateId: "candidate-a" });
    expect(() => transitionArcadeSession(mode, session, {
      type: "accept-reveal",
      reveal: displayReveal(0, 1000, 5000, 1, 1000),
    })).toThrow(/score/iu);

    const valid = transitionArcadeSession(mode, session, {
      type: "accept-reveal",
      reveal: displayReveal(0, 800, 5000, 1, 800),
    });
    expect(valid.score).toBe(800);

    let next = transitionArcadeSession(mode, valid, { type: "next-round" });
    next = transitionArcadeSession(mode, next, { type: "lock-answer", candidateId: "candidate-a" });
    expect(() => transitionArcadeSession(mode, next, {
      type: "accept-reveal",
      reveal: displayReveal(1, 1799, 5000, 2, 1000),
    })).toThrow(/score/iu);
  });

  it("requires both signal classes and every frozen lineage version", () => {
    const { helpfulSignals: _missingHelpful, ...withoutHelpful } = displayReveal(0, 1000, 5000, 1);
    expect(() => projectDisplayReveal(withoutHelpful)).toThrow("invalid reveal projection");
    const reveal = displayReveal(0, 1000, 5000, 1);
    expect(() => projectDisplayReveal({ ...reveal, versions: { ...reveal.versions, content: undefined } }))
      .toThrow("invalid reveal projection");
  });

  it("rejects non-finite, negative, fractional, or out-of-range result numbers", () => {
    for (const result of [
      { score: Number.NaN, attainableMaximum: 5000, completedRounds: 1 },
      { score: -1, attainableMaximum: 5000, completedRounds: 1 },
      { score: 1.5, attainableMaximum: 5000, completedRounds: 1 },
      { score: 1, attainableMaximum: 5000, completedRounds: 6 },
    ]) expect(() => projectDisplayReveal({ ...displayReveal(0, 1000, 5000, 1), result: { ...result, resultVersionId: "result-1" } })).toThrow("invalid reveal projection");
  });

  it("navigates all five rounds, completes once, and shares no spoilers", () => {
    const mode = createPublicModeContract(modeInput());
    let session = createArcadeSession(mode);
    for (let index = 0; index < 5; index += 1) {
      session = transitionArcadeSession(mode, session, { type: "lock-answer", candidateId: "candidate-a" });
      session = transitionArcadeSession(mode, session, {
        type: "accept-reveal",
        reveal: displayReveal(index, (index + 1) * 1000, 5000, index + 1),
      });
      if (index < 4) session = transitionArcadeSession(mode, session, { type: "next-round" });
    }
    expect(session.status).toBe("complete");
    expect(session.roundIndex).toBe(4);
    const share = projectSpoilerFreeShare(session.result!);
    expect(share).toEqual({ text: "CodeGuessr 5000/5000 · 5/5", score: 5000, rounds: 5 });
    expect(JSON.stringify(share)).not.toMatch(/candidate|answer|evidence|excerpt/iu);
    expect(formatCompletionResult(session.result!)).toBe("Run complete — 5,000 points. Share: CodeGuessr 5000/5000 · 5/5.");

    const restarted = transitionArcadeSession(
      mode,
      session,
      { type: "restart" } as unknown as Parameters<typeof transitionArcadeSession>[2],
    );
    expect(restarted).toEqual(createArcadeSession(mode));
  });

  it("rejects canonically duplicated round and candidate identifiers", () => {
    const rounds = modeInput();
    rounds.rounds[1]!.roundId = " ROUND-1 ";
    expect(() => createPublicModeContract(rounds)).toThrow("round ids must be unique after canonicalization");
    const candidates = modeInput();
    candidates.rounds[0]!.mode.candidates[1]!.candidateId = " Candidate-A ";
    expect(() => createPublicModeContract(candidates)).toThrow("candidate ids must be unique after canonicalization");
    const trimmed = modeInput();
    trimmed.rounds[0]!.roundId = " round-1 ";
    trimmed.rounds[0]!.mode.candidates[0]!.candidateId = " candidate-a ";
    const contract = createPublicModeContract(trimmed);
    expect(contract.rounds[0]!.roundId).toBe("round-1");
    expect(contract.rounds[0]!.mode.candidates[0]!.candidateId).toBe("candidate-a");
  });

  it("keeps excluded country attribution out and exposes demo errors and replay", () => {
    const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
    const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
    const shell = readFileSync(new URL("../src/components/arcade/arcade-shell.tsx", import.meta.url), "utf8");
    expect(`${page}\n${layout}`).not.toMatch(/country|code-location|where did this code come from|finland|brazil|japan|germany|india/iu);
    expect(existsSync(new URL("../src/app/actions.ts", import.meta.url))).toBe(true);
    expect(shell).toContain('role="alert"');
    expect(shell).toContain("Play again");
    expect(shell).toContain("Choose another deck");
  });
});

const displayReveal = (index: number, score: number, attainableMaximum: number, completedRounds: number, roundScore = 1000) => ({
  roundId: `round-${index + 1}`, roundVersionId: `round-version-${index + 1}`,
  correct: true, score: roundScore, evidence: "Shown", explanation: "Useful", attribution: "Public source",
  helpfulSignals: ["Helpful"], misleadingSignals: ["Misleading"],
  versions: { content: `excerpt-version-${index + 1}`, candidateSet: `candidate-set-${index + 1}`, scoring: "scoring-1", rules: "rules-1", evidence: `evidence-${index + 1}`, reveal: `reveal-${index + 1}` },
  result: { score, attainableMaximum, completedRounds, resultVersionId: `result-${completedRounds}` },
});
