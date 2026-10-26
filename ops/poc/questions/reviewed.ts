/**
 * Layers a review found wrong, before or after they were published (#122). Each round named here keeps its static
 * question and hints, and costs no model call. A model writes every layer and nothing runs the round's code, so a
 * step-through can be wrong in a way no check in this pipeline catches; a reader has to.
 */
export const REVIEW_REFUSED: Readonly<Record<string, string>> = Object.freeze({
  // Counting sort, trace on [3, 1, 3, 2]: every frame tallies into four slots, but the code makes
  // coll_max + 1 - coll_min, three (agent playtest run 2, docs/review/evidence/2026-10-20-agent-playtest-run-2.md).
  "local-algorithm-09e10a48edfab7bb72fc8492": "TRACE_WRONG",
  // The v7 data run's read of every algorithm trace (docs/review/evidence/2026-10-21-v7-data-run.md), Python's
  // cocktail shaker sort and heapsort published since v6, the rest new in v7:
  // Cocktail shaker sort, on [3, 1, 2]: the last frame has start 0 and swapped false, but swapped stays true
  // through the backward pass and start becomes 1, which ends the loop.
  "local-algorithm-16543b558b4a364ac2cba43c": "TRACE_WRONG",
  // Heapsort, on [3, 1, 2]: the first pass leaves [3, 1, 2], already a heap, not [3, 2, 1], and the later frames
  // follow from that wrong list.
  "local-algorithm-cf96ab1e9c386c57af63b4fa": "TRACE_WRONG",
  // Coin change in Go, on [1, 2] and 4: combination ends [1, 1, 2, 2] and the code returns 2, not 3.
  "local-algorithm-331e3b7185cf0d185048f440": "TRACE_WRONG",
  // Quicksort in Go, on [3, 1, 2]: Partition pivots on the last item, 2, and returns index 1, not 2.
  "local-algorithm-31b59c08e6402da2ed2c462a": "TRACE_WRONG",
  // Binary search in Python, on [2, 4, 7, 9, 12] for 7: with left and right both 1 the loop runs once more,
  // so the range is not closed there.
  "local-algorithm-b8dd88f7583e2974ed3dcfb6": "TRACE_WRONG",
  // Breadth-first search in Go, from 0 to 2: the code returns as soon as it meets vertex 2, so it never marks it or
  // takes vertex 1 off the queue.
  "local-algorithm-bfc94bb5509bb43b7865769f": "TRACE_WRONG",
});
