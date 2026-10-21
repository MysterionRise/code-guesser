import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  ArcadeShell,
  ArcadeShellRuleError,
  createArcadeSession,
  createPublicModeContract,
  SHARE_MARKS,
  formatCompletionResult,
  projectDisplayReveal,
  projectSpoilerFreeShare,
  roundPointsNote,
  roundStatusText,
  transitionArcadeSession,
  type PublicModeContractInput,
} from "../src/components/arcade/index.js";

const modeInput = (): PublicModeContractInput => ({
  sessionContractVersionId: "language-session-1",
  rounds: Array.from({ length: 5 }, (_, index) => ({
    roundId: `round-${index + 1}`,
    roundVersionId: `round-version-${index + 1}`,
    content: {
      versionId: `content-version-${index + 1}`,
      panes: [{ label: null, text: index === 0 ? "if (value < 3) return value; <script>alert(1)</script>" : `sample ${index + 1}` }],
    },
    mode: {
      kind: "language" as const,
      contractVersionId: `mode-contract-${index + 1}`,
      calibrationVersionId: `calibration-${index + 1}`,
      prompt: "Which language is this?",
      candidates: [{ candidateId: "candidate-a", label: "Option A", detail: null }, { candidateId: "candidate-b", label: "Option B", detail: null }],
      clues: [{ order: 1 as const }, { order: 2 as const }],
    },
    points: [1000, 800, 500] as [number, number, number],
    versions: {
      candidateSet: `candidate-set-${index + 1}`,
      clueSet: `clue-set-${index + 1}`,
      scoring: "scoring-1",
      rules: "rules-1",
    },
  })),
});

const unusedActions = {
  sessionToken: "signed-session-token",
  authorizeRevealAction: async (): Promise<never> => { throw new Error("not called during render"); },
  revealHintAction: async (): Promise<never> => { throw new Error("not called during render"); },
};

