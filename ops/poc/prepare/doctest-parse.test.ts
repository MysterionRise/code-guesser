import { doctestExamples, doctestFunctions, freeNames, roundExamples } from "./doctest-parse";

const testModuleName: string = "vitest";
const { describe, expect, it } = await import(testModuleName) as any;

const docstring = (text: string): readonly string[] => text.split("\n");

describe("doctest parsing", () => {
  it("keeps single calls of the function with literal arguments and one short output line", () => {
    const examples = doctestExamples(docstring([
      ">>> area(2, 3)", "6",
      ">>> area(-1.5, 2)", "-3.0",
      ">>> area(width, 3)", "9",
      ">>> other(2, 3)", "6",
      ">>> area(1, 1)  # doctest: +SKIP", "1",
      ">>> area(0, 1)", "Traceback (most recent call last):", "ValueError: no",
      ">>> area(9, 9)", "81", "82",
      ">>> area(1, 3)", "...",
      ">>> area(1, 7)", "0.142857142857",
      ">>> area(1, 0)", "False",
      ">>> area(10 ** 3, [1, 2])", "[1, 2]",
      ">>> area('a', \"b\")", "'ab'",
    ].join("\n")), "area");
    expect(examples).toEqual([
      { call: "area(2, 3)", output: "6" },
      { call: "area(-1.5, 2)", output: "-3.0" },
      { call: "area(10 ** 3, [1, 2])", output: "[1, 2]" },
      { call: "area('a', \"b\")", output: "'ab'" },
    ]);
  });

  it("offers four distinct outputs of the shape that has the most", () => {
    const example = (output: string, index: number) => ({ call: `f(${index})`, output });
    expect(roundExamples(["1", "2", "2", "3", "'a'", "4", "5"].map(example))!.map(({ output }) => output)).toEqual(["1", "2", "3", "4"]);
    expect(roundExamples(["1", "2", "3", "'a'", "'b'"].map(example))).toBeUndefined();
  });

  it("finds the names a function uses but never binds", () => {
    const code = "def f(items: list[int], *, key=None) -> int:\n    total = 0\n    for index, (a, b) in enumerate(items):\n"
      + "        total += helper(a) + math.floor(b) + LIMIT\n    return sorted(items, key=lambda item: -item)[0] + total";
    expect([...freeNames(code, "f")].sort()).toEqual(["LIMIT", "helper", "math"]);
  });

  it("shows the function without docstring or comments, with the standard imports it needs", () => {
    const source = [
      "\"\"\"Module.\"\"\"", "", "import math", "from collections import Counter", "", "LIMIT = 3", "",
      "def digits(", "    number: int,", ") -> int:", "    \"\"\"Digits.", "", "    >>> digits(5)", "    1", "    >>> digits(10)", "    2", "    \"\"\"",
      "", "    # Count them.", "    return int(math.log10(number)) + 1  # whole digits", "", "",
      "def capped(value: int) -> int:", "    \"\"\"Capped.", "", "    >>> capped(5)", "    3", "    \"\"\"", "    return min(value, LIMIT)", "", "",
      "@cache", "def cached(value: int) -> int:", "    \"\"\"Cached.", "", "    >>> cached(5)", "    5", "    \"\"\"", "    return value", "", "",
      "def loud(value: int) -> int:", "    \"\"\"Loud.", "", "    >>> loud(5)", "    5", "    \"\"\"", "    print(value)", "    return value", "", "",
      "def counted(text: str) -> int:", "    \"\"\"Counted.", "", "    >>> counted('aab')", "    2", "    \"\"\"", "    return Counter(text)['a']",
    ].join("\n");
    const functions = doctestFunctions(source, { maxLines: 18 });
    expect(functions.map(({ name }) => name)).toEqual(["digits", "counted"]);
    expect(functions[0]!.code).toBe("import math\n\ndef digits(\n    number: int,\n) -> int:\n    return int(math.log10(number)) + 1");
    expect(functions[0]!.examples).toEqual([{ call: "digits(5)", output: "1" }, { call: "digits(10)", output: "2" }]);
    expect(functions[1]!.code).toBe("from collections import Counter\n\ndef counted(text: str) -> int:\n    return Counter(text)['a']");
    // A function longer than the pane allows is left out.
    expect(doctestFunctions(source, { maxLines: 7 }).map(({ name }) => name)).toEqual(["counted"]);
  });
});
