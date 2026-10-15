import * as React from "react";

import { points, roundStatusText } from "./arcade-text";
import type { PublicRound } from "./mode-contract";

/** The brand and the running score. */
export function ArcadeHeader({ score }: { readonly score: number }) {
  return (
    <header className="arcade-header">
      <a className="brand" href="/">CODEGUESSR</a>
      <span className="score"><span className="visually-hidden">Score: </span>{points(score)} pts</span>
    </header>
  );
}

/** One dot per round: the current one, the ones played, and each played round's outcome for assistive technology. */
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
            className={current ? "round-dot current" : index < roundIndex ? "round-dot done" : "round-dot"}
            data-round-nav={index + 1}
            key={item.roundId}
            aria-current={current ? "step" : undefined}
          >
            <span aria-hidden="true">{index + 1}</span>
            <span className="visually-hidden">{roundStatusText(index + 1, current, outcomes[index])}</span>
          </li>
        );
      })}
    </ol>
  );
}
