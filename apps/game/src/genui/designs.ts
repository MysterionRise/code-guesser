/**
 * The generative designs a game can use (#114). Locally `?design=` picks one; the experiment's arm assignment
 * (#106) will seal it on the server instead.
 */
export const DESIGNS = ["catalog", "composer", "visualizer", "host"] as const;
export type Design = (typeof DESIGNS)[number];

export const DESIGN_LABELS: Readonly<Record<Design, string>> = Object.freeze({
  catalog: "Catalog explainer",
  composer: "Composer explainer",
  visualizer: "Visualizer",
  host: "Host chat",
});

/** Designs built so far; the host chat (#104) joins when it lands. */
export const READY_DESIGNS: readonly Design[] = Object.freeze(["catalog", "composer", "visualizer"]);

/** A ready design by name, or null. */
export const readyDesign = (value: unknown): Design | null =>
  typeof value === "string" && (READY_DESIGNS as readonly string[]).includes(value) ? value as Design : null;
