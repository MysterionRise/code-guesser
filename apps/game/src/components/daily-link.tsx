"use client";

import * as React from "react";

import { localDate } from "./local-date";

/**
 * Today's five on the player's own date (#172). Only the browser knows that date, so the chooser's card and a bare
 * `/?deck=daily` add it here; the server deals it only within a day of its own (`dailyDateOf`).
 */

/** Today's five on a date; `query` carries a lab tester's picks. */
const dailyHref = (date: string, query: string): string => `/?deck=daily&date=${date}${query}`;

const unchanging = (): (() => void) => () => {};

/** The player's date once the page hydrates; the server, which can't know it, renders null. */
const useLocalDate = (): string | null => React.useSyncExternalStore(unchanging, () => localDate(new Date()), () => null);

/** The chooser's card for today's five: until the page hydrates it links to the bare address, which adds the date. */
export function DailyCard({ title, description, query }: { readonly title: string; readonly description: string; readonly query: string }) {
  const date = useLocalDate();
  return (
    <a className="deck-card" href={date === null ? `/?deck=daily${query}` : dailyHref(date, query)}>
      <span className="deck-title">{title}</span>{" "}
      <span className="deck-description">{description}</span>{" "}
      <span className="deck-size">{date}</span>
    </a>
  );
}

/**
 * A bare `/?deck=daily`: it deals nothing, so it records no game, and sends the browser on to its own date's five in
 * place of this page, so Back skips it. Without JavaScript it stays, under the page's notice that the game needs it.
 */
export function DailyRedirect({ query }: { readonly query: string }) {
  React.useEffect(() => {
    window.location.replace(dailyHref(localDate(new Date()), query));
  }, [query]);
  return (
    <main className="empty-state" aria-labelledby="daily-redirect-title">
      <h1 id="daily-redirect-title">Dealing today’s five…</h1>
    </main>
  );
}
