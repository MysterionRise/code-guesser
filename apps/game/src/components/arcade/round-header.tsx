import * as React from "react";

import { points, roundStatusText } from "./arcade-text";
import type { PublicRound } from "./mode-contract";

/** The brand, the round track (as children), and the running score, on one line where the screen allows (#126). */
export function ArcadeHeader({ score, children }: { readonly score: number; readonly children?: React.ReactNode }) {
  return (
    <header className="arcade-header">
      <a className="brand" href="/">CODEGUESSR</a>
      {children}
      <span className="score"><span className="visually-hidden">Score: </span>{points(score)} pts</span>
    </header>
  );
}

/** One dot per round: the current one, and each played one marked right or missed, by colour and by ✓ or ✗ (#43). */
export function RoundTrack({ rounds, roundIndex, outcomes }: {
  readonly rounds: readonly Readonly<PublicRound>[];
  readonly roundIndex: number;
  readonly outcomes: readonly boolean[];
}) {
  return (
    <ol className="round-track" aria-label="Round progress">
      {rounds.map((item, index) => {
        const current = index === roundIndex;
        return (
          <li
            className={current ? "round-dot current" : index < roundIndex ? `round-dot done ${outcomes[index] ? "correct" : "missed"}` : "round-dot"}
            data-round-nav={index + 1}
            key={item.roundId}
            aria-current={current ? "step" : undefined}
          >
            <span aria-hidden="true">{index + 1}{outcomes[index] === undefined ? "" : outcomes[index] ? " ✓" : " ✗"}</span>
            <span className="visually-hidden">{roundStatusText(index + 1, current, outcomes[index])}</span>
          </li>
        );
      })}
    </ol>
  );
}
