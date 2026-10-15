import * as React from "react";

import { optionLine, type PublicRound } from "./mode-contract";

/**
 * The round's options as one radio group. Once revealed, the answer and a missed pick are marked; a fix round's
 * options show their line's code and report which one has focus, so the pane can highlight it.
 */
export function AnswerOptions({ round, numbered, paneLines, selection, answerCandidateId, lockedCandidateId, disabled, onSelect, onFocusCandidate }: {
  readonly round: Readonly<PublicRound>;
  readonly numbered: boolean;
  readonly paneLines: readonly string[];
  readonly selection: string;
  /** The right option, once the round is revealed. */
  readonly answerCandidateId: string | null;
  readonly lockedCandidateId: string | null;
  readonly disabled: boolean;
  readonly onSelect: (candidateId: string) => void;
  readonly onFocusCandidate: (candidateId: string | null) => void;
}) {
  // Missing-line options are lines of code (#57), and name-the-function options are identifiers (#73): shown as code.
  const codeLabels = round.mode.kind === "missing-line" || round.mode.kind === "name-function";
  return (
    <fieldset disabled={disabled}>
      <legend>Choose one answer</legend>
      <div className="candidate-grid">
        {round.mode.candidates.map((candidate) => {
          const verdict = answerCandidateId === null ? ""
            : candidate.candidateId === answerCandidateId ? " correct"
              : candidate.candidateId === lockedCandidateId ? " missed" : "";
          const detailId = `detail-${round.roundId}-${candidate.candidateId}`;
          const line = numbered ? optionLine(candidate.label) : undefined;
          const lineText = line === undefined ? undefined : paneLines[line - 1]?.trim();
          const detail = candidate.detail ?? lineText ?? null;
          return (
            <label className={`${selection === candidate.candidateId ? "candidate selected" : "candidate"}${verdict}`} key={candidate.candidateId}>
              <input
                type="radio"
                name={`candidate-${round.roundId}`}
                value={candidate.candidateId}
                aria-label={candidate.label}
                aria-describedby={detail ? detailId : undefined}
                checked={selection === candidate.candidateId}
                onChange={() => onSelect(candidate.candidateId)}
                onFocus={numbered ? () => onFocusCandidate(candidate.candidateId) : undefined}
                onBlur={numbered ? () => onFocusCandidate(null) : undefined}
              />
              <span className="candidate-text">
                <span className={codeLabels ? "candidate-label code-label" : "candidate-label"}>{candidate.label}</span>
                {detail && <span className={lineText ? "candidate-detail code-detail" : "candidate-detail"} id={detailId}>{detail}</span>}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
