import { algorithmWindow, labelWords, maskNames, withoutCommentary } from "./function-windows";
import { curatedPythonSource } from "./testdata/deck-builders";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const limits = { maxLines: 18, maxBytes: 4096, minBytes: 120 };
const terms = (names: readonly string[], label: string, symbols: readonly string[] = []) =>
  ({ names: [label, ...names], symbols, words: labelWords(label) });

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

  it("masks every identifier that names the algorithm, exact symbols, and the label's own words", () => {
    const masked = maskNames("def quick_sort(xs):\n    return QuicksortRange(xs) + quickSort(xs) + Count(xs) + counted_items + coins",
      { names: ["quick_sort", "quicksort"], symbols: ["Count"], words: ["coin"] });
    expect(masked.text).toBe("def mystery(xs):\n    return MysteryRange(xs) + mystery(xs) + Mystery(xs) + counted_items + mysterys");
    // Only identifiers that name the algorithm count as its name; a masked label word does not.
    expect(masked.masked).toEqual(["quick_sort", "QuicksortRange", "quickSort", "Count"]);
    expect(labelWords("Counting sort")).toEqual(["counting"]);
    expect(labelWords("Breadth-first search")).toEqual(["breadth"]);
    expect(maskNames("RADIX = 10", { names: [], symbols: [], words: ["radix"] }).text).toBe("MYSTERY = 10");
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
