import { algorithmWindow, maskNames, withoutCommentary } from "./function-windows";
import { labelStems, labelWords } from "./model";
import { curatedPythonSource } from "./testdata/deck-builders";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const limits = { maxLines: 18, maxBytes: 4096, minBytes: 120 };
const terms = (names: readonly string[], label: string, symbols: readonly string[] = []) =>
  ({ names: [label, ...names], symbols, stems: labelStems(label) });

describe("algorithm windows", () => {
  it("removes comments, docstrings, and the script entry point, but keeps a string argued on its own line", () => {
    const python = [
      '"""Module docstring."""', "import math", "", "",
      "def area(radius):", '    """Docstring.', "", "    More docstring.", '    """', "    # a comment",
      "    if radius < 0:", "        raise ValueError(", '            "negative radius"', "        )",
      "    return math.pi * radius ** 2  # trailing", "", "", 'if __name__ == "__main__":', "    print(area(2))",
    ].join("\n");
    expect(withoutCommentary(python, "Python")).toBe([
      "import math", "", "def area(radius):", "    if radius < 0:", "        raise ValueError(",
      '            "negative radius"', "        )", "    return math.pi * radius ** 2",
    ].join("\n"));
    const go = "// Package doc\npackage sorts\n\n/* block\ncomment */\nfunc Area(r float64) float64 {\n\treturn r * r // squared\n}\n\nfunc main() {\n\tprintln(\"// not a comment\")\n}\n";
    expect(withoutCommentary(go, "Go")).toBe("package sorts\n\nfunc Area(r float64) float64 {\n\treturn r * r\n}");
    const java = "/** Javadoc */\nclass Area {\n    String s = \"// kept\";\n    public static void main(String[] args) {\n        run();\n    }\n}\n";
    expect(withoutCommentary(java, "Java")).toBe("class Area {\n    String s = \"// kept\";\n}");
  });

  it("masks every identifier that names the algorithm, exact symbols, and the options' label stems", () => {
    const masked = maskNames("def quick_sort(xs):\n    return QuicksortRange(xs) + quickSort(xs) + Count(xs) + counted_items + coins",
      { names: ["quick_sort", "quicksort"], symbols: ["Count"], stems: ["coin"] });
    expect(masked.text).toBe("def mystery(xs):\n    return MysteryRange(xs) + mystery(xs) + Mystery(xs) + counted_items + mysterys");
    // Only identifiers that name the algorithm count as its name; a masked label stem does not.
    expect(masked.masked).toEqual(["quick_sort", "QuicksortRange", "quickSort", "Count"]);
    expect(labelWords("Counting sort")).toEqual(["counting"]);
    expect(labelWords("Breadth-first search")).toEqual(["breadth"]);
    expect(maskNames("RADIX = 10", { names: [], symbols: [], stems: ["radix"] }).text).toBe("MYSTERY = 10");
  });

  it("masks a label stem wherever it starts, with the rest of each word it touches, even when the identifier splits it", () => {
    const code = "holes = pigeonHoles(xs)\nmake = createPigeonHoles(n)\nLIMIT = MAX_PIGEON_HOLES\nfill(populate_pigeon_holes, pigeonhole)\nkeep(escaped, napigeonholes)";
    const masked = maskNames(code, { names: [], symbols: [], stems: ["pigeonhole"] });
    expect(masked.text).toBe("holes = mysterys(xs)\nmake = createMysterys(n)\nLIMIT = MAX_MYSTERYS\nfill(populate_mysterys, mystery)\nkeep(escaped, mysterys)");
    expect(masked.masked).toEqual([]);
  });

  it("masks every option's stems alike, so no telling ending or leftover word points to the answer or rules out a decoy", () => {
    expect(labelStems("Heapsort")).toEqual(["heap"]);
    expect(labelStems("Counting sort")).toEqual(["count"]);
    expect(labelStems("Insertion sort")).toEqual(["insert"]);
    expect(labelStems("Bucket sort")).toEqual(["bucket"]);
    // `-est` is no ending: `longest` would otherwise mask Java's `long`.
    expect(labelStems("Longest common subsequence")).toEqual(["longest", "common", "subsequence"]);
    const stems = ["Heapsort", "Merge sort", "Counting sort", "Bucket sort"].flatMap(labelStems);
    const masked = maskNames("heapify(xs, i, n)\nmin_heap = maxHeapSize + minheap\nint[] count = counters(buckets, bucketIndex, HEAP_SIZE)",
      { names: [], symbols: [], stems });
    expect(masked.text).toBe("mystery(xs, i, n)\nmin_mystery = maxMysterySize + mystery\nint[] mystery = mystery(mysterys, mysteryIndex, MYSTERY_SIZE)");
  });

  it("opens on the algorithm's own definition, not on a helper masked only for a label stem", () => {
    const source = [
      "def heapify(items, index, size):", "    largest = index", "    left = 2 * index + 1",
      "    if left < size and items[left] > items[largest]:", "        largest = left", "    if largest != index:",
      "        items[index], items[largest] = items[largest], items[index]", "        heapify(items, largest, size)", "", "",
      "def heap_sort(items):", "    size = len(items)", "    for index in range(size // 2 - 1, -1, -1):", "        heapify(items, index, size)",
      "    for index in range(size - 1, 0, -1):", "        items[0], items[index] = items[index], items[0]", "        heapify(items, 0, index)",
      "    return items", "",
    ].join("\n");
    const window = algorithmWindow(source, "Python", terms(["heap_sort", "heapsort"], "Heapsort"), limits)!;
    expect(window.functionName).toBe("heap_sort");
    expect(window.excerpt.split("\n")[0]).toBe("def mystery(items):");
    expect(window.excerpt).not.toMatch(/heap/iu);
  });

  it("starts at the masked definition and shows no name of the algorithm", () => {
    const window = algorithmWindow(curatedPythonSource("binary_search"), "Python", terms(["binary_search"], "Binary search"), limits)!;
    expect(window.functionName).toBe("binary_search");
    expect(window.excerpt.split("\n")[0]).toBe("def mystery(items, target):");
    expect(window.excerpt).not.toMatch(/binary|search|Doc for|>>>|__main__/u);
  });

  it("gives no window when the code never names the algorithm or the window would be too small", () => {
    expect(algorithmWindow(curatedPythonSource("binary_search"), "Python", terms(["merge_sort"], "Merge sort"), limits)).toBeUndefined();
    expect(algorithmWindow("def quick_sort(xs):\n    return xs\n", "Python", terms(["quick_sort"], "Quicksort"), limits)).toBeUndefined();
  });
});
