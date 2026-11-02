import * as React from "react";

import { points, roundStatusText } from "./arcade-text";
import { streakOutlook } from "./local-records";
import type { PublicRound } from "./mode-contract";

/**
 * The brand, the round track (as children), and the running score, on one line where the screen allows (#126). Today's
 * five shows its day streak beside the score, while the records hold one (#235).
 */
export function ArcadeHeader({ score, dayStreak = 0, children }: { readonly score: number; readonly dayStreak?: number; readonly children?: React.ReactNode }) {
  return (
    <header className="arcade-header">
      <a className="brand" href="/">CODEGUESSR</a>
      {children}
      <span className="score-group">
        {dayStreak > 0 && <span className="day-streak">Day streak {dayStreak}</span>}
        <span className="score"><span className="visually-hidden">Score: </span>{points(score)} pts</span>
      </span>
    </header>
  );
}

/**
 * What a running streak needs from this game, under the header (#232): "Streak 3 · 3 of 5 right keeps it" as the game
 * starts, "2 more right keeps your streak" as rounds lock, then "Streak kept" or "Streak over". Nothing without a
 * streak in the records. It is no live region: the verdict is what a lock announces.
 */
export function StreakLine({ streak, correct, answered, total }: {
  readonly streak: number;
  readonly correct: number;
  readonly answered: number;
  readonly total: number;
}) {
  const outlook = streakOutlook(streak, correct, answered, total);
  if (outlook.kind === "none") return null;
  const text = outlook.kind === "kept" ? "Streak kept"
    : outlook.kind === "over" ? "Streak over"
      : outlook.kind === "started" ? "Streak started"
        : outlook.kind === "start"
          ? (answered === 0 ? `${outlook.need} of ${total} right starts a streak` : `${outlook.need} more right starts a streak`)
          : answered === 0 ? `Streak ${outlook.streak} · ${outlook.need} of ${total} right keeps it`
            : `${outlook.need} more right keeps your streak`;
  return <p className={`streak-line streak-${outlook.kind}`} data-streak={outlook.kind}>{text}</p>;
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
