/**
 * Layers a review found wrong after they were published (#122). Each round named here keeps its static question and
 * hints, and costs no model call. A model writes every layer and nothing runs the round's code, so a step-through
 * can be wrong in a way no check in this pipeline catches; a reader has to.
 */
export const REVIEW_REFUSED: Readonly<Record<string, string>> = Object.freeze({
  // Counting sort, trace on [3, 1, 3, 2]: every frame tallies into four slots, but the code makes
  // coll_max + 1 - coll_min, three (agent playtest run 2, docs/review/evidence/2026-10-20-agent-playtest-run-2.md).
  "local-algorithm-09e10a48edfab7bb72fc8492": "TRACE_WRONG",
});