describe("static arcade shell", () => {
  it("numbers a fix round's lines, shows each option's line of code, and keeps each line's own indentation", () => {
    const input = modeInput();
    const pane = "    if (x <= 1) {\n        return x;\n    }\n    return total + step;";
    const mode = createPublicModeContract({ ...input, rounds: input.rounds.map((round) => ({ ...round,
      content: { ...round.content, panes: [{ label: null, text: pane }] },
      mode: { ...round.mode, kind: "fix" as const, prompt: "Which line did the fix change?",
        candidates: [1, 2, 4].map((line) => ({ candidateId: `line-${line}`, label: `Line ${line}`, detail: null })) } })) });
    expect(mode.rounds[0]!.content.panes[0]!.text).toBe(pane);
    const html = renderToStaticMarkup(createElement(ArcadeShell, {
      mode,
      ...unusedActions,
    }));
    expect(html).toContain('aria-label="Code excerpt with numbered lines"');
    expect((html.match(/<span class="line-number" aria-hidden="true">/gu) ?? []).length).toBe(4);
    // The indent every line shares is dropped for display (#85); each line keeps its own beyond it, and its number.
    expect(html).toContain('data-line="4"><span class="line-number" aria-hidden="true">4</span>return total + step;</span>');
    expect(html).toContain('data-line="2"><span class="line-number" aria-hidden="true">2</span>    return x;</span>');
    // Each option carries its line's code, which describes the radio for screen readers too.
    expect(html).toMatch(/aria-label="Line 1" aria-describedby="detail-round-1-line-1"/u);
    expect(html).toContain('<span class="candidate-detail code-detail" id="detail-round-1-line-1">if (x &lt;= 1) {</span>');
    expect(html).toContain("Lines are numbered; each option names one.");
    expect(html).not.toContain("highlighted");
  });

  it("renders a mode-neutral five-round accessible starting journey", () => {
    const mode = createPublicModeContract(modeInput());
    const html = renderToStaticMarkup(createElement(ArcadeShell, {
      mode,
      ...unusedActions,
    }));

    expect((html.match(/data-round-nav=/gu) ?? []).length).toBe(5);
    expect(html).toContain('data-round-count="5"');
    expect(html).toContain("Round 1 of 5");
    expect(html).toContain("Which language is this?");
    expect(html).toContain('data-round-id="round-1"');
    expect(html).toContain("Option A");
    expect(html).toContain("Reveal hint 1");
    // Hint costs are visible up front and announced with the hint button.
    expect(html).toMatch(/<p class="hint-cost" id="hint-cost-round-1">Each hint lowers this round’s points: 1,000 → 800 → 500\.<\/p>/u);
    expect(html).toMatch(/<button class="hint-button"[^>]*aria-describedby="hint-cost-round-1"/u);
    // A revealed hint is announced politely; focus handling lives in the browser tests.
    expect(html).toMatch(/<div class="hints"[^>]*aria-live="polite"/u);
    // Long lines scroll inside a keyboard-reachable code window instead of wrapping.
    expect(html).toMatch(/<pre class="code-window" role="region" tabindex="0" aria-label="Code excerpt">/u);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("This game needs JavaScript for answers and progressive evidence.");
    expect(html).toContain('aria-live="polite"');
  });

  it("exposes the score, round progress, and hints to assistive technology without labelling generic elements", () => {
    const html = renderToStaticMarkup(createElement(ArcadeShell, {
      mode: createPublicModeContract(modeInput()),
      ...unusedActions,
    }));
    // The score is text, formatted in en-US like every other number, with a label only screen readers need.
    expect(html).toMatch(/<span class="score"><span class="visually-hidden">Score: <\/span>0(?:<!-- -->)? pts<\/span>/u);
    // Progress is an ordered list; the current round is the current step and says so in text.
    expect(html).toContain('<ol class="round-track" aria-label="Round progress">');
    expect((html.match(/<li class="round-dot[^"]*"/gu) ?? []).length).toBe(5);
    expect((html.match(/aria-current="step"/gu) ?? []).length).toBe(1);
    expect(html).toMatch(/<li class="round-dot current" data-round-nav="1" aria-current="step"><span aria-hidden="true">1<\/span><span class="visually-hidden">Round 1, current<\/span><\/li>/u);
    expect(html).toContain('<span class="visually-hidden">Round 5</span>');
    expect(html).toMatch(/<div class="hints" role="group" aria-label="Hints"/u);
    // Every element that carries a name has a role that may be named.
    const named = [...html.matchAll(/<([a-z]+)\b([^>]*)\baria-label="[^"]*"/gu)].map(([, tag, attributes]) => ({ tag, role: /\brole="/u.test(attributes!) }));
    expect(named.length).toBeGreaterThan(0);
    for (const { tag, role } of named) expect(["ol", "input", "button", "a", "nav", "section"].includes(tag!) || role, tag).toBe(true);
  });

  it("names each round on the track by its place and outcome", () => {
    expect(roundStatusText(1, true, undefined)).toBe("Round 1, current");
    expect(roundStatusText(1, false, true)).toBe("Round 1, correct");
    expect(roundStatusText(2, true, false)).toBe("Round 2, current, missed");
    expect(roundStatusText(3, false, undefined)).toBe("Round 3");
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
      .toThrowError(new ArcadeShellRuleError("a session deals exactly five rounds"));
    const input = modeInput();
    input.rounds[0]!.mode.clues.push({ order: 3 as 2 });
    expect(() => createPublicModeContract(input)).toThrow("a round may expose at most two clues");
  });

  it("accepts each deck's kind, and a mixed session of several (#56)", () => {
    for (const kind of ["project", "language", "before-after"] as const) {
      const deck = modeInput();
      deck.rounds.forEach((round) => { round.mode.kind = kind; });
      expect(createPublicModeContract(deck).rounds.every((round) => round.mode.kind === kind)).toBe(true);
    }
    const mixed = modeInput();
    mixed.rounds[0]!.mode.kind = "project";
    expect(createPublicModeContract(mixed).rounds.map((round) => round.mode.kind)).toContain("project");
    const unknown = modeInput();
    unknown.rounds.forEach((round) => { round.mode.kind = "ai" as "language"; });
    expect(() => createPublicModeContract(unknown)).toThrow("unsupported round mode");
    const rising = modeInput();
    rising.rounds[0]!.points = [500, 800, 1000];
    expect(() => createPublicModeContract(rising)).toThrow("points must fall with each hint");
  });

  it("shows two labelled panes to compare, option details, and the round's own hint costs", () => {
    const input = modeInput();
    input.rounds.forEach((round) => {
      round.mode.kind = "before-after";
      round.content.panes = [{ label: "A", text: "total = sum(values)" }, { label: "B", text: "total = 0\nfor v in values: total += v" }];
      round.points = [500, 400, 250];
    });
    input.rounds[0]!.mode.candidates[0]!.detail = "A short public note";
    const html = renderToStaticMarkup(createElement(ArcadeShell, {
      mode: createPublicModeContract(input),
      ...unusedActions,
    }));
    expect(html).toContain('<div class="code-panes compare">');
    expect(html).toContain("<figcaption>Version A</figcaption>");
    expect(html).toMatch(/aria-label="Code, version B"/u);
    expect(html).toContain("Each hint lowers this round’s points: 500 → 400 → 250.");
    expect(html).toMatch(/aria-label="Option A" aria-describedby="detail-round-1-candidate-a"/u);
    expect(html).toContain('<span class="candidate-detail" id="detail-round-1-candidate-a">A short public note</span>');
  });

  it("scores a correct answer from the round's points and requires the reveal to name the locked answer", () => {
    const input = modeInput();
    input.rounds.forEach((round) => { round.points = [500, 400, 250]; });
    const mode = createPublicModeContract(input);
    let session = transitionArcadeSession(mode, createArcadeSession(mode), { type: "lock-answer", candidateId: "candidate-a" });
    session = transitionArcadeSession(mode, session, { type: "accept-reveal", reveal: displayReveal(0, 500, 2500, 1, 500) });
    expect(session.score).toBe(500);
    const wrongAnswer = transitionArcadeSession(mode, createArcadeSession(mode), { type: "lock-answer", candidateId: "candidate-b" });
    expect(() => transitionArcadeSession(mode, wrongAnswer, { type: "accept-reveal", reveal: displayReveal(0, 500, 2500, 1, 500) }))
      .toThrow("reveal does not match the locked answer");
  });

  it("states what each round earned and the hints it took, under the verdict in the live reveal", () => {
    expect(roundPointsNote(1000, 0)).toBe("+1,000 points (no hints)");
    expect(roundPointsNote(800, 1)).toBe("+800 points (1 hint)");
    expect(roundPointsNote(250, 2)).toBe("+250 points (2 hints)");
    expect(roundPointsNote(0, 0)).toBe("0 points (no hints)");
    expect(roundPointsNote(0, 2)).toBe("0 points (2 hints)");
    const shell = readFileSync(new URL("../src/components/arcade/arcade-shell.tsx", import.meta.url), "utf8");
    expect(shell).toMatch(/<div className="reveal" aria-live="polite" aria-atomic="true">\s*\{session\.reveal && \(\s*<RoundReveal [^>]*hintsUsed=\{session\.visibleHintCount\}/u);
    const reveal = readFileSync(new URL("../src/components/arcade/round-reveal.tsx", import.meta.url), "utf8");
    const note = reveal.indexOf("roundPointsNote(reveal.score, hintsUsed)");
    expect(note).toBeGreaterThan(reveal.indexOf("Nice read."));
    expect(note).toBeLessThan(reveal.indexOf("The answer:"));
  });

  it("orders and caps progressive clues, then locks exactly one answer", () => {
    const mode = createPublicModeContract(modeInput());
    let session = createArcadeSession(mode);
    expect(() => transitionArcadeSession(mode, session, { type: "reveal-hint", label: " " })).toThrow("hint must not be blank");
    session = transitionArcadeSession(mode, session, { type: "reveal-hint", label: "First bought hint" });
    expect(session.visibleHintCount).toBe(1);
    session = transitionArcadeSession(mode, session, { type: "reveal-hint", label: "Second bought hint" });
    session = transitionArcadeSession(mode, session, { type: "reveal-hint", label: "A third the round does not have" });
    expect(session.visibleHintCount).toBe(2);
    expect(session.hints).toEqual(["First bought hint", "Second bought hint"]);
    session = transitionArcadeSession(mode, session, { type: "lock-answer", candidateId: "candidate-a" });
    expect(session.lockedCandidateId).toBe("candidate-a");
    expect(() => transitionArcadeSession(mode, session, { type: "lock-answer", candidateId: "candidate-b" }))
      .toThrow("an answer is already locked for this round");
    expect(() => transitionArcadeSession(mode, session, { type: "reveal-hint", label: "Late" })).toThrow("clues are unavailable after answer lock");
    session = transitionArcadeSession(mode, session, { type: "accept-reveal", reveal: displayReveal(0, 500, 5000, 1, 500) });
    expect(transitionArcadeSession(mode, session, { type: "next-round" }).hints).toEqual([]);
  });

  it("carries no hint text in the public contract", () => {
    const input = modeInput();
    (input.rounds[0]!.mode.clues[0] as unknown as Record<string, string>).label = "A hint shipped up front";
    expect(() => createPublicModeContract(input)).toThrow("a public clue carries only its order");
    expect(JSON.stringify(createPublicModeContract(modeInput()).rounds[0]!.mode.clues)).toBe('[{"order":1},{"order":2}]');
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
    expect(reveal.versions).toEqual({ content: "content-version-1", candidateSet: "candidate-set-1", scoring: "scoring-1", rules: "rules-1", evidence: "evidence-1", reveal: "reveal-1" });
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
    let session = transitionArcadeSession(mode, createArcadeSession(mode), { type: "reveal-hint", label: "First bought hint" });
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
    expect(session.correctRounds).toBe(5);
    expect(session.outcomes).toEqual([true, true, true, true, true]);
    const url = "http://127.0.0.1:3000/?deck=language&deal=0a1b2c3d&game=0";
    const share = projectSpoilerFreeShare(session.result!, session.history, "Which language?", url);
    expect(share).toEqual({ text: `CodeGuessr · Which language? · 5/5 · 5,000/5,000\n🟩🟩🟩🟩🟩\n${url}`,
      message: "CodeGuessr · Which language? · 5/5 · 5,000/5,000\n🟩🟩🟩🟩🟩", url, score: 5000, rounds: 5, correct: 5 });
    expect(JSON.stringify(share)).not.toMatch(/candidate|answer|evidence|excerpt|Option|round-/iu);
    expect(projectSpoilerFreeShare(session.result!, session.history).text).toBe("CodeGuessr · 5/5 · 5,000/5,000\n🟩🟩🟩🟩🟩");
    expect(() => projectSpoilerFreeShare(session.result!, session.history.slice(1))).toThrow(ArcadeShellRuleError);
    expect(() => projectSpoilerFreeShare(session.result!, session.history, "Which language?", "/?deck=language")).toThrow(ArcadeShellRuleError);
    expect(() => projectSpoilerFreeShare(session.result!, session.history, "Which language?", "javascript:alert(1)")).toThrow(ArcadeShellRuleError);
    expect(formatCompletionResult(session.result!, session.correctRounds)).toBe("Run complete — 5,000 points, 5 of 5 correct.");
    expect(() => formatCompletionResult(session.result!, 6)).toThrow(ArcadeShellRuleError);
  });

  it("marks each round in play order: right with no hint, right with hints, or missed (#171)", () => {
    const result = { score: 3_300, attainableMaximum: 5_000, completedRounds: 5, resultVersionId: "result-5" };
    const rounds = [{ correct: true, hints: 0 }, { correct: true, hints: 1 }, { correct: false, hints: 2 }, { correct: true, hints: 2 },
      { correct: false, hints: 0 }];
    expect(projectSpoilerFreeShare(result, rounds, "Which language?").message)
      .toBe(`CodeGuessr · Which language? · 3/5 · 3,300/5,000\n${SHARE_MARKS.clean}${SHARE_MARKS.hinted}${SHARE_MARKS.missed}${SHARE_MARKS.hinted}${SHARE_MARKS.missed}`);
    expect(SHARE_MARKS).toEqual({ clean: "🟩", hinted: "🟨", missed: "⬛" });
    expect(() => projectSpoilerFreeShare({ ...result, completedRounds: 4 }, rounds.slice(1))).toThrow("sharing requires a complete run");
  });

  it("keeps every answered round for the game's summary: pick, answer, points, hints, and source (#43)", () => {
    const mode = createPublicModeContract(modeInput());
    let session = createArcadeSession(mode);
    for (let index = 0; index < 5; index += 1) {
      if (index === 0) session = transitionArcadeSession(mode, session, { type: "reveal-hint", label: "A hint" });
      const pick = index === 1 ? "candidate-b" : "candidate-a";
      const roundScore = index === 1 ? 0 : index === 0 ? 800 : 1000;
      const total = session.score + roundScore;
      session = transitionArcadeSession(mode, session, { type: "lock-answer", candidateId: pick });
      session = transitionArcadeSession(mode, session, { type: "accept-reveal", reveal: { ...displayReveal(index, total, 5000, index + 1, roundScore),
        correct: pick === "candidate-a", attribution: `Author · repo · MIT · https://github.com/acme/repo/blob/abc/file-${index}.py` } });
      if (index < 4) session = transitionArcadeSession(mode, session, { type: "next-round" });
    }
    expect(session.history.map(({ picked, answer, correct, points, hints }) => [picked, answer, correct, points, hints])).toEqual([
      ["Option A", "Option A", true, 800, 1], ["Option B", "Option A", false, 0, 0], ["Option A", "Option A", true, 1000, 0],
      ["Option A", "Option A", true, 1000, 0], ["Option A", "Option A", true, 1000, 0],
    ]);
    expect(session.history.reduce((total, { points }) => total + points, 0)).toBe(session.score);
    expect(session.history[2]!.source).toBe("https://github.com/acme/repo/blob/abc/file-2.py");
  });

  it("never replays revealed rounds: a finished run takes no further action, and unknown actions are refused", () => {
    const mode = createPublicModeContract(modeInput());
    const restart = { type: "restart" } as unknown as Parameters<typeof transitionArcadeSession>[2];
    let session = createArcadeSession(mode);
    session = transitionArcadeSession(mode, session, { type: "lock-answer", candidateId: "candidate-a" });
    session = transitionArcadeSession(mode, session, { type: "accept-reveal", reveal: displayReveal(0, 1000, 5000, 1) });
    // A revealed round would otherwise fall through to the next-round transition.
    expect(() => transitionArcadeSession(mode, session, restart)).toThrow("unsupported session action");
    for (let index = 1; index < 5; index += 1) {
      session = transitionArcadeSession(mode, session, { type: "next-round" });
      session = transitionArcadeSession(mode, session, { type: "lock-answer", candidateId: "candidate-a" });
      session = transitionArcadeSession(mode, session, {
        type: "accept-reveal",
        reveal: displayReveal(index, (index + 1) * 1000, 5000, index + 1),
      });
    }
    expect(session.status).toBe("complete");
    expect(() => transitionArcadeSession(mode, session, restart)).toThrow("the run is already complete");
    expect(() => transitionArcadeSession(mode, session, { type: "next-round" })).toThrow("the run is already complete");
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

  it("keeps excluded country attribution out and exposes demo errors and a fresh deal, never a replay", () => {
    const page = readFileSync(new URL("../src/app/page.tsx", import.meta.url), "utf8");
    const layout = readFileSync(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
    const shell = ["arcade-shell.tsx", "round-reveal.tsx"]
      .map((file) => readFileSync(new URL(`../src/components/arcade/${file}`, import.meta.url), "utf8")).join("\n");
    expect(`${page}\n${layout}`).not.toMatch(/country|code-location|where did this code come from|finland|brazil|japan|germany|india/iu);
    expect(existsSync(new URL("../src/app/actions.ts", import.meta.url))).toBe(true);
    expect(shell).toContain('role="alert"');
    expect(shell).not.toContain("Play again");
    expect(shell).not.toMatch(/type: "restart"/u);
    expect(shell).toMatch(/<a className="primary-action" href=\{newGameHref\}.*?>Deal new rounds<\/a>/u);
    expect(shell).toContain("Choose another deck");
  });
});

const displayReveal = (index: number, score: number, attainableMaximum: number, completedRounds: number, roundScore = 1000) => ({
  roundId: `round-${index + 1}`, roundVersionId: `round-version-${index + 1}`,
  correct: true, answerCandidateId: "candidate-a", score: roundScore, evidence: "Shown", explanation: "Useful", attribution: "Public source",
  helpfulSignals: ["Helpful"], misleadingSignals: ["Misleading"],
  versions: { content: `content-version-${index + 1}`, candidateSet: `candidate-set-${index + 1}`, scoring: "scoring-1", rules: "rules-1", evidence: `evidence-${index + 1}`, reveal: `reveal-${index + 1}` },
  result: { score, attainableMaximum, completedRounds, resultVersionId: `result-${completedRounds}` },
});

describe("code pane layout (#46, #85)", async () => {
  const { commonIndent, indentWidth } = await import("../src/components/arcade/code-panes.js");
  it("finds the indent every non-blank line shares, and each line's own width", () => {
    expect(commonIndent(["    a", "", "      b", "    c"])).toBe("    ");
    expect(commonIndent(["\tx", "\t\ty"])).toBe("\t");
    expect(commonIndent(["  a", "\tb"])).toBe("");
    expect(commonIndent(["", "  "])).toBe("");
    expect(indentWidth("\t  x")).toBe(6);
    expect(indentWidth("x")).toBe(0);
  });
});
