"use client";

import * as React from "react";

import { points } from "./arcade/arcade-text";
import { RECORDS_EVENT, clearRecords, dayStreakOf, parseRecords, storedRecords, type LocalRecords } from "./arcade/local-records";
import { localDate } from "./local-date";

/**
 * The player's records on the chooser (#63): each card's best and streak, today's five's day streak, and a way to clear
 * them. They live only in this browser, so the server renders none and the page fills them in as it hydrates.
 */

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener("storage", onChange);
  window.addEventListener(RECORDS_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(RECORDS_EVENT, onChange);
  };
};

/** This round set's records once the page hydrates; null on the server, which never sees them. */
const useRecords = (artifact: string): LocalRecords | null => {
  const stored = React.useSyncExternalStore(subscribe, () => storedRecords(), () => undefined);
  return React.useMemo(() => stored === undefined ? null : parseRecords(stored, artifact), [stored, artifact]);
};

/** A deck card's records, "Best 3,250 · streak 4", once a game of it has finished. */
export function DeckRecord({ artifact, deck }: { readonly artifact: string; readonly deck: string }) {
  const record = useRecords(artifact)?.decks[deck];
  if (record === undefined) return null;
  return <span className="deck-record">Best {points(record.best)}{record.streak > 0 && ` · streak ${record.streak}`}</span>;
}

/** Today's five's card: the run of days the player has finished it, while it still runs. */
export function DayStreak({ artifact }: { readonly artifact: string }) {
  const records = useRecords(artifact);
  const days = records === null ? 0 : dayStreakOf(records, localDate(new Date()));
  return days > 0 ? <span className="deck-record">Day streak {days}</span> : null;
}

/**
 * "Clear records", once there are some: it asks first, inline, and keeps focus on what replaced the button it was on,
 * so a keyboard player is never dropped to the page.
 */
export function ClearRecords({ artifact }: { readonly artifact: string }) {
  const records = useRecords(artifact);
  const [step, setStep] = React.useState<"ask" | "confirm" | "cleared">("ask");
  const clearButton = React.useRef<HTMLButtonElement>(null);
  const keepButton = React.useRef<HTMLButtonElement>(null);
  const status = React.useRef<HTMLParagraphElement>(null);
  const moved = React.useRef(false);
  React.useEffect(() => {
    if (!moved.current) return;
    (step === "confirm" ? keepButton : step === "cleared" ? status : clearButton).current?.focus();
  }, [step]);
  const go = (next: typeof step) => { moved.current = true; setStep(next); };
  const kept = records !== null && (Object.keys(records.decks).length > 0 || records.daily !== null);
  if (step === "cleared") return <p className="records-status" role="status" tabIndex={-1} ref={status}>Records cleared.</p>;
  if (!kept) return null;
  return (
    <div className="records-clear">
      {step === "ask"
        ? <button type="button" ref={clearButton} onClick={() => go("confirm")}>Clear records</button>
        : (
          <>
            <p id="records-clear-question">Clear every best and streak kept in this browser?</p>
            <button type="button" aria-describedby="records-clear-question" onClick={() => { clearRecords(); go("cleared"); }}>Clear them</button>
            <button type="button" ref={keepButton} onClick={() => go("ask")}>Keep them</button>
          </>
        )}
    </div>
  );
}
