import { describe, expect, it } from "vitest";

import { labelStems, showsLabelStem } from "../src/index";

describe("algorithm label stems", () => {
  it("finds a label's stem inside any identifier, the answer's and a decoy's alike", () => {
    expect(labelStems("Heapsort")).toEqual(["heap"]);
    expect(labelStems("Counting sort")).toEqual(["count"]);
    expect(labelStems("Dijkstra's algorithm")).toEqual(["dijkstra"]);
    // The answer's stem in a helper's name, and in a variable.
    expect(showsLabelStem("        heapify(unsorted, i, n)", "Heapsort")).toBe(true);
    expect(showsLabelStem("int[] count = computeHistogram(array);", "Counting sort")).toBe(true);
    // A decoy's word left in view, which would rule that decoy out.
    expect(showsLabelStem("buckets: list[list] = [[] for _ in range(10)]", "Bucket sort")).toBe(true);
    expect(showsLabelStem("MIN_HEAP_SIZE = minheap", "Heapsort")).toBe(true);
    // The masked code shows none of them.
    expect(showsLabelStem("        mystery(unsorted, i, n)\nint[] mystery = computeHistogram(array);\nmysterys = []", "Heapsort")).toBe(false);
    expect(showsLabelStem("mysterys: list[list] = []", "Bucket sort")).toBe(false);
  });
});
