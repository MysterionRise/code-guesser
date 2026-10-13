import * as React from "react";

import type { LocalRealExperimentUnavailable } from "./local-real-experiment-loader.server";

/** What the operator does about each reason code; none of it quotes the artifact. */
const OPERATOR_STEPS: Readonly<Record<LocalRealExperimentUnavailable, React.ReactNode>> = Object.freeze({
  MISSING: <>
    There is no artifact at <code>apps/game/src/demo/generated/local-real-rounds.json</code>. Run{" "}
    <code>pnpm prepare:poc</code>, then rebuild and restart the game.
  </>,
  HASH_MISMATCH: <>
    The artifact does not match the hash pinned in this build. If <code>pnpm prepare:poc</code> has just written
    a new one, rebuild and restart the game so the build carries its pin; otherwise restore the committed artifact.
  </>,
  SCHEMA: <>
    The artifact matches its pinned hash but is not valid JSON of the current format. Run{" "}
    <code>pnpm prepare:poc</code> with the current code, then rebuild and restart the game.
  </>,
});

/** The root route's empty state: no rounds to play, and the reason code that tells the operator why. */
export function ArtifactUnavailable({ reason }: { readonly reason: LocalRealExperimentUnavailable }) {
  return (
    <section className="empty-state" role="alert" aria-labelledby="empty-state-title">
      <h1 id="empty-state-title">No rounds are ready yet</h1>
      <p>The decks are prepared from real open-source code before play, and this copy has none to serve.</p>
      <p className="operator-note">
        For the operator: <code data-reason={reason}>{reason}</code>. {OPERATOR_STEPS[reason]}
      </p>
    </section>
  );
}
