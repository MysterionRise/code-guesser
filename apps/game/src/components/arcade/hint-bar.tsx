import * as React from "react";

import { hintCostNote } from "./arcade-text";
import type { PublicRound } from "./mode-contract";

/** The round's hint costs and its hints: each one bought so far, then the button for the next. */
export function HintBar({ round, hints, disabled, error, onRequest, buttonRef, latestHintRef }: {
  readonly round: Readonly<PublicRound>;
  /** The hints bought for this round, in order. */
  readonly hints: readonly string[];
  readonly disabled: boolean;
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
          ? <p className="hint" key={clue.order} tabIndex={-1} ref={index === hints.length - 1 ? latestHintRef : undefined}>{hints[index]}</p>
          : index === hints.length
            ? <button className="hint-button" type="button" key={clue.order} ref={buttonRef} aria-describedby={`hint-cost-${round.roundId}`} disabled={disabled} onClick={onRequest}>
                Reveal hint {clue.order}
              </button>
            : null)}
        {error && <p className="demo-error" role="alert">{error}</p>}
      </div>
    </>
  );
}
