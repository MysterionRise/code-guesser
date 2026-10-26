import * as React from "react";

import { hintCostNote } from "./arcade-text";
import type { HintDetail, PublicRound } from "./mode-contract";
import { TraceStepper } from "./question-layer";

/** The round's hint costs and its hints: each one bought so far, then, until the answer is locked, the button for the next. */
export function HintBar({ round, hints, details, disabled, locked, error, onRequest, buttonRef, latestHintRef }: {
  readonly round: Readonly<PublicRound>;
  /** The hints bought for this round, in order. */
  readonly hints: readonly string[];
  /** What each bought hint shows beside its text, when it is a question layer's (#128). */
  readonly details: readonly (HintDetail | null)[];
  readonly disabled: boolean;
  /** The answer is locked, so no hint is left to buy and the button goes (#161). */
  readonly locked: boolean;
  readonly error: string | null;
  readonly onRequest: () => void;
  readonly buttonRef: React.Ref<HTMLButtonElement>;
  readonly latestHintRef: React.Ref<HTMLParagraphElement>;
}) {
  return (
    <>
      <p className="hint-cost" id={`hint-cost-${round.roundId}`}>{hintCostNote(round.points)}</p>
      {/* Keyed by round, so a new round's hints arrive in a fresh live region instead of being announced. */}
      <div className="hints" role="group" aria-label="Hints" aria-live="polite" key={round.roundId}>
        {round.mode.clues.map((clue, index) => index < hints.length
          ? (
            <React.Fragment key={clue.order}>
              <p className="hint" tabIndex={-1} ref={index === hints.length - 1 ? latestHintRef : undefined}>{hints[index]}</p>
              {details[index]?.kind === "trace" && <TraceStepper detail={details[index] as Extract<HintDetail, { kind: "trace" }>} />}
            </React.Fragment>
          )
          : index === hints.length && !locked
            ? <button className="hint-button" type="button" key={clue.order} ref={buttonRef} aria-describedby={`hint-cost-${round.roundId}`} disabled={disabled} onClick={onRequest}>
                Reveal hint {clue.order}
              </button>
            : null)}
        {error && <p className="demo-error" role="alert">{error}</p>}
      </div>
    </>
  );
}
