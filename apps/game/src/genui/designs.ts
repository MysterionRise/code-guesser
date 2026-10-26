/**
 * The generative designs a game can use (#114). Each game draws one at deal time and the server seals it (#106,
 * `experiment/arms.ts`); in lab mode `?design=` picks it instead.
 */
export const DESIGNS = ["catalog", "composer", "visualizer", "host"] as const;
export type Design = (typeof DESIGNS)[number];

export const DESIGN_LABELS: Readonly<Record<Design, string>> = Object.freeze({
  catalog: "Catalog explainer",
  composer: "Composer explainer",
  visualizer: "Visualizer",
  host: "Host chat",
});

/** Every design is built. */
export const READY_DESIGNS: readonly Design[] = Object.freeze(["catalog", "composer", "visualizer", "host"]);

/** A ready design by name, or null. */
export const readyDesign = (value: unknown): Design | null =>
  typeof value === "string" && (READY_DESIGNS as readonly string[]).includes(value) ? value as Design : null;

/** The host chat's question field for a round, which a revealed round's cue moves focus to (#161). */
export const hostInputId = (roundId: string): string => `host-input-${roundId}`;
