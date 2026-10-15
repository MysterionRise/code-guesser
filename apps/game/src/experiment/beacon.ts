import type { ClientEvent } from "./events";

/**
 * Sends one browser event to the beacon route (#107) with the game's latest token. It never waits and never fails
 * the game: a browser without `sendBeacon`, or one that drops the beacon, only leaves an event out.
 */
export const sendEvent = (sessionToken: string, event: ClientEvent): void => {
  try {
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return;
    navigator.sendBeacon("/api/events", new Blob([JSON.stringify({ sessionToken, event })], { type: "application/json" }));
  } catch {
    // An event is never worth an error in the game.
  }
};
